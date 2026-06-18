import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_master
from app.config import settings
from app.database import get_db
from app.game.constants import EQUIP_SLOTS, STARTER_SKILLS, STAT_NAMES
from app.models import (
    Character,
    InventoryItem,
    Skill,
    StatChangeLog,
    User,
    UserRole,
)
from app.schemas import CharacterCreate, CharacterOut, EquipRequest, StatChangeOut, StatEditRequest
from app.services.campaign_engine import broadcast_character_updated, recalculate_character_hp
from app.services.character_stats import effective_stats, validate_point_buy, weapon_attack_bonus

router = APIRouter(prefix="/characters", tags=["characters"])


def _serialize_character(db: Session, character: Character) -> CharacterOut:
    db.refresh(character)
    character = (
        db.query(Character)
        .options(
            joinedload(Character.inventory_items).joinedload(InventoryItem.item_template),
            joinedload(Character.skills),
            joinedload(Character.temporary_effects),
            joinedload(Character.user),
        )
        .filter(Character.id == character.id)
        .first()
    )
    eff = effective_stats(character.stats, character.inventory_items, character.temporary_effects)
    return CharacterOut(
        id=character.id,
        user_id=character.user_id,
        name=character.name,
        race=character.race,
        portrait_path=character.portrait_path,
        stats=character.stats,
        max_hp=character.max_hp,
        current_hp=character.current_hp,
        effective_stats=eff,
        attack_bonus=weapon_attack_bonus(character.inventory_items, eff),
        username=character.user.username if character.user else None,
        skills=[
            {"id": s.id, "name": s.name, "uses_remaining": s.uses_remaining, "max_uses_per_rest": s.max_uses_per_rest}
            for s in character.skills
        ],
        inventory=[
            {
                "id": i.id,
                "item_template_id": i.item_template_id,
                "name": i.item_template.name if i.item_template else None,
                "item_type": i.item_template.item_type if i.item_template else None,
                "tier": i.item_template.tier if i.item_template else None,
                "stats": i.item_template.stats if i.item_template else {},
                "equipped_slot": i.equipped_slot,
                "quantity": i.quantity,
            }
            for i in character.inventory_items
        ],
        temporary_effects=[
            {"id": e.id, "label": e.label, "stat_modifiers": e.stat_modifiers, "cleared_on_rest": e.cleared_on_rest}
            for e in character.temporary_effects
        ],
    )


@router.get("", response_model=list[CharacterOut])
def list_characters(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[CharacterOut]:
    chars = db.query(Character).all()
    return [_serialize_character(db, c) for c in chars]


@router.post("", response_model=CharacterOut)
def create_character(
    payload: CharacterCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    if user.role != UserRole.player:
        raise HTTPException(status_code=400, detail="Only players create characters")
    if db.query(Character).filter(Character.user_id == user.id).first():
        raise HTTPException(status_code=400, detail="Character already exists")
    stats = payload.stats.model_dump()
    try:
        validate_point_buy(stats)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    max_hp = 10 + stats.get("durability", 8) * 5
    character = Character(
        user_id=user.id,
        name=payload.name,
        race=payload.race,
        stats=stats,
        max_hp=max_hp,
        current_hp=max_hp,
    )
    db.add(character)
    db.flush()
    if payload.skills:
        skill_list = payload.skills
    else:
        from app.schemas import SkillCreate

        skill_list = [SkillCreate(**s) for s in STARTER_SKILLS[:2]]
    for sk in skill_list:
        db.add(
            Skill(
                character_id=character.id,
                name=sk.name,
                max_uses_per_rest=sk.max_uses_per_rest,
                uses_remaining=sk.max_uses_per_rest,
            )
        )
    db.commit()
    return _serialize_character(db, character)


@router.get("/me", response_model=CharacterOut)
def get_my_character(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character yet")
    return _serialize_character(db, character)


@router.get("/{character_id}", response_model=CharacterOut)
def get_character(
    character_id: int,
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    return _serialize_character(db, character)


@router.patch("/{character_id}/stats", response_model=CharacterOut)
async def edit_character_stats(
    character_id: int,
    payload: StatEditRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    for stat_name, new_value in payload.changes.items():
        if stat_name in ("current_hp", "max_hp"):
            old = getattr(character, stat_name)
            db.add(
                StatChangeLog(
                    character_id=character.id,
                    stat_name=stat_name,
                    old_value=old,
                    new_value=new_value,
                    reason=payload.reason,
                    changed_by_master_id=master.id,
                    campaign_id=payload.campaign_id,
                )
            )
            setattr(character, stat_name, new_value)
        elif stat_name in STAT_NAMES:
            old = character.stats.get(stat_name, 8)
            character.stats = {**character.stats, stat_name: new_value}
            db.add(
                StatChangeLog(
                    character_id=character.id,
                    stat_name=stat_name,
                    old_value=old,
                    new_value=new_value,
                    reason=payload.reason,
                    changed_by_master_id=master.id,
                    campaign_id=payload.campaign_id,
                )
            )

    if "durability" in payload.changes:
        recalculate_character_hp(db, character, scale_current=payload.scale_hp_on_durability)

    db.commit()
    await broadcast_character_updated(db, character.id, payload.campaign_id)
    return _serialize_character(db, character)


@router.get("/{character_id}/stat-history", response_model=list[StatChangeOut])
def stat_history(
    character_id: int,
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[StatChangeOut]:
    logs = (
        db.query(StatChangeLog)
        .filter(StatChangeLog.character_id == character_id)
        .order_by(StatChangeLog.timestamp.desc())
        .all()
    )
    return logs


@router.post("/me/portrait", response_model=CharacterOut)
async def upload_portrait(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
) -> CharacterOut:
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character yet")
    ext = Path(file.filename or "img.png").suffix or ".png"
    filename = f"portrait_{character.id}_{uuid.uuid4().hex}{ext}"
    dest = settings.uploads_dir / filename
    content = await file.read()
    dest.write_bytes(content)
    character.portrait_path = f"/uploads/{filename}"
    db.commit()
    return _serialize_character(db, character)


@router.post("/me/equip", response_model=CharacterOut)
def equip_item(
    payload: EquipRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character")
    inv = db.get(InventoryItem, payload.inventory_item_id)
    if not inv or inv.character_id != character.id:
        raise HTTPException(status_code=404, detail="Item not found")
    slot = payload.slot
    if slot and slot not in EQUIP_SLOTS:
        raise HTTPException(status_code=400, detail="Invalid slot")
    if slot:
        existing = (
            db.query(InventoryItem)
            .filter(InventoryItem.character_id == character.id, InventoryItem.equipped_slot == slot)
            .first()
        )
        if existing and existing.id != inv.id:
            existing.equipped_slot = None
    inv.equipped_slot = slot
    recalculate_character_hp(db, character)
    db.commit()
    return _serialize_character(db, character)
