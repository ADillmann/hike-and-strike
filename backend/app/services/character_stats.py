import re

from app.game.constants import (
    ARMOR_ITEM_TYPES,
    BATTLE_MODIFIER_KEYS,
    EQUIP_SLOTS,
    HAND_SLOTS,
    HP_BASE,
    HP_PER_DURABILITY,
    LEGACY_EQUIP_SLOTS,
    POINT_BUY_POOL,
    STAT_DEFAULT,
    STAT_MAX,
    STAT_MIN,
    STAT_NAMES,
)


def point_cost(value: int) -> int:
    if value <= 13:
        return value - STAT_DEFAULT
    return (value - STAT_DEFAULT) + (value - 13)


def total_point_cost(stats: dict[str, int]) -> int:
    return sum(point_cost(stats.get(s, STAT_DEFAULT)) for s in STAT_NAMES)


def validate_point_buy(stats: dict[str, int]) -> None:
    for name in STAT_NAMES:
        val = stats.get(name, STAT_DEFAULT)
        if val < STAT_MIN or val > STAT_MAX:
            raise ValueError(f"{name} must be between {STAT_MIN} and {STAT_MAX}")
    if total_point_cost(stats) > POINT_BUY_POOL:
        raise ValueError(f"Point buy exceeds pool of {POINT_BUY_POOL}")


def normalize_equipped_slot(slot: str | None) -> str | None:
    if not slot:
        return None
    return LEGACY_EQUIP_SLOTS.get(slot, slot)


def is_two_handed_weapon(inventory_item) -> bool:
    if not inventory_item or not inventory_item.item_template:
        return False
    if inventory_item.item_template.item_type != "weapon":
        return False
    return bool((inventory_item.item_template.stats or {}).get("two_handed"))


def hand_is_occupied(inventory_items, hand: str, except_id: int | None = None) -> bool:
    hand = normalize_equipped_slot(hand)
    for inv in inventory_items:
        if except_id and inv.id == except_id:
            continue
        if not inv.equipped_slot:
            continue
        slot = normalize_equipped_slot(inv.equipped_slot)
        if slot == hand:
            return True
        if is_two_handed_weapon(inv) and slot in HAND_SLOTS:
            return True
    return False


def get_item_in_slot(inventory_items, slot: str):
    slot = normalize_equipped_slot(slot)
    for inv in inventory_items:
        if normalize_equipped_slot(inv.equipped_slot) == slot:
            return inv
    return None


def armor_bonus_from_inventory(inventory_items) -> int:
    bonus = 0
    for inv in inventory_items:
        if not inv.equipped_slot or not inv.item_template:
            continue
        if inv.item_template.item_type in ARMOR_ITEM_TYPES:
            bonus += inv.item_template.stats.get("armor_bonus", 0)
    return bonus


def compute_max_hp(durability: int, armor_bonus: int = 0) -> int:
    return HP_BASE + durability * HP_PER_DURABILITY + armor_bonus


DEFAULT_WEAPON_RANGE = 4


def weapon_class(item_template) -> str:
    if not item_template or item_template.item_type != "weapon":
        return "melee"
    return (item_template.stats or {}).get("weapon_class", "melee")


def is_ranged_weapon(inventory_item) -> bool:
    if not inventory_item or not inventory_item.item_template:
        return False
    if inventory_item.item_template.item_type != "weapon":
        return False
    return weapon_class(inventory_item.item_template) == "range"


