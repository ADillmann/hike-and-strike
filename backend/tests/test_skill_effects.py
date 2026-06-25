import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.game.constants import SPLASH_EFFECT_FACTOR
from app.models import EffectTemplate, SkillTemplate, User, UserRole
from app.routers.skills import _validate_skill_payload
from app.schemas import SkillTemplateCreate
from app.services.battle_engine import (
    _apply_heal_splash,
    _apply_skill,
    _apply_support_to_actor,
    _build_skill_targets,
    _is_party_wide_support,
    _party_allsight_from_state,
    _support_recipients,
    battle_action_hints,
)
from app.services.battle_geometry import DEFAULT_RANGE_DISTANCE


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _player(pid: str, x: int, y: int, skills=None, hp=20):
    return {
        "id": pid,
        "type": "player",
        "name": pid,
        "alive": True,
        "current_hp": hp,
        "max_hp": 20,
        "position": {"x": x, "y": y},
        "stats": {"intelligence": 10, "dexterity": 10, "durability": 8},
        "battle_stat_mods": {},
        "battle_modifiers": {},
        "attack_bonus": 2,
        "skills": skills or [],
    }


def _enemy(eid: str, x: int, y: int):
    return {
        "id": eid,
        "type": "enemy",
        "name": eid,
        "alive": True,
        "current_hp": 20,
        "max_hp": 20,
        "position": {"x": x, "y": y},
        "stats": {"durability": 8},
        "battle_stat_mods": {},
        "battle_modifiers": {},
    }


def _state(*actors):
    return {
        "status": "active",
        "grid": {"width": 9, "height": 9, "terrain_cells": []},
        "actors": list(actors),
        "party_allsight_level": 0,
    }


def test_party_wide_support_recipients():
    state = _state(_player("p1", 0, 0), _player("p2", 1, 1))
    params = {"target_scope": "party", "support_mode": "shield"}
    recipients = _support_recipients(state, None, params)
    assert len(recipients) == 2


def test_apply_support_damage_boost():
    actor = _player("p1", 0, 0)
    detail = _apply_support_to_actor(actor, {"support_mode": "damage_boost", "damage_boost_amount": 3}, None)
    assert detail == "+3 damage dealt"
    assert actor["battle_modifiers"]["damage_dealt_mod"] == 3


def test_apply_support_apply_effect(db):
    effect = EffectTemplate(
        name="Battle Fury",
        label="Fury",
        stat_modifiers={"strength": 2},
        battle_modifiers={"damage_dealt_mod": 1},
        active_in_battle=True,
    )
    db.add(effect)
    db.commit()
    actor = _player("p1", 0, 0)
    detail = _apply_support_to_actor(
        actor,
        {"support_mode": "apply_effect", "effect_template_id": effect.id},
        db,
    )
    assert detail == "Fury"
    assert actor["battle_stat_mods"]["strength"] == 2
    assert actor["battle_modifiers"]["damage_dealt_mod"] == 1


def test_validate_skill_rejects_inactive_effect(db):
    effect = EffectTemplate(name="Rest Buff", label="Rest Buff", active_in_battle=False)
    db.add(effect)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        _validate_skill_payload(
            db,
            SkillTemplateCreate(
                name="Bad",
                effect_type="support",
                effect_params={"support_mode": "apply_effect", "effect_template_id": effect.id},
            ),
        )
    assert exc.value.status_code == 400


def test_validate_skill_accepts_apply_effect(db):
    effect = EffectTemplate(name="War Cry", label="War Cry", active_in_battle=True)
    db.add(effect)
    db.commit()
    _validate_skill_payload(
        db,
        SkillTemplateCreate(
            name="Cry",
            effect_type="support",
            effect_params={"support_mode": "apply_effect", "effect_template_id": effect.id},
        ),
    )


def test_heal_out_of_range():
    caster = _player("p1", 0, 0)
    ally = _player("p2", 5, 0)
    skill = {
        "id": 1,
        "name": "Heal",
        "effect_type": "heal",
        "effect_params": {"heal_base": 5, "range": 2},
        "uses_remaining": 1,
    }
    state = _state(caster, ally)
    with pytest.raises(ValueError, match="Out of range"):
        _apply_skill(state, caster, ally, skill, None)


def test_heal_splash_heals_nearby_allies():
    primary = _player("p1", 2, 2, hp=10)
    ally = _player("p2", 3, 2, hp=10)
    state = _state(primary, ally)
    msg = _apply_heal_splash(state, primary, 1, 10)
    assert "p2" in msg
    assert ally["current_hp"] == 10 + max(1, int(10 * SPLASH_EFFECT_FACTOR))


def test_party_wide_shield_support():
    p1 = _player("p1", 0, 0)
    p2 = _player("p2", 1, 0)
    skill = {
        "id": 2,
        "name": "Mass Shield",
        "effect_type": "support",
        "effect_params": {"support_mode": "shield", "shield_amount": 5, "target_scope": "party"},
        "uses_remaining": 1,
    }
    state = _state(p1, p2)
    msg = _apply_skill(state, p1, p1, skill, None)
    assert p1["shield_hp"] == 5
    assert p2["shield_hp"] == 5
    assert "party" in msg


def test_build_skill_targets_respects_range():
    skill = {
        "id": 7,
        "name": "Bolt",
        "effect_type": "range",
        "effect_params": {"range": 2, "bonus_damage": 0, "range_stat": "intelligence"},
        "uses_remaining": 1,
    }
    caster = _player("p1", 0, 0, skills=[skill])
    near = _enemy("e1", 2, 0)
    far = _enemy("e2", 5, 0)
    state = _state(caster, near, far)
    hints = battle_action_hints(state, "p1")
    targets = hints["skill_targets"]["7"]["enemies"]
    assert "e1" in targets
    assert "e2" not in targets


def test_party_allsight_from_in_battle_modifiers():
    state = _state(_player("p1", 0, 0))
    state["party_allsight_level"] = 0
    state["actors"][0]["battle_modifiers"] = {"allsight": 2}
    assert _party_allsight_from_state(state) == 2


def test_is_party_wide_support():
    assert _is_party_wide_support({"target_scope": "party"}) is True
    assert _is_party_wide_support({}) is False
