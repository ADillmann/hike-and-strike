import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.models import BattlePreset, EnemyTemplate, User
from app.schemas import BattlePresetCreate, BattlePresetOut, EnemyTemplateCreate, EnemyTemplateOut

router = APIRouter(prefix="/enemies", tags=["enemies"])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "preset"


def _unique_preset_id(db: Session, base: str) -> str:
    candidate = base
    n = 2
    while db.get(BattlePreset, candidate):
        candidate = f"{base}_{n}"
        n += 1
    return candidate


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
    if not enemy:
        raise HTTPException(status_code=404, detail="Enemy not found")
    if not enemy.is_system and enemy.master_id != master.id:
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


@router.get("/presets", response_model=list[BattlePresetOut])
def list_presets(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[BattlePresetOut]:
    return db.query(BattlePreset).order_by(BattlePreset.name).all()


@router.post("/presets", response_model=BattlePresetOut)
def create_preset(
    payload: BattlePresetCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> BattlePresetOut:
    base_id = payload.preset_id or _slugify(payload.name)
    preset_id = _unique_preset_id(db, base_id)
    preset = BattlePreset(
        id=preset_id,
        name=payload.name,
        enemies=[e.model_dump() for e in payload.enemies],
        master_id=master.id,
        is_system=False,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return preset


@router.patch("/presets/{preset_id}", response_model=BattlePresetOut)
def update_preset(
    preset_id: str,
    payload: BattlePresetCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> BattlePresetOut:
    preset = db.get(BattlePreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    if not preset.is_system and preset.master_id != master.id:
        raise HTTPException(status_code=404, detail="Preset not found")
    preset.name = payload.name
    preset.enemies = [e.model_dump() for e in payload.enemies]
    db.commit()
    db.refresh(preset)
    return preset


@router.delete("/presets/{preset_id}")
def delete_preset(
    preset_id: str,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    preset = db.get(BattlePreset, preset_id)
    if not preset or preset.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system preset")
    if preset.master_id != master.id:
        raise HTTPException(status_code=404, detail="Preset not found")
    db.delete(preset)
    db.commit()
    return {"ok": True}
