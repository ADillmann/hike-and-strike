from sqlalchemy.orm import Session

from app.game.constants import LEGACY_EQUIP_SLOTS
from app.models import BattlePreset, EnemyTemplate, EventTemplate, InventoryItem, ItemTemplate, Skill, SkillTemplate
from app.services.battle_presets import DEFAULT_BATTLE_PRESETS

BASE_ITEMS = [
    ("Iron Sword", "weapon", 1, {"damage": 4}, "A reliable blade."),
    ("Steel Longsword", "weapon", 2, {"damage": 6, "two_handed": True}, "A heavy two-handed sword."),
    ("Leather Cap", "head", 1, {"armor_bonus": 1}, "Simple head protection."),
    ("Iron Helm", "head", 2, {"armor_bonus": 2}, "A sturdy helmet."),
    ("Wooden Shield", "shield", 1, {"armor_bonus": 1}, "Basic shield for the off hand."),
    ("Leather Armor", "armor", 1, {"armor_bonus": 2}, "Basic chest protection."),
    ("Chain Mail", "armor", 2, {"armor_bonus": 4}, "Interlocking metal rings."),
    ("Leather Gloves", "gloves", 1, {"armor_bonus": 1}, "Protects the hands."),
    ("Leather Pants", "legs", 1, {"armor_bonus": 1}, "Sturdy leg wear."),
    ("Travel Boots", "shoes", 1, {"armor_bonus": 1}, "Comfortable boots."),
    ("Copper Ring", "ring", 1, {"initiative": 1}, "A simple band."),
    ("Silver Ring", "ring", 2, {"charisma": 1}, "A polished silver ring."),
    ("Iron Amulet", "necklace", 1, {"durability": 1}, "A plain amulet."),
    ("Minor Heal Potion", "consumable", 1, {"heal": 5}, "Restores a little health."),
    ("Torch", "consumable", 1, {}, "Lights the way."),
    ("Rope", "key", 1, {}, "Fifty feet of sturdy rope."),
    ("Arcane Missile Scroll", "spell", 2, {"damage": 5}, "A one-use spell."),
]

BASE_ENEMIES = [
    ("Goblin", {"strength": 8, "dexterity": 10, "intelligence": 6, "durability": 8, "charisma": 6, "initiative": 12, "damage": 3}, "A small green raider."),
    ("Goblin King", {"strength": 12, "dexterity": 10, "intelligence": 8, "durability": 12, "charisma": 10, "initiative": 10, "damage": 5}, "Leader of the goblin pack."),
    ("Bandit", {"strength": 10, "dexterity": 11, "intelligence": 8, "durability": 9, "charisma": 7, "initiative": 11, "damage": 4}, "A highway robber."),
    ("Wolf", {"strength": 9, "dexterity": 14, "intelligence": 4, "durability": 8, "charisma": 4, "initiative": 14, "damage": 3}, "A hungry predator."),
    ("Skeleton", {"strength": 9, "dexterity": 8, "intelligence": 4, "durability": 10, "charisma": 4, "initiative": 8, "damage": 3, "armor_bonus": 1}, "Undead warrior."),
]

BASE_SKILLS = [
    ("Heal", 3, "Restore ally HP in battle.", "heal", {"heal_base": 5}),
    ("Power Strike", 2, "A heavy melee attack.", "melee", {"bonus_damage": 3}),
    ("Dodge", 2, "Grant temporary shield HP that lasts until battle ends.", "support", {"support_mode": "shield", "shield_amount": 8}),
    ("Arcane Bolt", 3, "Ranged magical damage.", "range", {"bonus_damage": 0, "range_stat": "intelligence"}),
    ("Inspire", 2, "Boost an ally's stats for the rest of the battle.", "support", {"support_mode": "stat_boost", "stat": "charisma", "stat_bonus": 2}),
]


def migrate_legacy_equipment(db: Session) -> None:
    for inv in db.query(InventoryItem).filter(InventoryItem.equipped_slot.isnot(None)).all():
        legacy = LEGACY_EQUIP_SLOTS.get(inv.equipped_slot)
        if legacy:
            inv.equipped_slot = legacy


