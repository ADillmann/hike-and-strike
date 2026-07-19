from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.game.constants import STAT_MAX, STAT_MIN, STAT_NAMES
from app.models import ClassTemplate, User
from app.schemas import (
    ClassTemplateCreate,
    ClassTemplateOut,
    CreationSettingsOut,
    CreationSettingsUpdate,
)
from app.services.character_stats import normalize_base_stats
from app.services.creation_settings import get_creation_bonus_points, set_creation_bonus_points

router = APIRouter(prefix="/classes", tags=["classes"])


def _validate_base_stats(base_stats: dict) -> dict[str, int]:
    stats = normalize_base_stats(base_stats)
    for name in STAT_NAMES:
        val = stats[name]
        if val < STAT_MIN or val > STAT_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"{name} must be between {STAT_MIN} and {STAT_MAX}",
            )
    return stats


def _to_out(item: ClassTemplate) -> ClassTemplateOut:
    return ClassTemplateOut(
        id=item.id,
        name=item.name,
        description=item.description or "",
        base_stats=normalize_base_stats(item.base_stats),
        is_system=item.is_system,
    )


@router.get("/creation-settings", response_model=CreationSettingsOut)
def get_creation_settings(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CreationSettingsOut:
    return CreationSettingsOut(creation_bonus_points=get_creation_bonus_points(db))


@router.patch("/creation-settings", response_model=CreationSettingsOut)
def update_creation_settings(
    payload: CreationSettingsUpdate,
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CreationSettingsOut:
    if payload.creation_bonus_points < 0:
        raise HTTPException(status_code=400, detail="creation_bonus_points must be >= 0")
    value = set_creation_bonus_points(db, payload.creation_bonus_points)
    db.commit()
    return CreationSettingsOut(creation_bonus_points=value)


@router.get("", response_model=list[ClassTemplateOut])
def list_classes(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ClassTemplateOut]:
    rows = db.query(ClassTemplate).order_by(ClassTemplate.name).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=ClassTemplateOut)
def create_class(
    payload: ClassTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassTemplateOut:
    base_stats = _validate_base_stats(payload.base_stats.model_dump())
    item = ClassTemplate(
        name=payload.name.strip(),
        description=payload.description or "",
        base_stats=base_stats,
        master_id=master.id,
        is_system=False,
    )
    if not item.name:
        raise HTTPException(status_code=400, detail="Name is required")
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_out(item)


@router.patch("/{class_id}", response_model=ClassTemplateOut)
def update_class(
    class_id: int,
    payload: ClassTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassTemplateOut:
    item = db.get(ClassTemplate, class_id)
    if not item:
        raise HTTPException(status_code=404, detail="Class not found")
    if not item.is_system and item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Class not found")
    base_stats = _validate_base_stats(payload.base_stats.model_dump())
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    item.name = name
    item.description = payload.description or ""
    item.base_stats = base_stats
    db.commit()
    db.refresh(item)
    return _to_out(item)


@router.delete("/{class_id}")
def delete_class(
    class_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    item = db.get(ClassTemplate, class_id)
    if not item or item.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system class")
    if item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Class not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
