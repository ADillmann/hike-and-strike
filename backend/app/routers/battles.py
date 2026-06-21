from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_master
from app.database import get_db
from app.models import Battle, Campaign, CampaignEventNode, Character, EventTemplate, GroupMember, User, UserRole
from app.schemas import (
    BattleActionRequest,
    BattleCreateRequest,
    BattlePositionsUpdate,
    PrebattleMoveRequest,
)
from app.services.battle_presets import resolve_preset_enemy_specs
from app.services.battle_engine import (
    apply_prebattle_move,
    battle_action_hints,
    build_battle_state,
    end_battle,
    perform_action,
    skip_prebattle_if_done,
    skip_remaining_prebattle,
    start_battle,
    sync_party_hp_to_characters,
    sync_weapon_profiles,
    update_battle_positions,
)
from app.services.battle_geometry import prebattle_reachable_cells
from app.services.campaign_engine import (
    apply_rewards_and_punishments,
    broadcast_campaign_state,
    broadcast_character_updated,
    clear_event_effects_for_party,
    get_campaign_party,
)
from app.websocket.manager import ws_manager

router = APIRouter(prefix="/battles", tags=["battles"])


def _get_battle(db: Session, battle_id: int, user: User) -> Battle:
    battle = db.get(Battle, battle_id)
    if not battle:
        raise HTTPException(status_code=404, detail="Battle not found")
    campaign = db.get(Campaign, battle.campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if user.role == UserRole.master:
        if campaign.master_id != user.id:
            raise HTTPException(status_code=403, detail="Forbidden")
    else:
        character = db.query(Character).filter(Character.user_id == user.id).first()
        if not character:
            raise HTTPException(status_code=403, detail="Forbidden")
        member = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == campaign.group_id, GroupMember.character_id == character.id)
            .first()
        )
        if not member:
            raise HTTPException(status_code=403, detail="Forbidden")
    return battle


def _active_battle_exists(db: Session, campaign_id: int) -> bool:
    return (
        db.query(Battle)
        .filter(Battle.campaign_id == campaign_id, Battle.status.in_(["pending", "active", "positioning"]))
        .first()
        is not None
    )


def _resolve_enemy_specs(db: Session, payload: BattleCreateRequest) -> list[dict]:
    if payload.preset:
        specs = resolve_preset_enemy_specs(db, payload.preset)
        if not specs:
            raise HTTPException(status_code=400, detail="Unknown preset")
        return specs
    return [s.model_dump() for s in payload.enemies]


def _current_battle_config(db: Session, campaign: Campaign) -> dict | None:
    if not campaign.current_node_id:
        return None
    node = db.get(CampaignEventNode, campaign.current_node_id)
    if not node:
        return None
    template = db.get(EventTemplate, node.event_template_id)
    if not template:
        return None
    return getattr(template, "battle_config", None) or None


def _cell_dict(cell) -> dict[str, int] | None:
    if cell is None:
        return None
    return {"x": cell.x, "y": cell.y}


async def _broadcast_battle(campaign_id: int, battle_id: int, state: dict) -> None:
    await ws_manager.broadcast(
        campaign_id,
        {"type": "battle_updated", "data": {"battle_id": battle_id, "state": state}},
    )


async def _apply_outcome_rewards(db: Session, campaign: Campaign, state: dict, master_id: int) -> None:
    winner = state.get("winner")
    if winner == "party" and state.get("victory_rewards"):
        apply_rewards_and_punishments(db, campaign, state["victory_rewards"], None, master_id)
        state["outcome_rewards_applied"] = True
    elif winner == "enemies" and state.get("defeat_punishments"):
        apply_rewards_and_punishments(db, campaign, None, state["defeat_punishments"], master_id)
        state["outcome_punishments_applied"] = True


def _should_apply_event_preset(payload: BattleCreateRequest, battle_config: dict | None) -> bool:
    return bool(
        battle_config
        and battle_config.get("preset")
        and not payload.preset
        and not payload.enemies
    )


