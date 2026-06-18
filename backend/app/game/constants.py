STAT_NAMES = (
    "strength",
    "dexterity",
    "intelligence",
    "durability",
    "charisma",
    "initiative",
)

POINT_BUY_POOL = 27
STAT_MIN = 8
STAT_MAX = 15
STAT_DEFAULT = 8

RACES = ["Human", "Elf", "Dwarf", "Halfling", "Orc", "Tiefling"]

STARTER_SKILLS = [
    {"name": "Heal", "max_uses_per_rest": 3},
    {"name": "Power Strike", "max_uses_per_rest": 2},
    {"name": "Dodge", "max_uses_per_rest": 2},
    {"name": "Arcane Bolt", "max_uses_per_rest": 3},
    {"name": "Inspire", "max_uses_per_rest": 2},
]

SKILL_EFFECT_TYPES = ("none", "heal", "melee", "range", "support")

SUPPORT_MODES = ("shield", "stat_boost")

# Legacy name → effect when skill_template_id is missing
LEGACY_SKILL_EFFECTS = {
    "Heal": "heal",
    "Power Strike": "melee",
    "Arcane Bolt": "range",
    "Dodge": "support",
    "Inspire": "support",
}

# Legacy effect_type values still accepted in battle
LEGACY_EFFECT_ALIASES = {
    "power_strike": "melee",
    "arcane_bolt": "range",
}

HP_BASE = 10
HP_PER_DURABILITY = 5

HAND_SLOTS = ("left_hand", "right_hand")

EQUIP_SLOTS = (
    "head",
    "left_hand",
    "right_hand",
    "armor",
    "gloves",
    "legs",
    "shoes",
    "ring_1",
    "ring_2",
    "necklace",
)

# Legacy slots from earlier versions
LEGACY_EQUIP_SLOTS = {"weapon": "right_hand", "accessory": "ring_1"}

EVENT_TYPES = ("story", "puzzle", "rest", "generic", "battle_hook")

ITEM_TYPES = (
    "weapon",
    "shield",
    "head",
    "armor",
    "gloves",
    "legs",
    "shoes",
    "ring",
    "necklace",
    "spell",
    "consumable",
    "key",
)

ARMOR_ITEM_TYPES = ("head", "armor", "gloves", "legs", "shoes", "shield")

CAMPAIGN_STATUSES = ("draft", "active", "paused", "completed")
OUTCOMES = ("success", "failure", "partial")
