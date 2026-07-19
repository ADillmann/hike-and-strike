import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Character, ClassTemplate, Skill, SkillTemplate, User, UserRole
from app.routers.characters import _learn_skill_from_scroll
from app.schemas import CharacterCreate, StarterSkillPick, StatsDict
from app.services.creation_settings import set_creation_bonus_points


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _character(db, **stat_overrides):
    user = User(username="slot_user", password_hash="x", role=UserRole.player)
    db.add(user)
    db.flush()
    stats = {
        "strength": 8,
        "dexterity": 8,
        "intelligence": 8,
        "durability": 8,
        "charisma": 8,
        "initiative": 8,
        **stat_overrides,
    }
    character = Character(user_id=user.id, name="Hero", race="Human", stats=stats, max_hp=20, current_hp=20)
    db.add(character)
    db.flush()
    return character


def _template(db, name, effect_type):
    t = SkillTemplate(name=name, effect_type=effect_type, selectable_at_creation=True, max_uses_per_rest=1)
    db.add(t)
    db.flush()
    return t


def test_learn_scroll_rejects_heal_without_slot(db):
    character = _character(db, intelligence=10, charisma=10)
    heal = _template(db, "Heal", "heal")
    with pytest.raises(HTTPException) as exc:
        _learn_skill_from_scroll(db, character, heal.id, None, None)
    assert "slot" in str(exc.value.detail).lower()


def test_learn_scroll_rejects_when_slots_full(db):
    character = _character(db, intelligence=10, charisma=10)
    first = _template(db, "Bolt", "range")
    heal = _template(db, "Heal", "heal")
    _learn_skill_from_scroll(db, character, first.id, None, None)
    db.flush()
    _learn_skill_from_scroll(db, character, heal.id, None, "support")
    db.flush()
    extra = _template(db, "Bolt2", "range")
    with pytest.raises(HTTPException) as exc:
        _learn_skill_from_scroll(db, character, extra.id, None, None)
    assert "slot" in str(exc.value.detail).lower()


def test_learn_scroll_works_after_stat_raise(db):
    character = _character(db, intelligence=10)
    first = _template(db, "Bolt", "range")
    second = _template(db, "Bolt2", "range")
    _learn_skill_from_scroll(db, character, first.id, None, None)
    db.flush()
    with pytest.raises(HTTPException):
        _learn_skill_from_scroll(db, character, second.id, None, None)
    character.stats = {**character.stats, "intelligence": 13}
    db.flush()
    _learn_skill_from_scroll(db, character, second.id, None, None)
    assert db.query(Skill).filter(Skill.character_id == character.id).count() == 2


def test_creation_two_heals_different_slots(db):
    from app.routers.characters import create_character

    class_tpl = ClassTemplate(
        name="Human",
        description="",
        base_stats={
            "strength": 10,
            "dexterity": 10,
            "intelligence": 10,
            "durability": 9,
            "charisma": 10,
            "initiative": 9,
        },
        is_system=True,
    )
    db.add(class_tpl)
    set_creation_bonus_points(db, 10)
    h1 = _template(db, "Heal", "heal")
    h2 = _template(db, "Mend", "heal")
    db.commit()

    user = User(username="create_user", password_hash="x", role=UserRole.player)
    db.add(user)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_character(
            CharacterCreate(
                name="Ada",
                class_template_id=class_tpl.id,
                stats=StatsDict(**class_tpl.base_stats),
                starter_skills=[
                    StarterSkillPick(skill_template_id=h1.id, slot_kind="range"),
                    StarterSkillPick(skill_template_id=h2.id, slot_kind="range"),
                ],
            ),
            user,
            db,
        )
    assert "slot" in str(exc.value.detail).lower()

    out = create_character(
        CharacterCreate(
            name="Ada",
            class_template_id=class_tpl.id,
            stats=StatsDict(**class_tpl.base_stats),
            starter_skills=[
                StarterSkillPick(skill_template_id=h1.id, slot_kind="range"),
                StarterSkillPick(skill_template_id=h2.id, slot_kind="support"),
            ],
        ),
        user,
        db,
    )
    assert len(out.skills) == 2
    kinds = {s["slot_kind"] for s in out.skills}
    assert kinds == {"range", "support"}


def test_creation_requires_exactly_two(db):
    from app.routers.characters import create_character

    class_tpl = ClassTemplate(
        name="Human",
        description="",
        base_stats={
            "strength": 10,
            "dexterity": 10,
            "intelligence": 10,
            "durability": 9,
            "charisma": 10,
            "initiative": 9,
        },
        is_system=True,
    )
    db.add(class_tpl)
    set_creation_bonus_points(db, 10)
    s1 = _template(db, "Power Strike", "melee")
    db.commit()
    user = User(username="create_user2", password_hash="x", role=UserRole.player)
    db.add(user)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_character(
            CharacterCreate(
                name="Bob",
                class_template_id=class_tpl.id,
                stats=StatsDict(**class_tpl.base_stats),
                starter_skills=[StarterSkillPick(skill_template_id=s1.id)],
            ),
            user,
            db,
        )
    assert "exactly 2" in str(exc.value.detail).lower()