@router.post("/campaigns/{campaign_id}")
async def create_battle(
    campaign_id: int,
    payload: BattleCreateRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if _active_battle_exists(db, campaign_id):
        raise HTTPException(status_code=409, detail="Campaign already has an active battle")

    party = get_campaign_party(db, campaign)
    if not party:
        raise HTTPException(status_code=400, detail="Campaign has no party")

    enemy_specs = _resolve_enemy_specs(db, payload)
    if not enemy_specs:
        raise HTTPException(status_code=400, detail="No enemies specified")

    battle_config = _current_battle_config(db, campaign)
    preset = payload.preset or (battle_config or {}).get("preset")
    gi = payload.group_initiative_bonus
    ei = payload.enemy_initiative_bonus
    if battle_config:
        if gi == 0 and battle_config.get("group_initiative_bonus") is not None:
            gi = float(battle_config["group_initiative_bonus"])
        if ei == 0 and battle_config.get("enemy_initiative_bonus") is not None:
            ei = float(battle_config["enemy_initiative_bonus"])
        if _should_apply_event_preset(payload, battle_config):
            preset = battle_config["preset"]
            enemy_specs = _resolve_enemy_specs(db, BattleCreateRequest(preset=preset))

    state = build_battle_state(
        db,
        party,
        enemy_specs,
        group_initiative_bonus=gi,
        enemy_initiative_bonus=ei,
        preset=preset,
        battle_config=battle_config,
    )

    battle = Battle(campaign_id=campaign_id, status="pending", state_json=state)
    db.add(battle)
    db.commit()
    db.refresh(battle)

    await ws_manager.broadcast(
        campaign_id,
        {"type": "battle_started", "data": {"battle_id": battle.id, "status": "pending"}},
    )
    return {"id": battle.id, "state": state}


@router.get("/{battle_id}")
def get_battle(
    battle_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    battle = _get_battle(db, battle_id, user)
    character_id = None
    if user.role == UserRole.player:
        character = db.query(Character).filter(Character.user_id == user.id).first()
        character_id = character.id if character else None
    state = battle.state_json or {}
    state = sync_weapon_profiles(db, state)
    hints = None
    prebattle_hints = None
    active_id = state.get("active_actor_id")
    if state.get("status") == "active" and active_id:
        actor = next((a for a in state.get("actors", []) if a["id"] == active_id), None)
        if actor and actor.get("type") == "player":
            if user.role == UserRole.player and actor.get("character_id") != character_id:
                hints = None
            else:
                hints = battle_action_hints(state, active_id)
    elif battle.status == "pending" and state.get("phase") == "prebattle":
        pending = state.get("prebattle_pending") or []
        if user.role == UserRole.master:
            actor_cells: dict[str, list[dict[str, int]]] = {}
            for aid in pending:
                a = next((x for x in state.get("actors", []) if x["id"] == aid), None)
                if a:
                    actor_cells[aid] = [{"x": c[0], "y": c[1]} for c in prebattle_reachable_cells(state, a)]
            prebattle_hints = {"pending": pending, "actors": actor_cells}
        elif user.role == UserRole.player and character_id:
            my_actor = next(
                (a for a in state.get("actors", []) if a.get("character_id") == character_id),
                None,
            )
            if my_actor and my_actor["id"] in pending and my_actor.get("prebattle_eligible"):
                cells = prebattle_reachable_cells(state, my_actor)
                prebattle_hints = {
                    "actor_id": my_actor["id"],
                    "cells": [{"x": c[0], "y": c[1]} for c in cells],
                }
    return {
        "id": battle.id,
        "campaign_id": battle.campaign_id,
        "status": battle.status,
        "state": state,
        "my_character_id": character_id,
        "is_master": user.role == UserRole.master,
        "action_hints": hints,
        "prebattle_hints": prebattle_hints,
    }


@router.patch("/{battle_id}/positions")
async def update_positions(
    battle_id: int,
    payload: BattlePositionsUpdate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    battle = _get_battle(db, battle_id, master)
    if battle.status != "pending":
        raise HTTPException(status_code=400, detail="Battle already started")
    state = battle.state_json or {}
    positions = {k: {"x": v.x, "y": v.y} for k, v in payload.positions.items()}
    new_state, msg = update_battle_positions(state, positions)
    if msg != "ok":
        raise HTTPException(status_code=400, detail=msg)
    new_state["phase"] = "prebattle" if new_state.get("prebattle_pending") else "ready"
    battle.state_json = new_state
    db.commit()
    await _broadcast_battle(battle.campaign_id, battle.id, new_state)
    return {"id": battle.id, "state": new_state}


@router.post("/{battle_id}/prebattle-move")
async def prebattle_move(
    battle_id: int,
    payload: PrebattleMoveRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    battle = _get_battle(db, battle_id, user)
    if battle.status != "pending":
        raise HTTPException(status_code=400, detail="Battle already started")
    state = battle.state_json or {}
    actor = next((a for a in state.get("actors", []) if a["id"] == payload.actor_id), None)
    if not actor:
        raise HTTPException(status_code=404, detail="Actor not found")
    if user.role == UserRole.player:
        character = db.query(Character).filter(Character.user_id == user.id).first()
        if not character or actor.get("character_id") != character.id:
            raise HTTPException(status_code=403, detail="Forbidden")
    elif user.role == UserRole.master:
        pending = state.get("prebattle_pending") or []
        if payload.actor_id not in pending:
            raise HTTPException(status_code=400, detail="Actor not pending pre-battle move")
    new_state, msg = apply_prebattle_move(state, payload.actor_id, {"x": payload.cell.x, "y": payload.cell.y})
    if msg != "ok":
        raise HTTPException(status_code=400, detail=msg)
    battle.state_json = new_state
    db.commit()
    await _broadcast_battle(battle.campaign_id, battle.id, new_state)
    return {"id": battle.id, "state": new_state}


@router.post("/{battle_id}/start")
async def start_battle_endpoint(
    battle_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
    skip_prebattle: bool = False,
) -> dict[str, Any]:
    battle = _get_battle(db, battle_id, master)
    if battle.status != "pending":
        raise HTTPException(status_code=400, detail="Battle already started")
    state = battle.state_json or {}
    if skip_prebattle and state.get("phase") == "prebattle" and state.get("prebattle_pending"):
        state = skip_remaining_prebattle(state)
    elif state.get("phase") == "prebattle" and state.get("prebattle_pending"):
        raise HTTPException(status_code=400, detail="Pre-battle moves still pending")
    state = skip_prebattle_if_done(state)
    campaign = db.get(Campaign, battle.campaign_id)
    if campaign:
        clear_event_effects_for_party(db, campaign)
    state = sync_weapon_profiles(db, state)
    state = start_battle(state)
    battle.state_json = state
    battle.status = "active"
    db.commit()

    if campaign:
        for character in get_campaign_party(db, campaign):
            await broadcast_character_updated(db, character.id, campaign.id)

    await _broadcast_battle(battle.campaign_id, battle.id, state)
    return {"id": battle.id, "state": state}


@router.post("/{battle_id}/action")
async def battle_action(
    battle_id: int,
    payload: BattleActionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    battle = _get_battle(db, battle_id, user)
    if battle.status != "active":
        raise HTTPException(status_code=400, detail="Battle not active")

    state = battle.state_json or {}
    state = sync_weapon_profiles(db, state)
    actor_id = payload.actor_id or state.get("active_actor_id")
    if not actor_id:
        raise HTTPException(status_code=400, detail="No active actor")

    actor = next((a for a in state.get("actors", []) if a["id"] == actor_id), None)
    if not actor:
        raise HTTPException(status_code=400, detail="Invalid actor")

    if actor.get("type") == "enemy":
        raise HTTPException(status_code=400, detail="Enemy turns resolve automatically")

    if user.role == UserRole.player:
        character = db.query(Character).filter(Character.user_id == user.id).first()
        if not character or actor.get("character_id") != character.id:
            raise HTTPException(status_code=403, detail="Not your turn")

    new_state, msg = perform_action(
        state,
        actor_id,
        payload.action,
        target_id=payload.target_id,
        skill_id=payload.skill_id,
        charge_cell=_cell_dict(payload.charge_cell),
        move_cell=_cell_dict(payload.move_cell),
        guard_cell=_cell_dict(payload.guard_cell),
        inventory_item_id=payload.inventory_item_id,
    )
    if msg != "ok":
        raise HTTPException(status_code=400, detail=msg)

    battle.state_json = new_state
    campaign = db.get(Campaign, battle.campaign_id)
    if new_state.get("status") == "completed":
        battle.status = "completed"
        sync_party_hp_to_characters(db, new_state)
        if campaign:
            try:
                await _apply_outcome_rewards(db, campaign, new_state, user.id)
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.commit()

    if campaign:
        for actor_data in new_state.get("actors", []):
            if actor_data["type"] == "player":
                await broadcast_character_updated(db, actor_data["character_id"], battle.campaign_id)

    await _broadcast_battle(battle.campaign_id, battle.id, new_state)
    if new_state.get("status") == "completed" and campaign:
        await broadcast_campaign_state(db, battle.campaign_id)
    return {"id": battle.id, "state": new_state}


@router.post("/{battle_id}/end")
async def end_battle_endpoint(
    battle_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    battle = _get_battle(db, battle_id, master)
    state = end_battle(battle.state_json or {})
    battle.state_json = state
    battle.status = "completed"
    sync_party_hp_to_characters(db, state)
    db.commit()

    campaign = db.get(Campaign, battle.campaign_id)
    for actor_data in state.get("actors", []):
        if actor_data["type"] == "player":
            await broadcast_character_updated(db, actor_data["character_id"], battle.campaign_id)

    await _broadcast_battle(battle.campaign_id, battle.id, state)
    if campaign:
        await broadcast_campaign_state(db, battle.campaign_id)
    return {"id": battle.id, "state": state}


@router.get("/campaigns/{campaign_id}/active")
def active_battle(
    campaign_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    battle = (
        db.query(Battle)
        .filter(Battle.campaign_id == campaign_id, Battle.status.in_(["pending", "active"]))
        .order_by(Battle.id.desc())
        .first()
    )
    if not battle:
        return {"active": False}
    return {"active": True, "battle_id": battle.id, "status": battle.status}


@router.delete("/{battle_id}")
async def abort_pending_battle(
    battle_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    battle = _get_battle(db, battle_id, master)
    if battle.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending battles can be aborted")
    campaign_id = battle.campaign_id
    db.delete(battle)
    db.commit()
    await ws_manager.broadcast(
        campaign_id,
        {"type": "battle_cancelled", "data": {"battle_id": battle_id}},
    )
    return {"ok": True, "battle_id": battle_id}