def _ensure_system_items(db: Session) -> None:
    existing = {row.name for row in db.query(ItemTemplate).filter(ItemTemplate.is_system == True).all()}  # noqa: E712
    for name, itype, tier, stats, desc in BASE_ITEMS:
        if name not in existing:
            db.add(ItemTemplate(name=name, item_type=itype, tier=tier, stats=stats, description=desc, is_system=True))


def _ensure_system_enemies(db: Session) -> None:
    existing = {row.name for row in db.query(EnemyTemplate).filter(EnemyTemplate.is_system == True).all()}  # noqa: E712
    for name, stats, desc in BASE_ENEMIES:
        if name not in existing:
            db.add(EnemyTemplate(name=name, stats=stats, description=desc, is_system=True))


def _ensure_system_presets(db: Session) -> None:
    existing = {row.id for row in db.query(BattlePreset).all()}
    for preset_id, data in DEFAULT_BATTLE_PRESETS.items():
        if preset_id not in existing:
            db.add(BattlePreset(
                id=preset_id,
                name=data["name"],
                enemies=data["enemies"],
                is_system=True,
            ))


def _ensure_system_skills(db: Session) -> None:
    existing = {row.name for row in db.query(SkillTemplate).filter(SkillTemplate.is_system == True).all()}  # noqa: E712
    for name, max_uses, desc, effect_type, params in BASE_SKILLS:
        if name not in existing:
            db.add(SkillTemplate(
                name=name,
                description=desc,
                max_uses_per_rest=max_uses,
                effect_type=effect_type,
                effect_params=params,
                selectable_at_creation=True,
                is_system=True,
            ))


def migrate_character_skills(db: Session) -> None:
    for skill in db.query(Skill).filter(Skill.skill_template_id.is_(None)).all():
        template = db.query(SkillTemplate).filter(SkillTemplate.name == skill.name).first()
        if template:
            skill.skill_template_id = template.id


def migrate_skill_effect_types(db: Session) -> None:
    from app.game.constants import LEGACY_EFFECT_ALIASES

    for template in db.query(SkillTemplate).all():
        if template.effect_type in LEGACY_EFFECT_ALIASES:
            template.effect_type = LEGACY_EFFECT_ALIASES[template.effect_type]
    by_name = {
        "Dodge": ("support", {"support_mode": "shield", "shield_amount": 8}),
        "Inspire": ("support", {"support_mode": "stat_boost", "stat": "charisma", "stat_bonus": 2}),
        "Power Strike": ("melee", {"bonus_damage": 3}),
        "Arcane Bolt": ("range", {"bonus_damage": 0, "range_stat": "intelligence"}),
    }
    for name, (effect_type, params) in by_name.items():
        row = db.query(SkillTemplate).filter(SkillTemplate.name == name, SkillTemplate.is_system == True).first()  # noqa: E712
        if row:
            row.effect_type = effect_type
            row.effect_params = params


def seed_data(db: Session) -> None:
    if db.query(EventTemplate).filter(EventTemplate.is_generic == True).count() == 0:  # noqa: E712
        generic_events = [
            ("Bonfire", "A warm campfire. The party can rest and recover.", "rest"),
            ("House", "A safe shelter for the night.", "rest"),
            ("Shop", "A merchant offers goods for sale.", "generic"),
            ("City Square", "A bustling town center.", "generic"),
            ("Prison Cell", "Cold stone walls and iron bars.", "story"),
        ]
        for name, desc, etype in generic_events:
            db.add(EventTemplate(name=name, description=desc, event_type=etype, is_generic=True, master_id=None))

    _ensure_system_items(db)
    _ensure_system_enemies(db)
    _ensure_system_presets(db)
    _ensure_system_skills(db)

    migrate_legacy_equipment(db)
    migrate_skill_effect_types(db)
    migrate_character_skills(db)
    db.commit()
