from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.models import EnemyTemplate, User
from app.schemas import EnemyTemplateCreate, EnemyTemplateOut

router = APIRouter(prefix="/enemies", tags=["enemies"])


@router.get("", response_model=list[EnemyTemplateOut])
def list_enemies(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[EnemyTemplateOut]:
    return db.query(EnemyTemplate).order_by(EnemyTemplate.name).all()


@router.post("", response_model=EnemyTemplateOut)
def create_enemy(
    payload: EnemyTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> EnemyTemplateOut:
    enemy = EnemyTemplate(**payload.model_dump(), master_id=master.id, is_system=False)
    db.add(enemy)
    db.commit()
    db.refresh(enemy)
    return enemy


@router.patch("/{enemy_id}", response_model=EnemyTemplateOut)
def update_enemy(
    enemy_id: int,
    payload: EnemyTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> EnemyTemplateOut:
    enemy = db.get(EnemyTemplate, enemy_id)
    if not enemy or enemy.is_system:
        raise HTTPException(status_code=400, detail="Cannot edit system enemy")
    if enemy.master_id != master.id:
        raise HTTPException(status_code=404, detail="Enemy not found")
    for k, v in payload.model_dump().items():
        setattr(enemy, k, v)
    db.commit()
    db.refresh(enemy)
    return enemy


@router.delete("/{enemy_id}")
def delete_enemy(
    enemy_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    enemy = db.get(EnemyTemplate, enemy_id)
    if not enemy or enemy.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system enemy")
    if enemy.master_id != master.id:
        raise HTTPException(status_code=404, detail="Enemy not found")
    db.delete(enemy)
    db.commit()
    return {"ok": True}


@router.get("/presets")
def list_presets() -> list[dict[str, Any]]:
    from app.services.battle_engine import BATTLE_PRESETS

    return [{"id": k, **v} for k, v in BATTLE_PRESETS.items()]
