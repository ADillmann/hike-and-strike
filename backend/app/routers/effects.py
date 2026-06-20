from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.models import EffectTemplate, User
from app.schemas import EffectTemplateCreate, EffectTemplateOut

router = APIRouter(prefix="/effects", tags=["effects"])


@router.get("", response_model=list[EffectTemplateOut])
def list_effects(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[EffectTemplateOut]:
    return db.query(EffectTemplate).order_by(EffectTemplate.name).all()


@router.post("", response_model=EffectTemplateOut)
def create_effect(
    payload: EffectTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> EffectTemplateOut:
    item = EffectTemplate(**payload.model_dump(), master_id=master.id, is_system=False)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{effect_id}", response_model=EffectTemplateOut)
def update_effect(
    effect_id: int,
    payload: EffectTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> EffectTemplateOut:
    item = db.get(EffectTemplate, effect_id)
    if not item:
        raise HTTPException(status_code=404, detail="Effect not found")
    if not item.is_system and item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Effect not found")
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{effect_id}")
def delete_effect(
    effect_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    item = db.get(EffectTemplate, effect_id)
    if not item or item.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system effect")
    if item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Effect not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
