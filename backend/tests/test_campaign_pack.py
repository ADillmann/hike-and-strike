from pathlib import Path
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import (
    Campaign,
    CampaignEventNode,
    Character,
    ClassTemplate,
    EnemyTemplate,
    EventTemplate,
    Group,
    GroupMember,
    InventoryItem,
    ItemTemplate,
    Skill,
    SkillTemplate,
    User,
    UserRole,
)
from app.services import campaign_pack as camps
from app.services import settings_pack as packs


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _seed_world(db):
    master = User(username="master", password_hash="mh", role=UserRole.master)
    db.add(master)
    db.flush()

    skill = SkillTemplate(
        name="Power Slash",
        effect_type="melee",
        effect_params={"bonus_damage": 2},
        selectable_at_creation=True,
        is_system=True,
    )
    db.add(skill)
    db.flush()
    cls = ClassTemplate(name="Knight", description="Steel", base_stats={"strength": 12, "durability": 10}, is_system=True)
    db.add(cls)
    item = ItemTemplate(name="Knight Blade", item_type="weapon", tier=2, stats={"damage": 5}, is_system=True)
    db.add(item)
    db.add(EnemyTemplate(name="Goblin", stats={"damage": 2}, is_system=True, master_id=None))
    # Mid-run addition (delta)
    db.add(EnemyTemplate(name="Crystal Drake", stats={"damage": 6}, is_system=False, master_id=master.id))
    db.add(ItemTemplate(name="Drake Scale Armor", item_type="armor", tier=3, stats={"armor": 4}, is_system=False, master_id=master.id))
    db.flush()

    packs.set_applied_pack(db, {
        "name": "knight",
        "version": "1.0.0",
        "format_version": 1,
        "source": {"repo": "ADillmann/hike-and-strike-settings", "branch": "knight"},
        "template_names": {
            "classes": ["Knight"],
            "skills": ["Power Slash"],
            "effects": [],
            "secrets": [],
            "items": ["Knight Blade"],
            "enemies": ["Goblin"],
            "battle_presets": [],
        },
    })

    player = User(username="p1", password_hash="ph", role=UserRole.player, created_by_id=master.id)
    db.add(player)
    db.flush()
    character = Character(
        user_id=player.id,
        name="Sir Test",
        race="Knight",
        class_template_id=cls.id,
        stats={"strength": 14, "durability": 12},
        max_hp=70,
        current_hp=55,
        level=3,
        xp=120,
        wallet_copper=250,
    )
    db.add(character)
    db.flush()
    db.add(Skill(
        character_id=character.id,
        skill_template_id=skill.id,
        name="Power Slash",
        max_uses_per_rest=1,
        uses_remaining=1,
        slot_kind="melee",
    ))
    db.add(InventoryItem(character_id=character.id, item_template_id=item.id, quantity=1, equipped_slot="weapon"))
    armor = db.query(ItemTemplate).filter(ItemTemplate.name == "Drake Scale Armor").one()
    db.add(InventoryItem(character_id=character.id, item_template_id=armor.id, quantity=1, equipped_slot="armor"))

    event = EventTemplate(
        master_id=master.id,
        name="Forest Gate",
        description="A wooden gate",
        event_type="story",
    )
    db.add(event)
    db.flush()

    group = Group(name="Test Party", master_id=master.id)
    db.add(group)
    db.flush()
    db.add(GroupMember(group_id=group.id, character_id=character.id))

    campaign = Campaign(
        name="Test Run",
        group_id=group.id,
        master_id=master.id,
        status="active",
        layout_theme="knight",
    )
    db.add(campaign)
    db.flush()
    node = CampaignEventNode(campaign_id=campaign.id, event_template_id=event.id, sort_order=0, label="Start")
    db.add(node)
    db.flush()
    campaign.current_node_id = node.id
    db.commit()
    return master, campaign


def test_full_export_import_roundtrip(db, tmp_path: Path):
    master, campaign = _seed_world(db)
    camp_dir = tmp_path / "campaign"
    settings_dir = tmp_path / "settings"

    # Settings base on disk (without mid-run delta items)
    base_files = packs.build_pack_dict(db, name="knight", version="1.0.0", layout_theme="knight")
    # Strip delta names from base export for a realistic base pack
    base_files["enemies.json"]["enemies"] = [e for e in base_files["enemies.json"]["enemies"] if e["name"] == "Goblin"]
    base_files["items.json"]["items"] = [i for i in base_files["items.json"]["items"] if i["name"] == "Knight Blade"]
    packs.write_pack_to_directory(settings_dir, base_files)

    media_dir = camp_dir / "media"
    media_dir.mkdir(parents=True)
    pack = camps.build_campaign_pack(db, campaign_id=campaign.id, mode="full", media_dir=media_dir)
    assert pack["campaign.json"]["export_mode"] == "full"
    delta_enemies = [e["name"] for e in pack["settings_delta"]["enemies.json"]["enemies"]]
    assert "Crystal Drake" in delta_enemies
    assert pack["characters_full.json"]["characters"][0]["level"] == 3
    assert pack["characters_blank.json"]["characters"][0]["level"] == 1
    camps.write_campaign_pack(camp_dir, pack)

    loaded = camps.read_campaign_pack(camp_dir)
    settings_files = packs.read_pack_from_directory(settings_dir)
    result = camps.import_campaign_pack(
        db,
        loaded,
        master_id=master.id,
        reload_mode="full",
        settings_files=settings_files,
    )
    assert result["name"] == "Test Run"
    assert db.query(EnemyTemplate).filter(EnemyTemplate.name == "Crystal Drake").count() == 1
    char = db.query(Character).filter(Character.name == "Sir Test").one()
    assert char.level == 3
    assert char.current_hp == 55
    names = {inv.item_template.name for inv in char.inventory_items}
    assert "Knight Blade" in names
    assert "Drake Scale Armor" in names
    assert db.query(User).filter(User.role == UserRole.master).count() == 1
    assert db.query(Campaign).count() == 1


