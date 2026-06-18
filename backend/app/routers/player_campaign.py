from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import Campaign, Character, GroupMember, User, UserRole
from app.services.campaign_engine import campaign_state_payload

router = APIRouter(prefix="/player", tags=["player"])


@router.get("/campaign/active")
def active_campaign(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character")
    memberships = db.query(GroupMember).filter(GroupMember.character_id == character.id).all()
    group_ids = [m.group_id for m in memberships]
    if not group_ids:
        return {"active": False}
    campaign = (
        db.query(Campaign)
        .filter(Campaign.group_id.in_(group_ids), Campaign.status.in_(["active", "paused"]))
        .order_by(Campaign.id.desc())
        .first()
    )
    if not campaign:
        return {"active": False}
    payload = campaign_state_payload(db, campaign)
    return {"active": True, "campaign_id": campaign.id, **payload}


@router.get("/races")
def list_races() -> list[str]:
    from app.game.constants import RACES

    return RACES


@router.get("/starter-skills")
def starter_skills() -> list[dict]:
    from app.game.constants import STARTER_SKILLS

    return STARTER_SKILLS
