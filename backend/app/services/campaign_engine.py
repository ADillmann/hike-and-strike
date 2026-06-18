import random
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import (
    Campaign,
    CampaignEventNode,
    Character,
    EventHistory,
    EventTemplate,
    GroupMember,
    InventoryItem,
    ItemTemplate,
    Skill,
    TemporaryEffect,
)
from app.services.character_stats import armor_bonus_from_inventory, compute_max_hp, stacks_in_inventory
from app.services.character_progression import campaign_has_active_battle, grant_xp, progression_fields
from app.websocket.manager import ws_manager


def get_campaign_party(db: Session, campaign: Campaign) -> list[Character]:
    return (
        db.query(Character)
        .join(GroupMember, GroupMember.character_id == Character.id)
        .filter(GroupMember.group_id == campaign.group_id)
        .options(
            joinedload(Character.inventory_items).joinedload(InventoryItem.item_template),
            joinedload(Character.skills),
            joinedload(Character.temporary_effects),
            joinedload(Character.user),
        )
        .all()
    )


def campaign_state_payload(db: Session, campaign: Campaign) -> dict[str, Any]:
    party = get_campaign_party(db, campaign)
    current = None
    if campaign.current_node_id:
        node = db.get(CampaignEventNode, campaign.current_node_id)
        if node:
            template = db.get(EventTemplate, node.event_template_id)
            current = {
                "node_id": node.id,
                "sort_order": node.sort_order,
                "label": node.label,
                "event": {
                    "id": template.id if template else None,
                    "name": template.name if template else None,
                    "description": template.description if template else None,
                    "event_type": template.event_type if template else None,
                    "images": template.images if template else [],
                },
            }
    return {
        "campaign_id": campaign.id,
        "name": campaign.name,
        "status": campaign.status,
        "current_node": current,
        "party": [_character_snapshot(c) for c in party],
    }


def _character_snapshot(character: Character) -> dict[str, Any]:
    return {
        "id": character.id,
        "name": character.name,
        "race": character.race,
        "username": character.user.username if character.user else None,
        "stats": character.stats,
        "max_hp": character.max_hp,
        "current_hp": character.current_hp,
        "portrait_path": character.portrait_path,
        **progression_fields(character),
    }


async def broadcast_campaign_state(db: Session, campaign_id: int) -> None:
    campaign = db.get(Campaign, campaign_id)
    if campaign:
        await ws_manager.broadcast(campaign_id, {"type": "campaign_state", "data": campaign_state_payload(db, campaign)})


async def broadcast_character_updated(db: Session, character_id: int, campaign_id: int | None = None) -> None:
    character = (
        db.query(Character)
        .options(joinedload(Character.user))
        .filter(Character.id == character_id)
        .first()
    )
    if not character:
        return
    payload = {"type": "character_updated", "data": _character_snapshot(character)}
    if campaign_id:
        await ws_manager.broadcast(campaign_id, payload)
    else:
        for cid in ws_manager.campaign_ids_for_character(character_id):
            await ws_manager.broadcast(cid, payload)


def grant_item(db: Session, character_id: int, item_template_id: int, equipped_slot: str | None = None) -> InventoryItem:
    template = db.get(ItemTemplate, item_template_id)
    if template and stacks_in_inventory(template) and not equipped_slot:
        existing = (
            db.query(InventoryItem)
            .filter(
                InventoryItem.character_id == character_id,
                InventoryItem.item_template_id == item_template_id,
                InventoryItem.equipped_slot.is_(None),
            )
            .first()
        )
        if existing:
            existing.quantity += 1
            return existing
    item = InventoryItem(
        character_id=character_id,
        item_template_id=item_template_id,
        equipped_slot=equipped_slot,
        quantity=1,
    )
    db.add(item)
    return item


