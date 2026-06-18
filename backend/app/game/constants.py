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

HP_BASE = 10
HP_PER_DURABILITY = 5

EQUIP_SLOTS = ("weapon", "armor", "accessory")

EVENT_TYPES = ("story", "puzzle", "rest", "generic", "battle_hook")
ITEM_TYPES = ("weapon", "armor", "spell", "consumable", "key")
CAMPAIGN_STATUSES = ("draft", "active", "paused", "completed")
OUTCOMES = ("success", "failure", "partial")
