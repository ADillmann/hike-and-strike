from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.models import EffectTemplate, ItemTemplate, SkillTemplate, User
from app.schemas import ItemTemplateCreate, ItemTemplateOut

router = APIRouter(prefix="/items", tags=["items"])


def _validate_item_payload(db: Session, payload: ItemTemplateCreate) -> None:
    if payload.item_type == "secret" and not payload.secret_template_id:
        raise HTTPException(status_code=400, detail="Secret items require a secret_template_id")
    if payload.effect_template_id and not db.get(EffectTemplate, payload.effect_template_id):
        raise HTTPException(status_code=400, detail="Effect template not found")
    if payload.skill_template_id:
        if payload.item_type != "consumable":
            raise HTTPException(status_code=400, detail="skill_template_id is only allowed on consumables")
        if not db.get(SkillTemplate, payload.skill_template_id):
            raise HTTPException(status_code=400, detail="Skill template not found")


@router.get("", response_model=list[ItemTemplateOut])
def list_items(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
    tier: int | None = None,
) -> list[ItemTemplateOut]:
    q = db.query(ItemTemplate).order_by(ItemTemplate.tier, ItemTemplate.name)
    if tier is not None:
        q = q.filter(ItemTemplate.tier == tier)
    return q.all()


@router.post("", response_model=ItemTemplateOut)
def create_item(
    payload: ItemTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> ItemTemplateOut:
    _validate_item_payload(db, payload)
    item = ItemTemplate(**payload.model_dump(), master_id=master.id, is_system=False)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ItemTemplateOut)
def update_item(
    item_id: int,
    payload: ItemTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> ItemTemplateOut:
    item = db.get(ItemTemplate, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not item.is_system and item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Item not found")
    _validate_item_payload(db, payload)
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}")
def delete_item(
    item_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    item = db.get(ItemTemplate, item_id)
    if not item or item.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system item")
    if item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
