from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import Character, InventoryItem, ItemTemplate, User, UserRole
from app.routers.characters import _serialize_character
from app.schemas import ShopBuyRequest, ShopSellRequest
from app.services.campaign_engine import broadcast_character_updated
from app.services.shop_engine import (
    get_shop_catalog,
    get_shop_sellables,
    shop_buy,
    shop_sell,
    validate_character_at_shop,
)

router = APIRouter(prefix="/player", tags=["player"])


def _player_character(user: User, db: Session) -> Character:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = (
        db.query(Character)
        .options(
            joinedload(Character.inventory_items).joinedload(InventoryItem.item_template),
            joinedload(Character.skills),
            joinedload(Character.temporary_effects),
            joinedload(Character.user),
        )
        .filter(Character.user_id == user.id)
        .first()
    )
    if not character:
        raise HTTPException(status_code=404, detail="No character")
    return character


@router.get("/campaign/active")
def active_campaign(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    from app.models import Campaign, GroupMember
    from app.services.campaign_engine import campaign_state_payload

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


@router.get("/campaign/shop/catalog")
def shop_catalog(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    character = _player_character(user, db)
    try:
        campaign = validate_character_at_shop(db, character)
        return get_shop_catalog(db, character, campaign)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/campaign/shop/sellables")
def shop_sellables(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    character = _player_character(user, db)
    try:
        campaign = validate_character_at_shop(db, character)
        return get_shop_sellables(db, character, campaign)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/campaign/shop/buy")
async def shop_buy_item(
    payload: ShopBuyRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    character = _player_character(user, db)
    try:
        campaign = validate_character_at_shop(db, character)
        shop_buy(db, character, campaign, payload.item_template_id)
        db.commit()
        db.refresh(character)
        await broadcast_character_updated(db, character.id, campaign.id)
        return {"ok": True, "character": _serialize_character(db, character)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/campaign/shop/sell")
async def shop_sell_item(
    payload: ShopSellRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    character = _player_character(user, db)
    try:
        campaign = validate_character_at_shop(db, character)
        shop_sell(db, character, campaign, payload.inventory_item_id)
        db.commit()
        db.refresh(character)
        await broadcast_character_updated(db, character.id, campaign.id)
        return {"ok": True, "character": _serialize_character(db, character)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/races")
def list_races(db: Annotated[Session, Depends(get_db)]) -> list[str]:
    from app.models import ClassTemplate

    names = [c.name for c in db.query(ClassTemplate).order_by(ClassTemplate.name).all()]
    if names:
        return names
    from app.game.constants import RACES

    return RACES


@router.get("/classes")
def list_player_classes(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    from app.models import ClassTemplate
    from app.services.character_stats import normalize_base_stats

    rows = db.query(ClassTemplate).order_by(ClassTemplate.name).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description or "",
            "base_stats": normalize_base_stats(c.base_stats),
        }
        for c in rows
    ]


@router.get("/creation-settings")
def player_creation_settings(db: Annotated[Session, Depends(get_db)]) -> dict:
    from app.services.creation_settings import get_creation_bonus_points

    return {"creation_bonus_points": get_creation_bonus_points(db)}


@router.get("/starter-skills")
def starter_skills(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    from app.models import SkillTemplate

    rows = (
        db.query(SkillTemplate)
        .filter(SkillTemplate.selectable_at_creation == True)  # noqa: E712
        .order_by(SkillTemplate.name)
        .all()
    )
    return [
        {
            "id": s.id,
            "name": s.name,
            "max_uses_per_rest": s.max_uses_per_rest,
            "description": s.description,
            "effect_type": s.effect_type,
        }
        for s in rows
    ]
