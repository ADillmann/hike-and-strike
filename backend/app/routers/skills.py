from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.models import SkillTemplate, User
from app.schemas import SkillTemplateCreate, SkillTemplateOut

router = APIRouter(prefix="/skills", tags=["skills"])


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
