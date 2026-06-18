from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_master
from app.database import get_db
from app.models import Campaign, CampaignEventNode, EventTemplate, Group, User
from app.schemas import CampaignCreate, CampaignNodeCreate, CampaignOut

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


def _serialize_campaign(db: Session, campaign: Campaign) -> CampaignOut:
    nodes = []
    for node in sorted(campaign.nodes, key=lambda n: n.sort_order):
        template = db.get(EventTemplate, node.event_template_id)
        nodes.append(
            {
                "id": node.id,
                "sort_order": node.sort_order,
                "label": node.label,
                "event_template_id": node.event_template_id,
                "event_name": template.name if template else None,
                "event_type": template.event_type if template else None,
            }
        )
    return CampaignOut(
        id=campaign.id,
        name=campaign.name,
        group_id=campaign.group_id,
        status=campaign.status,
        current_node_id=campaign.current_node_id,
        nodes=nodes,
    )


@router.get("", response_model=list[CampaignOut])
def list_campaigns(
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[CampaignOut]:
    campaigns = (
        db.query(Campaign)
        .options(joinedload(Campaign.nodes))
        .filter(Campaign.master_id == master.id)
        .all()
    )
    return [_serialize_campaign(db, c) for c in campaigns]


@router.post("", response_model=CampaignOut)
def create_campaign(
    payload: CampaignCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignOut:
    group = db.get(Group, payload.group_id)
    if not group or group.master_id != master.id:
        raise HTTPException(status_code=404, detail="Group not found")
    campaign = Campaign(name=payload.name, group_id=payload.group_id, master_id=master.id, status="draft")
    db.add(campaign)
    db.flush()
    for node in payload.nodes:
        db.add(
            CampaignEventNode(
                campaign_id=campaign.id,
                event_template_id=node.event_template_id,
                sort_order=node.sort_order,
                label=node.label,
            )
        )
    db.commit()
    campaign = db.query(Campaign).options(joinedload(Campaign.nodes)).filter(Campaign.id == campaign.id).first()
    return _serialize_campaign(db, campaign)


@router.put("/{campaign_id}/nodes", response_model=CampaignOut)
def set_nodes(
    campaign_id: int,
    nodes: list[CampaignNodeCreate],
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignOut:
    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status != "draft":
        raise HTTPException(status_code=400, detail="Can only edit draft campaigns")
    db.query(CampaignEventNode).filter(CampaignEventNode.campaign_id == campaign_id).delete()
    for node in nodes:
        db.add(
            CampaignEventNode(
                campaign_id=campaign_id,
                event_template_id=node.event_template_id,
                sort_order=node.sort_order,
                label=node.label,
            )
        )
    db.commit()
    campaign = db.query(Campaign).options(joinedload(Campaign.nodes)).filter(Campaign.id == campaign_id).first()
    return _serialize_campaign(db, campaign)


@router.post("/{campaign_id}/start")
async def start_campaign(
    campaign_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    from app.services.campaign_engine import broadcast_campaign_state

    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    nodes = db.query(CampaignEventNode).filter(CampaignEventNode.campaign_id == campaign_id).order_by(CampaignEventNode.sort_order).all()
    if not nodes:
        raise HTTPException(status_code=400, detail="Campaign has no events")
    campaign.status = "active"
    campaign.current_node_id = nodes[0].id
    db.commit()
    await broadcast_campaign_state(db, campaign_id)
    return {"ok": True, "current_node_id": campaign.current_node_id}


@router.post("/{campaign_id}/pause")
async def pause_campaign(
    campaign_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    from app.services.campaign_engine import broadcast_campaign_state

    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign.status = "paused"
    db.commit()
    await broadcast_campaign_state(db, campaign_id)
    return {"ok": True}


@router.post("/{campaign_id}/complete")
async def complete_campaign(
    campaign_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    from app.services.campaign_engine import broadcast_campaign_state

    campaign = db.get(Campaign, campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign.status = "completed"
    db.commit()
    await broadcast_campaign_state(db, campaign_id)
    return {"ok": True}
