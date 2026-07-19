from sqlalchemy.orm import Session

from app.game.constants import LEGACY_EQUIP_SLOTS
from app.models import BattlePreset, ClassTemplate, EffectTemplate, EnemyTemplate, EventTemplate, InventoryItem, ItemTemplate, SecretTemplate, Skill, SkillTemplate
from app.services.battle_presets import DEFAULT_BATTLE_PRESETS
from app.services.creation_settings import set_creation_bonus_points
from app.services.currency import get_system_currency_settings

SYSTEM_CLASSES = [
    (
        "Human",
        "Versatile and adaptable. A balanced foundation for any path.",
        {
            # 10 on combat/social tracks unlocks 1 melee + 1 range + 1 support at creation
            "strength": 10,
            "dexterity": 10,
            "intelligence": 10,
            "durability": 9,
            "charisma": 10,
            "initiative": 9,
        },
    ),
    (
        "Elf",
        "Graceful and sharp-minded. Favors agility and magic over brute force.",
        {
            "strength": 8,
            "dexterity": 11,
            "intelligence": 11,
            "durability": 8,
            "charisma": 9,
            "initiative": 10,
        },
    ),
    (
        "Orc",
        "Hardy and fierce. Built for melee power at the cost of subtlety.",
        {
            "strength": 12,
            "dexterity": 8,
            "intelligence": 8,
            "durability": 11,
            "charisma": 8,
            "initiative": 8,
        },
    ),
]

BASE_ITEMS = [
    ("Iron Sword", "weapon", 1, {"damage": 4, "weapon_class": "melee"}, "A reliable blade.", 120),
    ("Steel Longsword", "weapon", 2, {"damage": 6, "two_handed": True, "weapon_class": "melee"}, "A heavy two-handed sword.", 350),
    ("Short Bow", "weapon", 1, {"damage": 3, "weapon_class": "range", "two_handed": True, "range": 4}, "A simple hunting bow.", 140),
    ("Leather Cap", "head", 1, {"armor_bonus": 1}, "Simple head protection.", 80),
    ("Iron Helm", "head", 2, {"armor_bonus": 2}, "A sturdy helmet.", 200),
    ("Wooden Shield", "shield", 1, {"armor_bonus": 1}, "Basic shield for the off hand.", 100),
    ("Leather Armor", "armor", 1, {"armor_bonus": 2}, "Basic chest protection.", 150),
    ("Chain Mail", "armor", 2, {"armor_bonus": 4}, "Interlocking metal rings.", 500),
    ("Leather Gloves", "gloves", 1, {"armor_bonus": 1}, "Protects the hands.", 60),
    ("Leather Pants", "legs", 1, {"armor_bonus": 1}, "Sturdy leg wear.", 80),
    ("Travel Boots", "shoes", 1, {"armor_bonus": 1}, "Comfortable boots.", 70),
    ("Copper Ring", "ring", 1, {"initiative": 1}, "A simple band.", 50),
    ("Silver Ring", "ring", 2, {"charisma": 1}, "A polished silver ring.", 250),
    ("Iron Amulet", "necklace", 1, {"durability": 1}, "A plain amulet.", 90),
    ("Minor Heal Potion", "consumable", 1, {"heal": 5}, "Restores a little health.", 25),
    ("Torch", "consumable", 1, {}, "Lights the way.", 10),
    ("Rope", "key", 1, {}, "Fifty feet of sturdy rope.", 15),
    ("Arcane Missile Scroll", "spell", 2, {"damage": 5}, "A one-use spell.", 300),
]

BASE_ENEMIES = [
    ("Goblin", {"strength": 8, "dexterity": 10, "intelligence": 6, "durability": 8, "charisma": 6, "initiative": 12, "damage": 3}, "A small green raider."),
    ("Goblin King", {"strength": 12, "dexterity": 10, "intelligence": 8, "durability": 12, "charisma": 10, "initiative": 10, "damage": 5}, "Leader of the goblin pack."),
    ("Bandit", {"strength": 10, "dexterity": 11, "intelligence": 8, "durability": 9, "charisma": 7, "initiative": 11, "damage": 4}, "A highway robber."),
    ("Wolf", {"strength": 9, "dexterity": 14, "intelligence": 4, "durability": 8, "charisma": 4, "initiative": 14, "damage": 3}, "A hungry predator."),
    ("Skeleton", {"strength": 9, "dexterity": 8, "intelligence": 4, "durability": 10, "charisma": 4, "initiative": 8, "damage": 3, "armor_bonus": 1}, "Undead warrior."),
    ("Goblin Archer", {"strength": 7, "dexterity": 12, "intelligence": 6, "durability": 7, "charisma": 6, "initiative": 13, "damage": 3, "weapon_class": "range", "range": 4}, "A goblin with a short bow."),
]

