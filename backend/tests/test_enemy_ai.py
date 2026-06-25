"""Tests for enemy combat-class AI and profiles."""

from app.services.battle_engine import enemy_weapon_profile, perform_action
from app.services.battle_geometry import apply_terrain_cells
from app.services.enemy_ai import (
    can_enemy_heal,
    combat_class,
    decide_mage_action,
    enemy_can_melee_without_leaving_protectee,
    pick_enemy_heal_target,
    pick_guard_protectee,
)


def _grid_state(w=6, h=6, actors=None):
    return {
        "status": "active",
        "phase": "combat",
        "grid": {"width": w, "height": h},
        "actors": actors or [],
        "active_actor_id": None,
        "log": [],
    }


def _player(pid="p1", x=0, y=2, hp=20):
    return {
        "id": pid,
        "type": "player",
        "name": "Hero",
        "alive": True,
        "current_hp": hp,
        "max_hp": 20,
        "position": {"x": x, "y": y},
        "guarding": False,
        "shield_hp": 0,
        "attack_bonus": 3,
        "initiative_value": 5.0,
        "per_turn_value": 0.5,
        "stats": {"strength": 10, "durability": 8},
    }


def _enemy(eid="e1", x=4, y=2, wc="melee", **extra):
    stats = {"weapon_class": wc, "strength": 8, "dexterity": 8, "intelligence": 10, "damage": 3, **extra.get("stats", {})}
    actor = {
        "id": eid,
        "type": "enemy",
        "name": extra.get("name", "Mob"),
        "alive": True,
        "current_hp": extra.get("current_hp", 20),
        "max_hp": extra.get("max_hp", 20),
        "position": {"x": x, "y": y},
        "stats": stats,
        "weapon_profile": enemy_weapon_profile(stats),
        "attack_bonus": 3,
        "guarding": False,
        "guard_reduction": 0.0,
        "has_shield": wc == "guard",
        "initiative_value": 3.0,
        "per_turn_value": 0.3,
        "skills": extra.get("skills", []),
        "ai_state": extra.get("ai_state", {"turns_since_spell": 0, "spell_skill_index": 0}),
    }
    return actor


def test_enemy_weapon_profile_classes():
    guard = enemy_weapon_profile({"weapon_class": "guard", "damage": 3, "strength": 8})
    assert guard["can_melee"] and not guard["can_ranged"]

    healer = enemy_weapon_profile({
        "weapon_class": "healer",
        "can_ranged_attack": True,
        "range": 5,
        "damage": 3,
        "dexterity": 10,
    })
    assert healer["can_ranged"] and healer["weapon_range"] == 5

    pacifist = enemy_weapon_profile({"weapon_class": "healer", "can_ranged_attack": False, "damage": 3})
    assert not pacifist["can_ranged"]

    mage = enemy_weapon_profile({"weapon_class": "mage", "can_ranged_attack": False, "damage": 3})
    assert not mage["can_ranged"]


def test_pick_guard_protectee_prefers_boss():
    guard = _enemy("g1", x=1, y=2, wc="guard")
    boss = _enemy("b1", x=3, y=2, wc="range", name="King", stats={"is_boss": True})
    grunt = _enemy("g2", x=4, y=2, wc="melee", name="Grunt")
    state = _grid_state(actors=[guard, boss, grunt, _player(x=0, y=2)])
    assert pick_guard_protectee(state, guard)["id"] == "b1"


def test_enemy_can_melee_without_leaving_protectee():
    guard = _enemy("g1", x=1, y=2, wc="guard")
    boss = _enemy("b1", x=2, y=2, wc="range", stats={"is_boss": True})
    player = _player(x=0, y=2)
    state = _grid_state(actors=[guard, boss, player])
    assert enemy_can_melee_without_leaving_protectee(state, guard, player, boss) is True


def test_healer_heal_threshold():
    healer = _enemy("h1", x=0, y=0, wc="healer", stats={
        "heal_threshold": 0.5,
        "heal_range": 4,
        "heal_base": 5,
        "can_ranged_attack": False,
    })
    wounded = _enemy("a1", x=2, y=0, wc="melee", current_hp=8, max_hp=20)
    healthy = _enemy("a2", x=3, y=0, wc="melee", current_hp=18, max_hp=20)
    state = _grid_state(actors=[healer, wounded, healthy, _player(x=5, y=0)])
    assert pick_enemy_heal_target(state, healer)["id"] == "a1"
    assert can_enemy_heal(state, healer, healthy) is False


def test_healer_requires_los():
    healer = _enemy("h1", x=0, y=0, wc="healer", stats={"heal_threshold": 0.5, "heal_range": 4})
    ally = _enemy("a1", x=4, y=0, wc="melee", current_hp=5, max_hp=20)
    state = apply_terrain_cells(_grid_state(actors=[healer, ally]), [{"x": 2, "y": 0, "type": "wall"}])
    assert can_enemy_heal(state, healer, ally) is False


def test_mage_spell_interval_action():
    mage = _enemy("m1", x=4, y=2, wc="mage", stats={
        "spell_interval": 2,
        "can_ranged_attack": False,
        "skill_template_ids": [1],
    }, skills=[{
        "id": "eskill_m1_1",
        "name": "Arcane Bolt",
        "effect_type": "range",
        "effect_params": {"range": 4, "range_stat": "intelligence"},
        "uses_remaining": 99,
    }], ai_state={"turns_since_spell": 2, "spell_skill_index": 0})
    player = _player(x=0, y=2)
    state = _grid_state(actors=[mage, player])
    action, kwargs = decide_mage_action(state, mage)
    assert action == "enemy_skill"
    assert kwargs["skill_id"] == "eskill_m1_1"


def test_mage_off_turn_ranged_when_enabled():
    mage = _enemy("m1", x=4, y=2, wc="mage", stats={
        "spell_interval": 3,
        "can_ranged_attack": True,
        "range": 4,
    }, ai_state={"turns_since_spell": 1})
    player = _player(x=0, y=2)
    state = _grid_state(actors=[mage, player])
    action, _ = decide_mage_action(state, mage)
    assert action == "enemy_ranged_attack"


def test_mage_no_ranged_when_disabled():
    mage = _enemy("m1", x=4, y=2, wc="mage", stats={
        "spell_interval": 5,
        "can_ranged_attack": False,
    }, ai_state={"turns_since_spell": 1})
    player = _player(x=0, y=2)
    state = _grid_state(actors=[mage, player])
    action, _ = decide_mage_action(state, mage)
    assert action in ("enemy_move", "enemy_wait")


def test_enemy_guard_action_sets_guarding():
    guard = _enemy("g1", x=2, y=2, wc="guard")
    state = _grid_state(actors=[guard, _player(x=0, y=2)])
    state["active_actor_id"] = "g1"
    new_state, msg = perform_action(state, "g1", "enemy_guard")
    assert msg == "ok"
    actor = next(a for a in new_state["actors"] if a["id"] == "g1")
    assert actor["guarding"] is True
    assert actor["guard_reduction"] > 0.3


def test_combat_class_reads_stats():
    assert combat_class(_enemy(wc="guard")) == "guard"
