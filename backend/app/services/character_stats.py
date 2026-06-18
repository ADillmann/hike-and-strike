from app.game.constants import HP_BASE, HP_PER_DURABILITY, POINT_BUY_POOL, STAT_DEFAULT, STAT_MAX, STAT_MIN, STAT_NAMES


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


def armor_bonus_from_inventory(inventory_items) -> int:
    bonus = 0
    for inv in inventory_items:
        if inv.equipped_slot == "armor" and inv.item_template:
            bonus += inv.item_template.stats.get("armor_bonus", 0)
    return bonus


def compute_max_hp(durability: int, armor_bonus: int = 0) -> int:
    return HP_BASE + durability * HP_PER_DURABILITY + armor_bonus


def weapon_attack_bonus(inventory_items, stats: dict) -> int:
    weapon_damage = 0
    relevant_stat = stats.get("strength", STAT_DEFAULT)
    for inv in inventory_items:
        if inv.equipped_slot == "weapon" and inv.item_template:
            weapon_damage = inv.item_template.stats.get("damage", 0)
            if inv.item_template.stats.get("finesse"):
                relevant_stat = max(relevant_stat, stats.get("dexterity", STAT_DEFAULT))
            break
    return weapon_damage + relevant_stat // 3


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


def is_bag_only_item(item_template) -> bool:
    """Items that work from the bag and must not be equipped."""
    if not item_template:
        return True
    if item_template.item_type in ("consumable", "key", "spell"):
        return True
    stats = item_template.stats or {}
    if stats.get("passive"):
        return True
    # Stat-only accessories (e.g. "Bag power") have no weapon/armor role
    if item_template.item_type == "accessory":
        if not stats.get("damage") and not stats.get("armor_bonus"):
            return True
    return False


def is_equippable(item_template) -> bool:
    if not item_template:
        return False
    if is_bag_only_item(item_template):
        return False
    return item_template.item_type in ("weapon", "armor", "accessory")


def stacks_in_inventory(item_template) -> bool:
    """Only consumables merge into one stack; everything else is separate."""
    return bool(item_template and item_template.item_type == "consumable")


def equip_slot_for_item(item_template) -> str | None:
    if not is_equippable(item_template):
        return None
    if item_template.item_type == "weapon":
        return "weapon"
    if item_template.item_type == "armor":
        return "armor"
    return "accessory"
