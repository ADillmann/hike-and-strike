from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.models import Campaign, CampaignEventNode, EventHistory, EventTemplate, User
from app.schemas import AdvanceCampaignRequest, RewardsRequest
from app.services.campaign_engine import (
    apply_rest_to_party,
    apply_rewards_and_punishments,
    broadcast_campaign_state,
    broadcast_character_updated,
    campaign_state_payload,
    clear_event_effects_for_party,
    get_campaign_party,
)
from app.services.character_progression import campaign_has_active_battle
from app.websocket.manager import ws_manager

router = APIRouter(prefix="/campaigns", tags=["campaign_runtime"])


def _payload_has_xp(rewards: dict | None) -> bool:
    return bool(rewards and rewards.get("xp"))


@router.get("/{campaign_id}/state")
def get_state(
    campaign_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign_state_payload(db, campaign)


@router.post("/{campaign_id}/advance")
async def advance_campaign(
    campaign_id: int,
    payload: AdvanceCampaignRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    node = db.get(CampaignEventNode, payload.node_id)
    if not node or node.campaign_id != campaign_id:
        raise HTTPException(status_code=404, detail="Node not found")

    prev_node_id = campaign.current_node_id

    target_template = db.get(EventTemplate, node.event_template_id)
    apply_rest = payload.apply_rest
    if target_template and target_template.event_type != "rest":
        apply_rest = False

    if payload.rewards or payload.punishments:
        if _payload_has_xp(payload.rewards) and campaign_has_active_battle(db, campaign_id):
            raise HTTPException(status_code=409, detail="Cannot grant XP during an active battle")
        try:
            apply_rewards_and_punishments(
                db, campaign, payload.rewards, payload.punishments, master.id
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    history = EventHistory(
        campaign_id=campaign_id,
        node_id=prev_node_id,
        outcome=payload.outcome,
        master_notes=payload.master_notes,
        rewards_json=payload.rewards,
        punishments_json=payload.punishments,
    )
    db.add(history)

    if apply_rest:
        apply_rest_to_party(db, campaign)

    clear_event_effects_for_party(db, campaign)
    campaign.current_node_id = payload.node_id
    if campaign.status == "draft":
        campaign.status = "active"
    db.commit()

    if payload.rewards or payload.punishments:
        for character in get_campaign_party(db, campaign):
            await broadcast_character_updated(db, character.id, campaign_id)

    await ws_manager.broadcast(
        campaign_id,
        {
            "type": "history_added",
            "data": {
                "outcome": payload.outcome,
                "master_notes": payload.master_notes,
                "node_id": prev_node_id,
            },
        },
    )
    await ws_manager.broadcast(
        campaign_id,
        {
            "type": "event_advanced",
            "data": {"node_id": payload.node_id},
        },
    )
    await broadcast_campaign_state(db, campaign_id)
    for character in get_campaign_party(db, campaign):
        await broadcast_character_updated(db, character.id, campaign_id)
    return campaign_state_payload(db, campaign)


@router.post("/{campaign_id}/rewards")
async def apply_rewards(
    campaign_id: int,
    payload: RewardsRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if _payload_has_xp(payload.rewards) and campaign_has_active_battle(db, campaign_id):
        raise HTTPException(status_code=409, detail="Cannot grant XP during an active battle")
    try:
        apply_rewards_and_punishments(db, campaign, payload.rewards, payload.punishments, master.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.commit()
    for character in get_campaign_party(db, campaign):
        await broadcast_character_updated(db, character.id, campaign_id)
    await broadcast_campaign_state(db, campaign_id)
    return {"ok": True}


@router.get("/{campaign_id}/history")
def get_history(
    campaign_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[dict[str, Any]]:
    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    entries = (
        db.query(EventHistory)
        .filter(EventHistory.campaign_id == campaign_id)
        .order_by(EventHistory.timestamp.desc())
        .all()
    )
    result = []
    for e in entries:
        node_label = None
        event_name = None
        if e.node_id:
            node = db.get(CampaignEventNode, e.node_id)
            if node:
                node_label = node.label
                template = db.get(EventTemplate, node.event_template_id)
                event_name = template.name if template else None
        result.append(
            {
                "id": e.id,
                "node_id": e.node_id,
                "node_label": node_label,
                "event_name": event_name,
                "outcome": e.outcome,
                "master_notes": e.master_notes,
                "rewards_json": e.rewards_json,
                "punishments_json": e.punishments_json,
                "timestamp": e.timestamp.isoformat(),
            }
        )
    return result
