import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.game.constants import MAX_CHARACTER_SKILLS
from app.models import Character, InventoryItem, ItemTemplate, Skill, SkillTemplate, User, UserRole
from app.routers.characters import _learn_skill_from_scroll
from app.routers.items import _validate_item_payload
from app.schemas import ItemTemplateCreate


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _character(db, name="Hero"):
    user = User(username=f"user_{name}", password_hash="x", role=UserRole.player)
    db.add(user)
    db.flush()
    character = Character(
        user_id=user.id,
        name=name,
        race="Human",
        stats={
            "strength": 15,
            "dexterity": 15,
            "intelligence": 20,
            "durability": 10,
            "charisma": 20,
            "initiative": 10,
        },
        max_hp=20,
        current_hp=10,
    )
    db.add(character)
    db.flush()
    return character


def _skill_template(db, name="Fireball"):
    template = SkillTemplate(name=name, description="Burn", max_uses_per_rest=2, effect_type="range")
    db.add(template)
    db.flush()
    return template


def _scroll(db, skill_template_id, heal=0, name="Scroll"):
    stats = {}
    if heal:
        stats["heal"] = heal
    template = ItemTemplate(
        name=name,
        item_type="consumable",
        tier=1,
        stats=stats,
        skill_template_id=skill_template_id,
    )
    db.add(template)
    db.flush()
    return template


def _inventory(db, character_id, item_template_id):
    inv = InventoryItem(character_id=character_id, item_template_id=item_template_id, quantity=1)
    db.add(inv)
    db.flush()
    return inv


def _add_skills(db, character_id, count, prefix="Skill"):
    for i in range(count):
        st = SkillTemplate(name=f"{prefix}{i}", max_uses_per_rest=1, effect_type="none")
        db.add(st)
        db.flush()
        db.add(
            Skill(
                character_id=character_id,
                skill_template_id=st.id,
                name=st.name,
                max_uses_per_rest=1,
                uses_remaining=1,
                slot_kind="support",
            )
        )
    db.flush()


def test_learn_skill_from_scroll_adds_skill(db):
    character = _character(db)
    skill = _skill_template(db, "Arcane Bolt")
    _learn_skill_from_scroll(db, character, skill.id, None, None)
    db.commit()
    learned = db.query(Skill).filter(Skill.character_id == character.id).all()
    assert len(learned) == 1
    assert learned[0].skill_template_id == skill.id
    assert learned[0].name == "Arcane Bolt"
    assert learned[0].slot_kind == "range"


def test_learn_skill_from_scroll_rejects_duplicate(db):
    character = _character(db)
    skill = _skill_template(db)
    _learn_skill_from_scroll(db, character, skill.id, None, None)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        _learn_skill_from_scroll(db, character, skill.id, None, None)
    assert exc.value.status_code == 400
    assert exc.value.detail == "You already know this spell"
    assert db.query(Skill).filter(Skill.character_id == character.id).count() == 1


def test_learn_skill_from_scroll_requires_replacement_at_cap(db):
    character = _character(db)
    _add_skills(db, character.id, MAX_CHARACTER_SKILLS)
    new_skill = _skill_template(db, "New Spell")
    with pytest.raises(HTTPException) as exc:
        _learn_skill_from_scroll(db, character, new_skill.id, None, None)
    assert exc.value.status_code == 409
    detail = exc.value.detail
    assert detail["code"] == "skill_cap_reached"
    assert len(detail["skills"]) == MAX_CHARACTER_SKILLS
    assert detail["skill_to_learn"]["name"] == "New Spell"


def test_learn_skill_from_scroll_replaces_skill_at_cap(db):
    character = _character(db)
    _add_skills(db, character.id, MAX_CHARACTER_SKILLS)
    old_skill = db.query(Skill).filter(Skill.character_id == character.id).first()
    new_skill = _skill_template(db, "Replacement")
    _learn_skill_from_scroll(db, character, new_skill.id, old_skill.id, None)
    db.commit()
    skills = db.query(Skill).filter(Skill.character_id == character.id).all()
    assert len(skills) == MAX_CHARACTER_SKILLS
    assert db.get(Skill, old_skill.id) is None
    assert any(s.skill_template_id == new_skill.id for s in skills)


def test_validate_item_payload_skill_on_consumable(db):
    skill = _skill_template(db)
    _validate_item_payload(
        db,
        ItemTemplateCreate(name="Scroll", item_type="consumable", skill_template_id=skill.id),
    )


def test_validate_item_payload_rejects_skill_on_non_consumable(db):
    skill = _skill_template(db)
    with pytest.raises(HTTPException) as exc:
        _validate_item_payload(
            db,
            ItemTemplateCreate(name="Bad", item_type="weapon", skill_template_id=skill.id),
        )
    assert exc.value.status_code == 400


def test_validate_item_payload_rejects_unknown_skill(db):
    with pytest.raises(HTTPException) as exc:
        _validate_item_payload(
            db,
            ItemTemplateCreate(name="Scroll", item_type="consumable", skill_template_id=9999),
        )
    assert exc.value.status_code == 400


def test_scroll_use_heals_and_learns(db):
    character = _character(db)
    skill = _skill_template(db, "Heal")
    scroll = _scroll(db, skill.id, heal=5)
    inv = _inventory(db, character.id, scroll.id)

    stats = scroll.stats or {}
    heal = stats.get("heal", 0)
    if isinstance(heal, int) and heal > 0:
        character.current_hp = min(character.max_hp, character.current_hp + heal)
    if scroll.skill_template_id:
        _learn_skill_from_scroll(db, character, scroll.skill_template_id, None, None)
    db.delete(inv)
    db.commit()

    assert character.current_hp == 15
    assert db.query(Skill).filter(Skill.character_id == character.id).count() == 1
    assert db.get(InventoryItem, inv.id) is None


def test_duplicate_scroll_does_not_consume_inventory(db):
    character = _character(db)
    skill = _skill_template(db, "Known")
    _learn_skill_from_scroll(db, character, skill.id, None, None)
    db.commit()
    scroll = _scroll(db, skill.id)
    inv = _inventory(db, character.id, scroll.id)

    with pytest.raises(HTTPException):
        _learn_skill_from_scroll(db, character, scroll.skill_template_id, None, None)

    assert db.get(InventoryItem, inv.id) is not None
