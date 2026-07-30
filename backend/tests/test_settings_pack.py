from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import (
    ClassTemplate,
    CurrencySettings,
    EnemyTemplate,
    ItemTemplate,
    SkillTemplate,
    User,
    UserRole,
)
from app.services import settings_pack as packs
from seed import seed_data


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def test_export_import_directory_roundtrip_remaps_names(db, tmp_path: Path):
    master = User(username="master", password_hash="x", role=UserRole.master)
    db.add(master)
    db.flush()

    db.add(User(username="p1", password_hash="x", role=UserRole.player))
    db.flush()

    skill = SkillTemplate(name="Power Slash", effect_type="melee", effect_params={"bonus_damage": 2}, is_system=True)
    db.add(skill)
    db.flush()
    db.add(ItemTemplate(name="Knight Blade", item_type="weapon", tier=2, stats={"damage": 5}, is_system=True))
    db.add(ClassTemplate(name="Knight", description="Steel", base_stats={"strength": 12}, is_system=True))
    db.add(EnemyTemplate(
        name="Crystal Drake",
        stats={"damage": 6, "skill_template_ids": [skill.id]},
        is_system=False,
        master_id=master.id,
    ))
    db.add(CurrencySettings(
        is_system=True,
        tier1_name="Shard",
        tier2_name="Crown",
        tier3_name="Sovereign",
        copper_per_silver=10,
        silver_per_gold=10,
    ))
    db.commit()

    files = packs.build_pack_dict(db, name="knight", version="1.0.0", layout_theme="knight")
    assert files["pack.json"]["name"] == "knight"
    assert files["enemies.json"]["enemies"][0]["stats"]["skill_template_names"] == ["Power Slash"]

    written = packs.write_pack_to_directory(tmp_path, files)
    assert "pack.json" in written
    assert (tmp_path / "enemies.json").is_file()

    loaded = packs.read_pack_from_directory(tmp_path)
    meta = packs.import_pack_dict(db, loaded, master_id=master.id)
    assert meta["name"] == "knight"
    assert packs.custom_pack_active(db)

    assert db.query(User).filter(User.role == UserRole.player).count() == 0
    assert db.query(User).filter(User.role == UserRole.master).count() == 1

    enemy = db.query(EnemyTemplate).filter(EnemyTemplate.name == "Crystal Drake").one()
    skill2 = db.query(SkillTemplate).filter(SkillTemplate.name == "Power Slash").one()
    assert enemy.stats["skill_template_ids"] == [skill2.id]
    assert db.query(ItemTemplate).filter(ItemTemplate.name == "Knight Blade").count() == 1

    before_items = db.query(ItemTemplate).count()
    seed_data(db)
    assert db.query(ItemTemplate).count() == before_items


def test_parse_remote_repo_urls():
    gh = packs.parse_remote_repo("https://github.com/ADillmann/hike-and-strike-settings.git")
    assert gh["forge"] == "github"
    assert gh["project_path"] == "ADillmann/hike-and-strike-settings"
    assert packs.raw_pack_file_url(
        forge="github",
        host="github.com",
        project_path=gh["project_path"],
        branch="knight",
        rel_path="pack.json",
    ) == "https://raw.githubusercontent.com/ADillmann/hike-and-strike-settings/knight/pack.json"

    shorthand = packs.parse_remote_repo("ADillmann/hike-and-strike-settings")
    assert shorthand["forge"] == "github"
    assert shorthand["project_path"] == "ADillmann/hike-and-strike-settings"

    gl = packs.parse_remote_repo("https://gitlab.com/group/my-settings")
    assert gl["forge"] == "gitlab"
    assert packs.raw_pack_file_url(
        forge="gitlab",
        host="gitlab.com",
        project_path="group/my-settings",
        branch="main",
        rel_path="classes.json",
    ) == "https://gitlab.com/group/my-settings/-/raw/main/classes.json"

    cb = packs.parse_remote_repo("https://codeberg.org/user/settings-pack")
    assert cb["forge"] == "gitea"
    assert packs.raw_pack_file_url(
        forge="gitea",
        host="codeberg.org",
        project_path="user/settings-pack",
        branch="knight",
        rel_path="items.json",
    ) == "https://codeberg.org/user/settings-pack/raw/branch/knight/items.json"