def test_blank_reload_skips_delta(db, tmp_path: Path):
    master, campaign = _seed_world(db)
    camp_dir = tmp_path / "campaign"
    settings_dir = tmp_path / "settings"

    base_files = packs.build_pack_dict(db, name="knight", version="1.0.0", layout_theme="knight")
    base_files["enemies.json"]["enemies"] = [e for e in base_files["enemies.json"]["enemies"] if e["name"] == "Goblin"]
    base_files["items.json"]["items"] = [i for i in base_files["items.json"]["items"] if i["name"] == "Knight Blade"]
    packs.write_pack_to_directory(settings_dir, base_files)

    media_dir = camp_dir / "media"
    media_dir.mkdir(parents=True)
    pack = camps.build_campaign_pack(db, campaign_id=campaign.id, mode="full", media_dir=media_dir)
    camps.write_campaign_pack(camp_dir, pack)

    loaded = camps.read_campaign_pack(camp_dir)
    settings_files = packs.read_pack_from_directory(settings_dir)
    camps.import_campaign_pack(
        db,
        loaded,
        master_id=master.id,
        reload_mode="blank",
        settings_files=settings_files,
    )

    assert db.query(EnemyTemplate).filter(EnemyTemplate.name == "Crystal Drake").count() == 0
    assert db.query(ItemTemplate).filter(ItemTemplate.name == "Drake Scale Armor").count() == 0
    char = db.query(Character).filter(Character.name == "Sir Test").one()
    assert char.level == 1
    assert char.wallet_copper == 0
    assert len(char.inventory_items) == 0
    assert any(s.name == "Power Slash" for s in char.skills)


def test_legacy_race_without_class_imports(db, tmp_path: Path):
    """Older characters used race labels (Dwarf) without a class template."""
    master = User(username="master", password_hash="mh", role=UserRole.master)
    db.add(master)
    db.flush()
    db.add(ClassTemplate(name="Human", description="", base_stats={"durability": 8}, is_system=True))
    db.add(SkillTemplate(name="Heal", effect_type="heal", selectable_at_creation=True, is_system=True))
    db.commit()

    settings_dir = tmp_path / "settings"
    packs.write_pack_to_directory(settings_dir, packs.build_pack_dict(db, name="base", version="1.0.0"))

    camp_dir = tmp_path / "campaign"
    camp_dir.mkdir()
    (camp_dir / "campaign.json").write_text(json.dumps({
        "format_version": 1,
        "name": "Legacy",
        "export_mode": "blank",
        "status": "draft",
        "layout_theme": "default",
        "current_node_sort_order": 0,
        "group_name": "G",
    }))
    (camp_dir / "events.json").write_text(json.dumps({"events": [{"name": "Start", "description": "", "event_type": "story"}]}))
    (camp_dir / "users.json").write_text(json.dumps({"users": [{"username": "p1", "password_hash": "x", "role": "player"}]}))
    (camp_dir / "groups.json").write_text(json.dumps({"groups": [{"name": "G", "member_usernames": ["p1"]}]}))
    (camp_dir / "campaign_nodes.json").write_text(json.dumps({"nodes": [{"sort_order": 0, "event_template_name": "Start"}]}))
    (camp_dir / "event_history.json").write_text(json.dumps({"history": []}))
    (camp_dir / "characters_blank.json").write_text(json.dumps({"characters": [{
        "username": "p1",
        "password_hash": "x",
        "character_name": "Pim",
        "class_template_name": "Dwarf",
        "race": "Dwarf",
        "stats": {"durability": 10},
        "max_hp": 60,
        "current_hp": 60,
        "level": 1,
        "starter_skills": [],
    }]}))
    (camp_dir / "characters_full.json").write_text(json.dumps({"characters": []}))
    (camp_dir / "settings_delta").mkdir()
    for name, payload in packs.empty_settings_delta_files().items():
        (camp_dir / "settings_delta" / name).write_text(json.dumps(payload))

    loaded = camps.read_campaign_pack(camp_dir)
    camps.import_campaign_pack(
        db,
        loaded,
        master_id=master.id,
        reload_mode="blank",
        settings_files=packs.read_pack_from_directory(settings_dir),
    )
    char = db.query(Character).filter(Character.name == "Pim").one()
    assert char.race == "Dwarf"
    assert char.class_template_id is None
