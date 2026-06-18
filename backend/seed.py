from sqlalchemy.orm import Session

from app.models import EventTemplate, ItemTemplate


def seed_data(db: Session) -> None:
    if db.query(EventTemplate).filter(EventTemplate.is_generic == True).count() > 0:  # noqa: E712
        return

    generic_events = [
        ("Bonfire", "A warm campfire. The party can rest and recover.", "rest"),
        ("House", "A safe shelter for the night.", "rest"),
        ("Shop", "A merchant offers goods for sale.", "generic"),
        ("City Square", "A bustling town center.", "generic"),
        ("Prison Cell", "Cold stone walls and iron bars.", "story"),
    ]
    for name, desc, etype in generic_events:
        db.add(EventTemplate(name=name, description=desc, event_type=etype, is_generic=True, master_id=None))

    base_items = [
        ("Iron Sword", "weapon", 1, {"damage": 4}, "A reliable blade."),
        ("Leather Armor", "armor", 1, {"armor_bonus": 2}, "Basic protection."),
        ("Minor Heal Potion", "consumable", 1, {"heal": 5}, "Restores a little health."),
        ("Torch", "consumable", 1, {}, "Lights the way."),
        ("Rope", "key", 1, {}, "Fifty feet of sturdy rope."),
        ("Steel Longsword", "weapon", 2, {"damage": 6}, "A well-forged sword."),
        ("Chain Mail", "armor", 2, {"armor_bonus": 4}, "Interlocking metal rings."),
        ("Arcane Missile Scroll", "spell", 2, {"damage": 5, "intelligence": 1}, "A one-use spell."),
    ]
    for name, itype, tier, stats, desc in base_items:
        db.add(ItemTemplate(name=name, item_type=itype, tier=tier, stats=stats, description=desc, is_system=True))

    db.commit()
