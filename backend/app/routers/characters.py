import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_master
from app.config import settings
from app.database import get_db
from app.game.constants import EQUIP_SLOTS, HAND_SLOTS, STAT_CAP, STAT_NAMES
from app.models import (
    Character,
    GroupMember,
    InventoryItem,
    ItemTemplate,
    Skill,
    SkillTemplate,
    StatChangeLog,
    TemporaryEffect,
    User,
    UserRole,
)
from app.schemas import (
    AllocateStatRequest,
    AssignSkillRequest,
    CharacterCreate,
    CharacterOut,
    DiscardItemRequest,
    EquipRequest,
    ExamineSecretItemRequest,
    GiveItemRequest,
    GrantXpRequest,
    ReleaseStatRequest,
    SecretInteractionOut,
    SecretSolveResponse,
    SolveSecretItemRequest,
    StatChangeOut,
    StatEditRequest,
    UseItemRequest,
    UseSkillRequest,
)
from app.services.character_progression import (
    allocate_stat_point,
    grant_xp,
    progression_fields,
    release_stat_point,
)
from app.services.skill_usage import use_skill_outside_battle
from app.services.skill_effects import skill_battle_meta, skill_from_template
from app.services.campaign_engine import broadcast_character_updated, recalculate_character_hp
from app.services.currency import format_price, format_wallet, get_system_currency_settings
from app.services.secret_engine import examine_secret_item, secret_inventory_payload, solve_secret_item
from app.services.character_stats import (
    effective_stats,
    equip_slots_for_item,
    get_item_in_slot,
    hand_is_occupied,
    is_bag_only_item,
    is_equippable,
    is_two_handed_weapon,
    normalize_equipped_slot,
    slot_label,
    stacks_in_inventory,
    validate_point_buy,
    weapon_attack_bonus,
)

router = APIRouter(prefix="/characters", tags=["characters"])


def _add_skill_templates(db: Session, character_id: int, template_ids: list[int]) -> None:
    for template_id in template_ids:
        template = db.get(SkillTemplate, template_id)
        if not template:
            raise HTTPException(status_code=400, detail=f"Unknown skill template {template_id}")
        existing = (
            db.query(Skill)
            .filter(Skill.character_id == character_id, Skill.skill_template_id == template_id)
            .first()
        )
        if existing:
            continue
        db.add(skill_from_template(character_id, template))


def _serialize_inventory_item(inv: InventoryItem, db: Session) -> dict[str, Any]:
    template = inv.item_template
    secret = template.secret_template if template else None
    is_secret = bool(template and template.item_type == "secret")
    state = inv.secret_state or {}
    revealed = bool(state.get("revealed"))
    description = template.description if template else ""
    if is_secret and not revealed:
        description = "???"
    settings = get_system_currency_settings(db)
    base_price = (template.base_price or 0) if template else 0
    entry: dict[str, Any] = {
        "id": inv.id,
        "item_template_id": inv.item_template_id,
        "name": template.name if template else None,
        "item_type": template.item_type if template else None,
        "tier": template.tier if template else None,
        "description": description,
        "stats": template.stats if template else {},
        "equipped_slot": normalize_equipped_slot(inv.equipped_slot),
        "quantity": inv.quantity,
        "equippable": is_equippable(template) if template else False,
        "bag_only": is_bag_only_item(template) if template else True,
        "equip_slots": equip_slots_for_item(template) if template else [],
        "base_price": base_price,
        "price_display": format_price(base_price, settings) if base_price > 0 else None,
    }
    if is_secret:
        entry.update(secret_inventory_payload(inv, secret))
    return entry