BASE_SKILLS = [
    ("Heal", 3, "Restore ally HP in battle.", "heal", {"heal_base": 5}),
    ("Power Strike", 2, "A heavy melee attack.", "melee", {"bonus_damage": 3}),
    ("Dodge", 2, "Grant temporary shield HP that lasts until battle ends.", "support", {"support_mode": "shield", "shield_amount": 8}),
    ("Arcane Bolt", 3, "Ranged magical damage.", "range", {"bonus_damage": 0, "range_stat": "intelligence"}),
    ("Inspire", 2, "Boost an ally's stats for the rest of the battle.", "support", {"support_mode": "stat_boost", "stat": "charisma", "stat_bonus": 2}),
]

# name, description, label, stat_modifiers, battle_modifiers, is_buff, active_in_battle, cleared_on_rest, cleared_on_event
BASE_EFFECTS = [
    (
        "Exhausted",
        "You have not rested for a while; your body is tired.",
        "Exhausted",
        {},
        {"damage_dealt_mod": -3},
        False,
        True,
        True,
        False,
    ),
    (
        "Holy Aura",
        "Divine energy enhances healing magic in battle.",
        "Holy Aura",
        {},
        {"heal_mod": 3},
        True,
        True,
        False,
        False,
    ),
    (
        "Blessed",
        "A divine blessing bolsters presence.",
        "Blessed",
        {"charisma": 2},
        {},
        True,
        False,
        True,
        False,
    ),
]


def migrate_legacy_equipment(db: Session) -> None:
    for inv in db.query(InventoryItem).filter(InventoryItem.equipped_slot.isnot(None)).all():
        legacy = LEGACY_EQUIP_SLOTS.get(inv.equipped_slot)
        if legacy:
            inv.equipped_slot = legacy


def _ensure_system_items(db: Session) -> None:
    existing = {row.name: row for row in db.query(ItemTemplate).filter(ItemTemplate.is_system == True).all()}  # noqa: E712
    for name, itype, tier, stats, desc, base_price in BASE_ITEMS:
        if name not in existing:
            db.add(ItemTemplate(
                name=name, item_type=itype, tier=tier, stats=stats, description=desc,
                base_price=base_price, is_system=True,
            ))
        elif (existing[name].base_price or 0) <= 0:
            existing[name].base_price = base_price


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


def _ensure_system_effects(db: Session) -> None:
    existing = {row.name for row in db.query(EffectTemplate).filter(EffectTemplate.is_system == True).all()}  # noqa: E712
    for name, desc, label, stat_mods, battle_mods, is_buff, active_in_battle, cleared_on_rest, cleared_on_event in BASE_EFFECTS:
        if name not in existing:
            db.add(EffectTemplate(
                name=name,
                description=desc,
                label=label,
                stat_modifiers=stat_mods,
                battle_modifiers=battle_mods,
                is_buff=is_buff,
                active_in_battle=active_in_battle,
                cleared_on_rest=cleared_on_rest,
                cleared_on_event=cleared_on_event,
                is_system=True,
            ))


BASE_SECRETS = [
    (
        "Mysterious Box",
        "A sealed box with strange markings. Codeword puzzle for demo.",
        "codeword",
        {"answer": "moonlight", "case_sensitive": False},
        "intelligence",
        "d20_plus_stat",
        12,
        "A mystery box — I wonder what is inside!",
        "Nothing happens...",
        "That doesn't work.",
        {"xp": 0},
        True,
    ),
    (
        "Iron Vault",
        "A heavy vault with a numeric lock.",
        "number_lock",
        {"code": "48291", "length": 5},
        "dexterity",
        "stat_vs_dc",
        14,
        "A sturdy iron vault. A five-digit combination lock blocks the way.",
        "I do not know what to do with this.",
        "The lock does not budge.",
        {"xp": 100},
        True,
    ),
]


