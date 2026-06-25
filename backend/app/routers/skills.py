from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.game.constants import (
    SKILL_EFFECT_TYPES,
    SPLASH_RADIUS_OPTIONS,
    SUPPORT_MODES,
    SUPPORT_TARGET_SCOPES,
)
from app.models import EffectTemplate, SkillTemplate, User
from app.schemas import SkillTemplateCreate, SkillTemplateOut

router = APIRouter(prefix="/skills", tags=["skills"])


def _validate_skill_payload(db: Session, payload: SkillTemplateCreate) -> None:
    if payload.effect_type not in SKILL_EFFECT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid effect_type")
    params: dict[str, Any] = payload.effect_params or {}
    splash = params.get("splash_radius")
    if splash is not None and int(splash) not in SPLASH_RADIUS_OPTIONS:
        raise HTTPException(status_code=400, detail="splash_radius must be 0, 1, or 2")
    if payload.effect_type == "support":
        mode = params.get("support_mode", "shield")
        if mode not in SUPPORT_MODES:
            raise HTTPException(status_code=400, detail="Invalid support_mode")
        scope = params.get("target_scope", "single")
        if scope not in SUPPORT_TARGET_SCOPES:
            raise HTTPException(status_code=400, detail="Invalid target_scope")
        if mode == "apply_effect":
            tid = params.get("effect_template_id")
            if not tid:
                raise HTTPException(status_code=400, detail="apply_effect requires effect_template_id")
            template = db.get(EffectTemplate, tid)
            if not template:
                raise HTTPException(status_code=400, detail="Effect template not found")
            if not template.active_in_battle:
                raise HTTPException(status_code=400, detail="Effect template must be active in battle")


@router.get("", response_model=list[SkillTemplateOut])
def list_skills(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[SkillTemplateOut]:
    return db.query(SkillTemplate).order_by(SkillTemplate.name).all()


@router.post("", response_model=SkillTemplateOut)
def create_skill(
    payload: SkillTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> SkillTemplateOut:
    _validate_skill_payload(db, payload)
    item = SkillTemplate(**payload.model_dump(), master_id=master.id, is_system=False)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{skill_id}", response_model=SkillTemplateOut)
def update_skill(
    skill_id: int,
    payload: SkillTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> SkillTemplateOut:
    item = db.get(SkillTemplate, skill_id)
    if not item:
        raise HTTPException(status_code=404, detail="Skill not found")
    if not item.is_system and item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Skill not found")
    _validate_skill_payload(db, payload)
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{skill_id}")
def delete_skill(
    skill_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    item = db.get(SkillTemplate, skill_id)
    if not item or item.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system skill")
    if item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Skill not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