def _serialize_character(db: Session, character: Character) -> CharacterOut:
    db.refresh(character)
    character = (
        db.query(Character)
        .options(
            joinedload(Character.inventory_items).joinedload(InventoryItem.item_template).joinedload(ItemTemplate.secret_template),
            joinedload(Character.skills).joinedload(Skill.skill_template),
            joinedload(Character.temporary_effects),
            joinedload(Character.user),
        )
        .filter(Character.id == character.id)
        .first()
    )
    eff = effective_stats(character.stats, character.inventory_items, character.temporary_effects)
    prog = progression_fields(character)
    settings = get_system_currency_settings(db)
    wallet_copper = character.wallet_copper or 0
    return CharacterOut(
        id=character.id,
        user_id=character.user_id,
        name=character.name,
        race=character.race,
        portrait_path=character.portrait_path,
        stats=character.stats,
        max_hp=character.max_hp,
        current_hp=character.current_hp,
        **prog,
        wallet_display=format_wallet(wallet_copper, settings),
        effective_stats=eff,
        attack_bonus=weapon_attack_bonus(character.inventory_items, eff),
        username=character.user.username if character.user else None,
        skills=[
            {
                "id": s.id,
                "skill_template_id": s.skill_template_id,
                "name": s.name,
                "uses_remaining": s.uses_remaining,
                "max_uses_per_rest": s.max_uses_per_rest,
                **skill_battle_meta(s),
            }
            for s in character.skills
        ],
        inventory=[_serialize_inventory_item(i, db) for i in character.inventory_items],
        temporary_effects=[
            {
                "id": e.id,
                "label": e.label,
                "stat_modifiers": e.stat_modifiers,
                "battle_modifiers": e.battle_modifiers or {},
                "active_in_battle": e.active_in_battle,
                "cleared_on_rest": e.cleared_on_rest,
                "cleared_on_event": e.cleared_on_event,
            }
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
    if payload.skill_template_ids:
        _add_skill_templates(db, character.id, payload.skill_template_ids)
    elif payload.skills:
        for sk in payload.skills:
            template = db.query(SkillTemplate).filter(SkillTemplate.name == sk.name).first()
            if template:
                db.add(skill_from_template(character.id, template))
            else:
                db.add(
                    Skill(
                        character_id=character.id,
                        name=sk.name,
                        max_uses_per_rest=sk.max_uses_per_rest,
                        uses_remaining=sk.max_uses_per_rest,
                    )
                )
    else:
        defaults = (
            db.query(SkillTemplate)
            .filter(SkillTemplate.selectable_at_creation == True)  # noqa: E712
            .order_by(SkillTemplate.name)
            .limit(2)
            .all()
        )
        for template in defaults:
            db.add(skill_from_template(character.id, template))
    db.commit()
    return _serialize_character(db, character)


@router.post("/{character_id}/skills", response_model=CharacterOut)
def assign_skill(
    character_id: int,
    payload: AssignSkillRequest,
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    _add_skill_templates(db, character.id, [payload.skill_template_id])
    db.commit()
    return _serialize_character(db, character)


@router.delete("/{character_id}/skills/{skill_id}", response_model=CharacterOut)
def remove_skill(
    character_id: int,
    skill_id: int,
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    skill = db.get(Skill, skill_id)
    if not skill or skill.character_id != character.id:
        raise HTTPException(status_code=404, detail="Skill not found")
    db.delete(skill)
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
            if new_value > STAT_CAP:
                raise HTTPException(status_code=400, detail=f"{stat_name} cannot exceed {STAT_CAP}")
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


@router.delete("/{character_id}/effects/{effect_id}", response_model=CharacterOut)
async def remove_character_effect(
    character_id: int,
    effect_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
    campaign_id: int | None = None,
) -> CharacterOut:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    effect = db.get(TemporaryEffect, effect_id)
    if not effect or effect.character_id != character_id:
        raise HTTPException(status_code=404, detail="Effect not found")
    db.delete(effect)
    db.commit()
    await broadcast_character_updated(db, character.id, campaign_id)
    return _serialize_character(db, character)


@router.post("/me/allocate-stat", response_model=CharacterOut)
async def allocate_my_stat(
    payload: AllocateStatRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character yet")
    try:
        allocate_stat_point(db, character, payload.stat)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if payload.stat == "durability":
        recalculate_character_hp(db, character)
    db.commit()
    await broadcast_character_updated(db, character.id)
    return _serialize_character(db, character)


@router.post("/{character_id}/release-stat", response_model=CharacterOut)
async def release_character_stat(
    character_id: int,
    payload: ReleaseStatRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    try:
        release_stat_point(db, character, payload.stat, master.id, payload.campaign_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if payload.stat == "durability":
        recalculate_character_hp(db, character)
    db.commit()
    await broadcast_character_updated(db, character.id, payload.campaign_id)
    return _serialize_character(db, character)


@router.post("/{character_id}/grant-xp", response_model=CharacterOut)
async def grant_character_xp(
    character_id: int,
    payload: GrantXpRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    from app.services.character_progression import character_in_active_battle

    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    if character_in_active_battle(db, character.id):
        raise HTTPException(status_code=409, detail="Cannot grant XP during an active battle")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="XP amount must be positive")
    grant_xp(db, character, payload.amount, master.id, payload.campaign_id)
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


@router.get("/equipment-slots")
def list_equipment_slots() -> list[dict[str, str]]:
    return [{"id": s, "label": slot_label(s)} for s in EQUIP_SLOTS]


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

    db.refresh(character, ["inventory_items"])
    for row in character.inventory_items:
        db.refresh(row, ["item_template"])

    slot = normalize_equipped_slot(payload.slot) if payload.slot else None

    if slot and slot not in EQUIP_SLOTS:
        raise HTTPException(status_code=400, detail="Invalid slot")

    if slot:
        if not inv.item_template or not is_equippable(inv.item_template):
            raise HTTPException(status_code=400, detail="This item cannot be equipped")
        allowed = equip_slots_for_item(inv.item_template)
        if slot not in allowed:
            raise HTTPException(status_code=400, detail=f"This item cannot be equipped in {slot_label(slot)}")

        item_type = inv.item_template.item_type
        stats = inv.item_template.stats or {}
        two_handed = item_type == "weapon" and stats.get("two_handed")

        if item_type in ("weapon", "shield"):
            if slot not in HAND_SLOTS:
                raise HTTPException(status_code=400, detail="Weapons and shields can only be equipped in hands")
            if two_handed:
                for hand in HAND_SLOTS:
                    if hand_is_occupied(character.inventory_items, hand, except_id=inv.id):
                        raise HTTPException(status_code=400, detail="Two-handed weapons require both hands free")
                for hand in HAND_SLOTS:
                    existing = get_item_in_slot(character.inventory_items, hand)
                    if existing and existing.id != inv.id:
                        existing.equipped_slot = None
            else:
                if hand_is_occupied(character.inventory_items, slot, except_id=inv.id):
                    for hand in HAND_SLOTS:
                        existing = get_item_in_slot(character.inventory_items, hand)
                        if existing and existing.id != inv.id and is_two_handed_weapon(existing):
                            raise HTTPException(
                                status_code=400,
                                detail="Cannot equip while a two-handed weapon is wielded",
                            )
                existing = get_item_in_slot(character.inventory_items, slot)
                if existing and existing.id != inv.id:
                    existing.equipped_slot = None
        else:
            existing = get_item_in_slot(character.inventory_items, slot)
            if existing and existing.id != inv.id:
                existing.equipped_slot = None

        inv.equipped_slot = slot
    else:
        inv.equipped_slot = None

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
    result = [{"character_id": character.id, "name": character.name, "is_self": True}]
    if not group_ids:
        return result
    seen = {character.id}
    members = (
        db.query(GroupMember)
        .filter(GroupMember.group_id.in_(group_ids), GroupMember.character_id != character.id)
        .all()
    )
    for m in members:
        if m.character_id in seen:
            continue
        seen.add(m.character_id)
        c = db.get(Character, m.character_id)
        if c:
            result.append({"character_id": c.id, "name": c.name, "is_self": False})
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


@router.post("/me/use-skill", response_model=CharacterOut)
async def use_skill(
    payload: UseSkillRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CharacterOut:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        raise HTTPException(status_code=404, detail="No character")

    try:
        caster, target = use_skill_outside_battle(
            db,
            character,
            payload.skill_id,
            payload.target_character_id,
            share_group=_share_group,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.commit()
    if target.id != caster.id:
        await broadcast_character_updated(db, target.id)
    return _serialize_character(db, caster)


@router.post("/me/examine-secret-item", response_model=SecretInteractionOut)
async def examine_secret_item_endpoint(
    payload: ExamineSecretItemRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SecretInteractionOut:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = (
        db.query(Character)
        .options(
            joinedload(Character.inventory_items).joinedload(InventoryItem.item_template),
            joinedload(Character.temporary_effects),
        )
        .filter(Character.user_id == user.id)
        .first()
    )
    if not character:
        raise HTTPException(status_code=404, detail="No character")
    try:
        result = examine_secret_item(db, character, payload.inventory_item_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    await broadcast_character_updated(db, character.id)
    return SecretInteractionOut(**result)


@router.post("/me/solve-secret-item", response_model=SecretSolveResponse)
async def solve_secret_item_endpoint(
    payload: SolveSecretItemRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SecretSolveResponse:
    if user.role != UserRole.player:
        raise HTTPException(status_code=403, detail="Players only")
    character = (
        db.query(Character)
        .options(
            joinedload(Character.inventory_items).joinedload(InventoryItem.item_template),
            joinedload(Character.temporary_effects),
        )
        .filter(Character.user_id == user.id)
        .first()
    )
    if not character:
        raise HTTPException(status_code=404, detail="No character")
    try:
        result = solve_secret_item(db, character, payload.inventory_item_id, payload.guess)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    await broadcast_character_updated(db, character.id)
    return SecretSolveResponse(
        success=result["success"],
        message=result["message"],
        rewards_summary=result.get("rewards_summary", []),
        character=_serialize_character(db, character),
    )


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