def equipped_weapon_profile(inventory_items, stats: dict) -> dict:
    hand_items = []
    for inv in inventory_items:
        if not inv.equipped_slot or not inv.item_template:
            continue
        slot = normalize_equipped_slot(inv.equipped_slot)
        if slot not in HAND_SLOTS:
            continue
        if inv.item_template.item_type in ("weapon", "shield"):
            hand_items.append(inv)

    for inv in hand_items:
        if inv.item_template.item_type != "weapon":
            continue
        if weapon_class(inv.item_template) != "range":
            continue
        ws = inv.item_template.stats or {}
        damage = int(ws.get("damage", 0))
        dex = stats.get("dexterity", STAT_DEFAULT)
        weapon_range = int(ws.get("range", DEFAULT_WEAPON_RANGE))
        return {
            "can_melee": False,
            "can_ranged": True,
            "melee_attack_bonus": 0,
            "ranged_attack_bonus": damage + dex // 3,
            "weapon_range": weapon_range,
        }

    weapon_damage = 0
    has_shield = False
    relevant_stat = stats.get("strength", STAT_DEFAULT)
    for inv in hand_items:
        tmpl = inv.item_template
        if tmpl.item_type == "shield":
            has_shield = True
            damage = max(int(tmpl.stats.get("damage", 0)), 1)
            weapon_damage = max(weapon_damage, damage)
            continue
        if tmpl.item_type == "weapon" and weapon_class(tmpl) == "melee":
            damage = int(tmpl.stats.get("damage", 0))
            weapon_damage = max(weapon_damage, damage)
            if tmpl.stats.get("finesse"):
                relevant_stat = max(relevant_stat, stats.get("dexterity", STAT_DEFAULT))

    if weapon_damage > 0 or has_shield:
        melee_bonus = weapon_damage + relevant_stat // 3
    else:
        melee_bonus = max(1, stats.get("strength", STAT_DEFAULT) // 3)

    return {
        "can_melee": True,
        "can_ranged": False,
        "melee_attack_bonus": melee_bonus,
        "ranged_attack_bonus": 0,
        "weapon_range": DEFAULT_WEAPON_RANGE,
    }


def weapon_attack_bonus(inventory_items, stats: dict) -> int:
    return equipped_weapon_profile(inventory_items, stats)["melee_attack_bonus"]


def effective_stats(base_stats: dict, inventory_items, temporary_effects) -> dict[str, int]:
    result = {s: base_stats.get(s, STAT_DEFAULT) for s in STAT_NAMES}
    for inv in inventory_items:
        if not inv.item_template or not inv.item_template.stats:
            continue
        stats = inv.item_template.stats
        if not inv.equipped_slot and not is_bag_only_item(inv.item_template):
            continue
        for key, val in stats.items():
            if key in result and isinstance(val, int):
                result[key] += val
    for effect in temporary_effects:
        for key, val in (effect.stat_modifiers or {}).items():
            if key in result and isinstance(val, int):
                result[key] += val
    return result


def aggregate_battle_modifiers(temporary_effects) -> dict[str, int]:
    totals: dict[str, int] = {key: 0 for key in BATTLE_MODIFIER_KEYS}
    for effect in temporary_effects:
        if not effect.active_in_battle:
            continue
        for key in BATTLE_MODIFIER_KEYS:
            val = (effect.battle_modifiers or {}).get(key)
            if isinstance(val, (int, float)):
                totals[key] += int(val)
    return {k: v for k, v in totals.items() if v != 0}


def _label_allsight_level(label: str) -> int:
    normalized = (label or "").strip().lower()
    if re.search(r"allsight\s*(ii|2)\b", normalized):
        return 2
    if re.search(r"allsight\s*(i|1)\b", normalized):
        return 1
    return 0


def effect_allsight_level(effect) -> int:
    if not getattr(effect, "active_in_battle", False):
        return 0
    val = (getattr(effect, "battle_modifiers", None) or {}).get("allsight")
    if isinstance(val, (int, float)):
        if val >= 2:
            return 2
        if val >= 1:
            return 1
    return _label_allsight_level(getattr(effect, "label", "") or "")


def party_allsight_level_from_characters(characters) -> int:
    level = 0
    for character in characters:
        for effect in getattr(character, "temporary_effects", []) or []:
            level = max(level, effect_allsight_level(effect))
    return level


def is_bag_only_item(item_template) -> bool:
    if not item_template:
        return True
    if item_template.item_type in ("consumable", "key", "spell", "secret"):
        return True
    stats = item_template.stats or {}
    if stats.get("passive"):
        return True
    return False


def is_equippable(item_template) -> bool:
    if not item_template:
        return False
    if is_bag_only_item(item_template):
        return False
    return item_template.item_type in (
        "weapon",
        "shield",
        "head",
        "armor",
        "gloves",
        "legs",
        "shoes",
        "ring",
        "necklace",
    )


def stacks_in_inventory(item_template) -> bool:
    return bool(item_template and item_template.item_type == "consumable")


def equip_slots_for_item(item_template) -> list[str]:
    if not is_equippable(item_template):
        return []
    mapping = {
        "head": ["head"],
        "armor": ["armor"],
        "gloves": ["gloves"],
        "legs": ["legs"],
        "shoes": ["shoes"],
        "necklace": ["necklace"],
        "ring": ["ring_1", "ring_2"],
        "weapon": list(HAND_SLOTS),
        "shield": list(HAND_SLOTS),
    }
    return mapping.get(item_template.item_type, [])


def slot_label(slot: str) -> str:
    labels = {
        "head": "Head",
        "left_hand": "Left hand",
        "right_hand": "Right hand",
        "armor": "Armor",
        "gloves": "Gloves",
        "legs": "Legs",
        "shoes": "Shoes",
        "ring_1": "Ring 1",
        "ring_2": "Ring 2",
        "necklace": "Necklace",
    }
    return labels.get(slot, slot.replace("_", " ").title())
