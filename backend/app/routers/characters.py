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
    GroupMember,
    InventoryItem,
    Skill,
    StatChangeLog,
    User,
    UserRole,
)
from app.schemas import CharacterCreate, CharacterOut, EquipRequest, GiveItemRequest, StatChangeOut, StatEditRequest, UseItemRequest, DiscardItemRequest
from app.services.campaign_engine import broadcast_character_updated, recalculate_character_hp
from app.services.character_stats import (
    effective_stats,
    equip_slot_for_item,
    is_bag_only_item,
    is_equippable,
    stacks_in_inventory,
    validate_point_buy,
    weapon_attack_bonus,
)

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
                "description": i.item_template.description if i.item_template else "",
                "stats": i.item_template.stats if i.item_template else {},
                "equipped_slot": i.equipped_slot,
                "quantity": i.quantity,
                "equippable": is_equippable(i.item_template) if i.item_template else False,
                "bag_only": is_bag_only_item(i.item_template) if i.item_template else True,
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
    if slot:
        if not inv.item_template or not is_equippable(inv.item_template):
            raise HTTPException(status_code=400, detail="This item cannot be equipped")
        allowed = equip_slot_for_item(inv.item_template)
        if slot != allowed:
            raise HTTPException(status_code=400, detail=f"This item must be equipped as {allowed}")
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


def _share_group(db: Session, character_id_a: int, character_id_b: int) -> bool:
    groups_a = {m.group_id for m in db.query(GroupMember).filter(GroupMember.character_id == character_id_a).all()}
    if not groups_a:
        return False
    return (
        db.query(GroupMember)
        .filter(GroupMember.character_id == character_id_b, GroupMember.group_id.in_(groups_a))
        .first()
        is not None
    )


@router.get("/me/party")
def get_party_members(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[dict[str, Any]]:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character")
    group_ids = [m.group_id for m in db.query(GroupMember).filter(GroupMember.character_id == character.id).all()]
    if not group_ids:
        return []
    members = (
        db.query(GroupMember)
        .filter(GroupMember.group_id.in_(group_ids), GroupMember.character_id != character.id)
        .all()
    )
    seen: set[int] = set()
    result = []
    for m in members:
        if m.character_id in seen:
            continue
        seen.add(m.character_id)
        c = db.get(Character, m.character_id)
        if c:
            result.append({"character_id": c.id, "name": c.name})
    return result


@router.post("/me/give-item", response_model=CharacterOut)
async def give_item_to_party_member(
    payload: GiveItemRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character")
    if payload.target_character_id == character.id:
        raise HTTPException(status_code=400, detail="Cannot give items to yourself")

    inv = db.get(InventoryItem, payload.inventory_item_id)
    if not inv or inv.character_id != character.id:
        raise HTTPException(status_code=404, detail="Item not found")
    if inv.equipped_slot:
        raise HTTPException(status_code=400, detail="Unequip the item before giving it away")

    target = db.get(Character, payload.target_character_id)
    if not target:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if not _share_group(db, character.id, target.id):
        raise HTTPException(status_code=400, detail="You can only give items to members of your group")

    qty = max(1, min(payload.quantity, inv.quantity))
    template = inv.item_template

    if template and stacks_in_inventory(template):
        inv.quantity -= qty
        if inv.quantity <= 0:
            db.delete(inv)
        existing_target = (
            db.query(InventoryItem)
            .filter(
                InventoryItem.character_id == target.id,
                InventoryItem.item_template_id == inv.item_template_id,
                InventoryItem.equipped_slot.is_(None),
            )
            .first()
        )
        if existing_target:
            existing_target.quantity += qty
        else:
            db.add(
                InventoryItem(
                    character_id=target.id,
                    item_template_id=inv.item_template_id,
                    quantity=qty,
                )
            )
    else:
        if qty != inv.quantity:
            raise HTTPException(status_code=400, detail="This item must be given in full")
        inv.character_id = target.id

    db.commit()
    await broadcast_character_updated(db, target.id)
    return _serialize_character(db, character)


@router.post("/me/use-item", response_model=CharacterOut)
async def use_item(
    payload: UseItemRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character")

    inv = db.get(InventoryItem, payload.inventory_item_id)
    if not inv or inv.character_id != character.id:
        raise HTTPException(status_code=404, detail="Item not found")
    if inv.equipped_slot:
        raise HTTPException(status_code=400, detail="Cannot use equipped items")
    template = inv.item_template
    if not template or template.item_type != "consumable":
        raise HTTPException(status_code=400, detail="This item cannot be used")

    stats = template.stats or {}
    heal = stats.get("heal", 0)
    if isinstance(heal, int) and heal > 0:
        character.current_hp = min(character.max_hp, character.current_hp + heal)

    if inv.quantity > 1:
        inv.quantity -= 1
    else:
        db.delete(inv)

    db.commit()
    return _serialize_character(db, character)


@router.post("/me/discard-item", response_model=CharacterOut)
def discard_item(
    payload: DiscardItemRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character")

    inv = db.get(InventoryItem, payload.inventory_item_id)
    if not inv or inv.character_id != character.id:
        raise HTTPException(status_code=404, detail="Item not found")

    was_equipped = bool(inv.equipped_slot)
    db.delete(inv)
    if was_equipped:
        recalculate_character_hp(db, character)

    db.commit()
    return _serialize_character(db, character)