def _ensure_system_secrets(db: Session) -> None:
    existing = {row.name for row in db.query(SecretTemplate).filter(SecretTemplate.is_system == True).all()}  # noqa: E712
    for (
        name,
        desc,
        solver_type,
        solver_config,
        examine_stat,
        examine_mode,
        examine_dc,
        revealed_description,
        fail_examine,
        fail_solve,
        rewards,
        consume_on_solve,
    ) in BASE_SECRETS:
        if name not in existing:
            db.add(
                SecretTemplate(
                    name=name,
                    description=desc,
                    solver_type=solver_type,
                    solver_config=solver_config,
                    examine_stat=examine_stat,
                    examine_mode=examine_mode,
                    examine_dc=examine_dc,
                    revealed_description=revealed_description,
                    fail_message_examine=fail_examine,
                    fail_message_solve=fail_solve,
                    rewards=rewards,
                    consume_on_solve=consume_on_solve,
                    is_system=True,
                )
            )


def _ensure_secret_items(db: Session) -> None:
    secret_by_name = {row.name: row for row in db.query(SecretTemplate).filter(SecretTemplate.is_system == True).all()}  # noqa: E712
    links = [
        ("Mysterious Box", "secret", 1, "Mysterious Box", "Mysterious Box"),
        ("Iron Vault", "secret", 2, "Iron Vault", "Iron Vault"),
    ]
    for item_name, itype, tier, desc, secret_name in links:
        secret = secret_by_name.get(secret_name)
        if not secret:
            continue
        row = db.query(ItemTemplate).filter(ItemTemplate.name == item_name, ItemTemplate.is_system == True).first()  # noqa: E712
        if not row:
            db.add(
                ItemTemplate(
                    name=item_name,
                    item_type=itype,
                    tier=tier,
                    stats={},
                    description=desc,
                    secret_template_id=secret.id,
                    is_system=True,
                )
            )
        elif row.secret_template_id != secret.id:
            row.secret_template_id = secret.id
            row.item_type = itype


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


def _ensure_currency_settings(db: Session) -> None:
    get_system_currency_settings(db)


def _migrate_shop_event(db: Session) -> None:
    shop = db.query(EventTemplate).filter(EventTemplate.name == "Shop", EventTemplate.is_generic == True).first()  # noqa: E712
    if shop and shop.event_type != "shop":
        shop.event_type = "shop"
        shop.shop_config = {"allowed_tiers": [1, 2, 3], "buy_modifier_percent": 10}


def _ensure_system_classes(db: Session) -> None:
    by_name = {
        row.name: row
        for row in db.query(ClassTemplate).filter(ClassTemplate.is_system == True).all()  # noqa: E712
    }
    for name, description, base_stats in SYSTEM_CLASSES:
        row = by_name.get(name)
        if row:
            row.description = description
            row.base_stats = base_stats
            continue
        db.add(
            ClassTemplate(
                name=name,
                description=description,
                base_stats=base_stats,
                is_system=True,
                master_id=None,
            )
        )


def _ensure_creation_settings(db: Session) -> None:
    # Touch getter so default is readable; seed explicit value if missing
    from app.models import GameSetting
    from app.services.creation_settings import CREATION_BONUS_POINTS_KEY
    from app.game.constants import POINT_BUY_POOL

    if not db.get(GameSetting, CREATION_BONUS_POINTS_KEY):
        set_creation_bonus_points(db, POINT_BUY_POOL)


def seed_data(db: Session) -> None:
    if db.query(EventTemplate).filter(EventTemplate.is_generic == True).count() == 0:  # noqa: E712
        generic_events = [
            ("Bonfire", "A warm campfire. The party can rest and recover.", "rest"),
            ("House", "A safe shelter for the night.", "rest"),
            ("Shop", "A merchant offers goods for sale.", "shop"),
            ("City Square", "A bustling town center.", "generic"),
            ("Prison Cell", "Cold stone walls and iron bars.", "story"),
        ]
        for name, desc, etype in generic_events:
            shop_config = {"allowed_tiers": [1, 2, 3], "buy_modifier_percent": 10} if etype == "shop" else None
            db.add(EventTemplate(
                name=name, description=desc, event_type=etype, is_generic=True,
                master_id=None, shop_config=shop_config,
            ))

    _ensure_currency_settings(db)
    _ensure_creation_settings(db)
    _ensure_system_classes(db)
    _ensure_system_items(db)
    _ensure_system_enemies(db)
    _ensure_system_presets(db)
    _ensure_system_skills(db)
    _ensure_system_effects(db)
    _ensure_system_secrets(db)
    _ensure_secret_items(db)
    _migrate_shop_event(db)

    migrate_legacy_equipment(db)
    migrate_skill_effect_types(db)
    migrate_character_skills(db)
    db.commit()
