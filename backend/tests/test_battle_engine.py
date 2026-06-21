"""Unit tests for battle engine turn flow and actions."""

from app.services.battle_engine import (
    apply_prebattle_move,
    perform_action,
    resolve_auto_turns,
    start_battle,
    update_battle_positions,
)
from app.services.battle_geometry import actor_pos


def _minimal_state(
    *,
    phase="ready",
    status="pending",
    active_actor_id=None,
    actors=None,
):
    gs = 5
    default_actors = [
        {
            "id": "player_1_0",
            "type": "player",
            "name": "Hero",
            "alive": True,
            "initiative": 12,
            "initiative_stat": 12,
            "initiative_value": 5.0,
            "per_turn_value": 0.5,
            "current_hp": 20,
            "max_hp": 20,
            "position": {"x": 0, "y": 2},
            "guarding": False,
            "guard_reduction": 0.0,
            "has_shield": False,
            "consumables": [{"inventory_item_id": 1, "name": "Potion", "heal": 5, "quantity": 1}],
            "skills": [],
            "attack_bonus": 3,
            "stats": {"strength": 10},
            "battle_modifiers": {},
        },
        {
            "id": "enemy_1_0",
            "type": "enemy",
            "name": "Goblin",
            "alive": True,
            "initiative": 8,
            "initiative_stat": 8,
            "initiative_value": 1.0,
            "per_turn_value": 0.3,
            "current_hp": 10,
            "max_hp": 10,
            "position": {"x": 4, "y": 2},
            "guarding": False,
            "attack_bonus": 2,
            "stats": {"strength": 8},
        },
    ]
    return {
        "status": status,
        "phase": phase,
        "grid": {"width": gs, "height": gs},
        "actors": actors if actors is not None else default_actors,
        "active_actor_id": active_actor_id,
        "log": [],
        "prebattle_pending": [],
    }


def test_update_battle_positions():
    state = _minimal_state(phase="setup")
    positions = {
        "player_1_0": {"x": 1, "y": 2},
        "enemy_1_0": {"x": 3, "y": 2},
    }
    new_state, msg = update_battle_positions(state, positions)
    assert msg == "ok"
    assert new_state["actors"][0]["position"] == {"x": 1, "y": 2}


def test_prebattle_move_eligibility():
    actors = _minimal_state()["actors"]
    actors[0]["prebattle_eligible"] = True
    actors[0]["initiative"] = 15
    state = _minimal_state(phase="prebattle", actors=actors)
    state["prebattle_pending"] = ["player_1_0"]
    new_state, msg = apply_prebattle_move(state, "player_1_0", {"x": 0, "y": 2})
    assert msg == "Invalid pre-battle move (1-2 steps)"
    new_state, msg = apply_prebattle_move(state, "player_1_0", {"x": 0, "y": 0})
    assert msg == "ok"
    assert new_state["phase"] == "ready"
    assert actor_pos(new_state["actors"][0]) == (0, 0)


def test_start_battle_player_first():
    state = _minimal_state(phase="ready")
    active = start_battle(state)
    assert active["status"] == "active"
    assert active["active_actor_id"] == "player_1_0"


def test_player_move_action():
    state = _minimal_state(phase=None, status="active", active_actor_id="player_1_0")
    new_state, msg = perform_action(state, "player_1_0", "move", move_cell={"x": 0, "y": 0})
    assert msg == "ok"
    assert actor_pos(new_state["actors"][0]) == (0, 0)


def test_guard_reduces_damage():
    state = _minimal_state(phase=None, status="active", active_actor_id="player_1_0")
    state["actors"][0]["has_shield"] = True
    state["actors"][1]["alive"] = False
    new_state, msg = perform_action(state, "player_1_0", "guard")
    assert msg == "ok"
    assert any("guard stance" in e["message"] for e in new_state["log"])


def test_use_item_heals_self():
    state = _minimal_state(phase=None, status="active", active_actor_id="player_1_0")
    state["actors"][0]["current_hp"] = 10
    state["actors"][1]["alive"] = False
    new_state, msg = perform_action(state, "player_1_0", "use_item", inventory_item_id=1)
    assert msg == "ok"
    hero = next(a for a in new_state["actors"] if a["id"] == "player_1_0")
    assert hero["current_hp"] == 15
    assert hero["consumables"][0]["quantity"] == 0


def test_enemy_auto_turn_resolves():
    state = _minimal_state(phase=None, status="active", active_actor_id="enemy_1_0")
    new_state = resolve_auto_turns(state)
    assert new_state["active_actor_id"] == "player_1_0"
    assert len(new_state["log"]) >= 1


def test_melee_attack_with_charge():
    state = _minimal_state(phase=None, status="active", active_actor_id="player_1_0")
    state["actors"][0]["position"] = {"x": 0, "y": 2}
    state["actors"][1]["position"] = {"x": 3, "y": 2}
    new_state, msg = perform_action(
        state,
        "player_1_0",
        "attack",
        target_id="enemy_1_0",
        charge_cell={"x": 2, "y": 2},
    )
    assert msg == "ok"
    enemy = next(a for a in new_state["actors"] if a["id"] == "enemy_1_0")
    assert enemy["current_hp"] < 10
