from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_master
from app.database import get_db
from app.models import Battle, Campaign, Character, GroupMember, User, UserRole
from app.schemas import BattleActionRequest, BattleCreateRequest
from app.services.battle_presets import resolve_preset_enemy_specs
from app.services.battle_engine import (
    build_battle_state,
    end_battle,
    perform_action,
    start_battle,
    sync_party_hp_to_characters,
)
from app.services.campaign_engine import (
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


def _resolve_enemy_specs(db: Session, payload: BattleCreateRequest) -> list[dict]:
    if payload.preset:
        specs = resolve_preset_enemy_specs(db, payload.preset)
        if not specs:
            raise HTTPException(status_code=400, detail="Unknown preset")
        return specs
    return [s.model_dump() for s in payload.enemies]


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

    party = get_campaign_party(db, campaign)
    if not party:
        raise HTTPException(status_code=400, detail="Campaign has no party")

    enemy_specs = _resolve_enemy_specs(db, payload)
    if not enemy_specs:
        raise HTTPException(status_code=400, detail="No enemies specified")

    state = build_battle_state(
        db,
        campaign,
        party,
        enemy_specs,
        group_initiative_bonus=payload.group_initiative_bonus,
        enemy_initiative_bonus=payload.enemy_initiative_bonus,
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
    return {
        "id": battle.id,
        "campaign_id": battle.campaign_id,
        "status": battle.status,
        "state": battle.state_json,
        "my_character_id": character_id,
        "is_master": user.role == UserRole.master,
    }


@router.post("/{battle_id}/start")
async def start_battle_endpoint(
    battle_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    battle = _get_battle(db, battle_id, master)
    if battle.status != "pending":
        raise HTTPException(status_code=400, detail="Battle already started")
    campaign = db.get(Campaign, battle.campaign_id)
    if campaign:
        clear_event_effects_for_party(db, campaign)
    state = start_battle(battle.state_json or {})
    battle.state_json = state
    battle.status = "active"
    db.commit()

    if campaign:
        for character in get_campaign_party(db, campaign):
            await broadcast_character_updated(db, character.id, campaign.id)

    await ws_manager.broadcast(
        battle.campaign_id,
        {"type": "battle_updated", "data": {"battle_id": battle.id, "state": state}},
    )
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
    actor_id = payload.actor_id or state.get("active_actor_id")
    if not actor_id:
        raise HTTPException(status_code=400, detail="No active actor")

    actor = next((a for a in state.get("actors", []) if a["id"] == actor_id), None)
    if not actor:
        raise HTTPException(status_code=400, detail="Invalid actor")

    action = payload.action
    target_id = payload.target_id
    skill_id = payload.skill_id

    if user.role == UserRole.player:
        character = db.query(Character).filter(Character.user_id == user.id).first()
        if not character or actor.get("character_id") != character.id:
            raise HTTPException(status_code=403, detail="Not your turn")
    elif actor["type"] == "enemy":
        action = "enemy_attack"

    new_state, msg = perform_action(state, actor_id, action, target_id, skill_id)
    if msg != "ok":
        raise HTTPException(status_code=400, detail=msg)

    battle.state_json = new_state
    if new_state.get("status") == "completed":
        battle.status = "completed"
        sync_party_hp_to_characters(db, new_state)
    db.commit()

    for actor_data in new_state.get("actors", []):
        if actor_data["type"] == "player":
            await broadcast_character_updated(db, actor_data["character_id"], battle.campaign_id)

    await ws_manager.broadcast(
        battle.campaign_id,
        {"type": "battle_updated", "data": {"battle_id": battle.id, "state": new_state}},
    )
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

    for actor_data in state.get("actors", []):
        if actor_data["type"] == "player":
            await broadcast_character_updated(db, actor_data["character_id"], battle.campaign_id)

    await ws_manager.broadcast(
        battle.campaign_id,
        {"type": "battle_updated", "data": {"battle_id": battle.id, "state": state}},
    )
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