def apply_rewards_and_punishments(
    db: Session,
    campaign: Campaign,
    rewards: dict | None,
    punishments: dict | None,
    master_id: int,
) -> None:
    party_ids = [c.id for c in get_campaign_party(db, campaign)]

    if rewards and rewards.get("xp"):
        if campaign_has_active_battle(db, campaign.id):
            raise ValueError("Cannot grant XP during an active battle")
        for entry in rewards.get("xp", []):
            char_id = entry.get("character_id")
            amount = entry.get("amount", 0)
            if not char_id or not isinstance(amount, (int, float)) or amount <= 0:
                continue
            character = db.get(Character, char_id)
            if character:
                grant_xp(db, character, int(amount), master_id, campaign.id)

    if rewards:
        for entry in rewards.get("items", []):
            char_id = entry.get("character_id")
            item_id = entry.get("item_template_id")
            if char_id and item_id:
                grant_item(db, char_id, item_id, entry.get("equipped_slot"))
        for entry in rewards.get("random_tier", []):
            tier = entry.get("tier", 1)
            count = entry.get("count", 1)
            targets = entry.get("character_ids") or party_ids
            pool = db.query(ItemTemplate).filter(ItemTemplate.tier == tier).all()
            if pool:
                for char_id in targets:
                    for _ in range(count):
                        item = random.choice(pool)
                        grant_item(db, char_id, item.id)
        for entry in rewards.get("temp_buffs", []):
            char_id = entry.get("character_id")
            if char_id:
                db.add(
                    TemporaryEffect(
                        character_id=char_id,
                        label=entry.get("label", "Buff"),
                        stat_modifiers=entry.get("stat_modifiers", {}),
                        cleared_on_rest=entry.get("cleared_on_rest", True),
                    )
                )

    if punishments:
        for entry in punishments.get("hp_reduction", []):
            char_id = entry.get("character_id")
            if not char_id:
                continue
            character = db.get(Character, char_id)
            if not character:
                continue
            if "amount" in entry:
                delta = entry["amount"]
                if isinstance(delta, (int, float)):
                    character.current_hp = max(
                        0,
                        min(character.max_hp, character.current_hp + int(delta)),
                    )
        for entry in punishments.get("temp_debuffs", []):
            char_id = entry.get("character_id")
            if char_id:
                db.add(
                    TemporaryEffect(
                        character_id=char_id,
                        label=entry.get("label", "Debuff"),
                        stat_modifiers=entry.get("stat_modifiers", {}),
                        cleared_on_rest=entry.get("cleared_on_rest", True),
                    )
                )
        for entry in punishments.get("remove_items", []):
            inv_id = entry.get("inventory_item_id")
            inv = db.get(InventoryItem, inv_id) if inv_id else None
            if inv:
                if inv.quantity > 1:
                    inv.quantity -= 1
                else:
                    db.delete(inv)


def apply_rest_to_party(db: Session, campaign: Campaign) -> None:
    for character in get_campaign_party(db, campaign):
        for skill in character.skills:
            skill.uses_remaining = skill.max_uses_per_rest
        for effect in list(character.temporary_effects):
            if effect.cleared_on_rest:
                db.delete(effect)


def clear_event_effects_for_party(db: Session, campaign: Campaign) -> None:
    for character in get_campaign_party(db, campaign):
        for effect in list(character.temporary_effects):
            if effect.cleared_on_event:
                db.delete(effect)


def get_active_campaign_for_character(db: Session, character_id: int) -> Campaign | None:
    group_ids = [m.group_id for m in db.query(GroupMember).filter(GroupMember.character_id == character_id).all()]
    if not group_ids:
        return None
    return (
        db.query(Campaign)
        .filter(Campaign.group_id.in_(group_ids), Campaign.status.in_(["active", "paused"]))
        .order_by(Campaign.id.desc())
        .first()
    )


def recalculate_character_hp(db: Session, character: Character, scale_current: bool = False) -> None:
    db.refresh(character, ["inventory_items"])
    for inv in character.inventory_items:
        db.refresh(inv, ["item_template"])
    armor = armor_bonus_from_inventory(character.inventory_items)
    durability = character.stats.get("durability", 8)
    old_max = character.max_hp
    character.max_hp = compute_max_hp(durability, armor)
    if scale_current and old_max > 0:
        ratio = character.current_hp / old_max
        character.current_hp = max(1, int(character.max_hp * ratio))
    else:
        character.current_hp = min(character.current_hp, character.max_hp)
