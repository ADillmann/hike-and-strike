"""Unit tests for battle engine turn flow and actions."""

from app.services.battle_engine import (
    _actor_id,
    _enemy_display_name,
    _enemy_template_totals,
    apply_prebattle_move,
    enemy_weapon_profile,
    perform_action,
    pick_enemy_move_dest,
    resolve_auto_turns,
    start_battle,
    update_battle_positions,
)
from app.services.battle_geometry import actor_pos, apply_positions, default_placement, resolve_grid_dimensions


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


def _blocker_enemy(eid: str, x: int, y: int) -> dict:
    return {
        "id": eid,
        "type": "enemy",
        "name": "Blocker",
        "alive": True,
        "initiative": 1,
        "initiative_stat": 1,
        "initiative_value": 0.1,
        "per_turn_value": 0.1,
        "current_hp": 10,
        "max_hp": 10,
        "position": {"x": x, "y": y},
        "guarding": False,
        "attack_bonus": 1,
        "stats": {"strength": 5},
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


def test_update_battle_positions_with_obstacles():
    state = _minimal_state(phase="setup")
    positions = {
        "player_1_0": {"x": 0, "y": 0},
        "enemy_1_0": {"x": 4, "y": 0},
    }
    terrain = [{"x": 2, "y": 0, "type": "wall"}, {"x": 2, "y": 1, "type": "wall"}]
    new_state, msg = update_battle_positions(state, positions, terrain_cells=terrain)
    assert msg == "ok"
    assert new_state["grid"]["terrain_cells"] == terrain
    bad_positions = {
        "player_1_0": {"x": 2, "y": 0},
        "enemy_1_0": {"x": 4, "y": 0},
    }
    _, err_msg = update_battle_positions(state, bad_positions, terrain_cells=terrain)
    assert "blocked by terrain" in err_msg


def test_custom_grid_dimensions_place_actors_in_bounds():
    gw, gh = resolve_grid_dimensions(3, 7, 5)
    assert (gw, gh) == (7, 5)
    actors = [
        {"id": "p1", "type": "player", "name": "Hero", "position": {"x": 0, "y": 0}},
        {"id": "e1", "type": "enemy", "name": "Goblin", "position": {"x": 0, "y": 0}},
        {"id": "e2", "type": "enemy", "name": "Goblin King", "position": {"x": 0, "y": 0}},
    ]
    default_placement(actors, gw, gh)
    for actor in actors:
        pos = actor["position"]
        assert 0 <= pos["x"] < gw
        assert 0 <= pos["y"] < gh


def test_default_grid_dimensions_from_party_size():
    gw, gh = resolve_grid_dimensions(8)
    assert (gw, gh) == (9, 9)


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


def test_use_item_heals_ally():
    ally = {
        "id": "player_2_0",
        "type": "player",
        "name": "Cleric",
        "alive": True,
        "initiative_value": 3.0,
        "per_turn_value": 0.4,
        "current_hp": 8,
        "max_hp": 20,
        "position": {"x": 1, "y": 2},
        "guarding": False,
        "consumables": [],
        "skills": [],
        "stats": {},
        "battle_modifiers": {},
    }
    state = _minimal_state(phase=None, status="active", active_actor_id="player_1_0")
    state["actors"].append(ally)
    state["actors"][1]["alive"] = False
    new_state, msg = perform_action(
        state,
        "player_1_0",
        "use_item",
        target_id="player_2_0",
        inventory_item_id=1,
    )
    assert msg == "ok"
    cleric = next(a for a in new_state["actors"] if a["id"] == "player_2_0")
    assert cleric["current_hp"] == 13
    hero = next(a for a in new_state["actors"] if a["id"] == "player_1_0")
    assert hero["consumables"][0]["quantity"] == 0


def test_heal_skill_on_ally():
    ally = {
        "id": "player_2_0",
        "type": "player",
        "name": "Cleric",
        "alive": True,
        "initiative_value": 3.0,
        "per_turn_value": 0.4,
        "current_hp": 5,
        "max_hp": 20,
        "position": {"x": 1, "y": 2},
        "guarding": False,
        "consumables": [],
        "skills": [],
        "stats": {"intelligence": 10},
        "battle_modifiers": {},
    }
    state = _minimal_state(phase=None, status="active", active_actor_id="player_1_0")
    state["actors"][0]["skills"] = [
        {
            "id": 42,
            "name": "Minor Heal",
            "uses_remaining": 1,
            "effect_type": "heal",
            "effect_params": {"heal_base": 6},
        }
    ]
    state["actors"].append(ally)
    state["actors"][1]["alive"] = False
    new_state, msg = perform_action(
        state,
        "player_1_0",
        "skill",
        target_id="player_2_0",
        skill_id=42,
    )
    assert msg == "ok"
    cleric = next(a for a in new_state["actors"] if a["id"] == "player_2_0")
    assert cleric["current_hp"] > 5
    assert any("Minor Heal" in e["message"] for e in new_state["log"])


def test_enemy_moves_when_out_of_melee_range():
    hero = _minimal_state()["actors"][0]
    hero["position"] = {"x": 4, "y": 4}
    hunter = _minimal_state()["actors"][1]
    hunter["id"] = "enemy_hunter"
    hunter["name"] = "Hunter"
    hunter["position"] = {"x": 0, "y": 0}
    hunter["initiative_value"] = 10.0
    blockers = [
        _blocker_enemy("block_1", 3, 3),
        _blocker_enemy("block_2", 3, 4),
        _blocker_enemy("block_3", 4, 3),
    ]
    state = _minimal_state(
        phase=None,
        status="active",
        active_actor_id="enemy_hunter",
        actors=[hero, hunter, *blockers],
    )
    new_state = resolve_auto_turns(state)
    assert new_state["active_actor_id"] != "enemy_hunter"
    assert any("moves toward" in e["message"] for e in new_state["log"])


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


def test_enemy_moves_when_melee_blocked():
    hero = _minimal_state()["actors"][0]
    hero["position"] = {"x": 4, "y": 2}
    hunter = _minimal_state()["actors"][1]
    hunter["id"] = "enemy_hunter"
    hunter["name"] = "Hunter"
    hunter["position"] = {"x": 0, "y": 2}
    hunter["initiative_value"] = 10.0
    blockers = [
        _blocker_enemy("block_1", 3, 1),
        _blocker_enemy("block_2", 3, 2),
        _blocker_enemy("block_3", 3, 3),
        _blocker_enemy("block_4", 4, 1),
        _blocker_enemy("block_5", 4, 3),
    ]
    state = _minimal_state(
        phase=None,
        status="active",
        active_actor_id="enemy_hunter",
        actors=[hero, hunter, *blockers],
    )
    dest = pick_enemy_move_dest(state, hunter)
    assert dest is not None
    new_state = resolve_auto_turns(state)
    assert new_state["active_actor_id"] != "enemy_hunter"
    assert any("moves toward" in e["message"] for e in new_state["log"])


def test_enemy_turn_advances_when_stuck():
    hero = _minimal_state()["actors"][0]
    hero["position"] = {"x": 4, "y": 4}
    stuck = _minimal_state()["actors"][1]
    stuck["id"] = "enemy_stuck"
    stuck["name"] = "Stuck"
    stuck["position"] = {"x": 2, "y": 2}
    stuck["initiative_value"] = 10.0
    ring = [
        _blocker_enemy("ring_1", 1, 1),
        _blocker_enemy("ring_2", 2, 1),
        _blocker_enemy("ring_3", 3, 1),
        _blocker_enemy("ring_4", 1, 2),
        _blocker_enemy("ring_5", 3, 2),
        _blocker_enemy("ring_6", 1, 3),
        _blocker_enemy("ring_7", 2, 3),
        _blocker_enemy("ring_8", 3, 3),
        _blocker_enemy("charge_1", 3, 4),
        _blocker_enemy("charge_2", 4, 3),
    ]
    state = _minimal_state(
        phase=None,
        status="active",
        active_actor_id="enemy_stuck",
        actors=[hero, stuck, *ring],
    )
    assert pick_enemy_move_dest(state, stuck) is None
    new_state = resolve_auto_turns(state)
    assert new_state["active_actor_id"] != "enemy_stuck"
    assert any("waits" in e["message"] for e in new_state["log"])


def test_melee_skill_with_charge():
    state = _minimal_state(phase=None, status="active", active_actor_id="player_1_0")
    state["actors"][0]["position"] = {"x": 0, "y": 2}
    state["actors"][0]["skills"] = [
        {
            "id": 99,
            "name": "Power Strike",
            "uses_remaining": 1,
            "effect_type": "melee",
            "effect_params": {"bonus_damage": 2},
        }
    ]
    state["actors"][1]["position"] = {"x": 3, "y": 2}
    state["actors"][1]["alive"] = True
    new_state, msg = perform_action(
        state,
        "player_1_0",
        "skill",
        target_id="enemy_1_0",
        skill_id=99,
        charge_cell={"x": 2, "y": 2},
    )
    assert msg == "ok"
    hero = next(a for a in new_state["actors"] if a["id"] == "player_1_0")
    assert hero["skills"][0]["uses_remaining"] == 0
    enemy = next(a for a in new_state["actors"] if a["id"] == "enemy_1_0")
    assert enemy["current_hp"] < 10


def test_enemy_weapon_profile_ranged():
    wp = enemy_weapon_profile({"damage": 3, "strength": 8, "dexterity": 12, "weapon_class": "range", "range": 5})
    assert wp["can_ranged"] is True
    assert wp["can_melee"] is False
    assert wp["weapon_range"] == 5


def test_enemy_ranged_attack_at_distance():
    hero = _minimal_state()["actors"][0]
    hero["position"] = {"x": 4, "y": 2}
    stats = {"damage": 3, "strength": 7, "dexterity": 12, "weapon_class": "range", "range": 4}
    archer = {
        "id": "enemy_archer",
        "type": "enemy",
        "name": "Archer",
        "alive": True,
        "initiative_value": 10.0,
        "per_turn_value": 0.3,
        "current_hp": 10,
        "max_hp": 10,
        "position": {"x": 0, "y": 2},
        "guarding": False,
        "stats": stats,
        "weapon_profile": enemy_weapon_profile(stats),
        "attack_bonus": 3,
        "battle_modifiers": {},
    }
    state = _minimal_state(
        phase=None,
        status="active",
        active_actor_id="enemy_archer",
        actors=[hero, archer],
    )
    new_state = resolve_auto_turns(state)
    assert new_state["active_actor_id"] != "enemy_archer"
    assert any("shoots" in e["message"] for e in new_state["log"])
    player = next(a for a in new_state["actors"] if a["id"] == "player_1_0")
    assert player["current_hp"] < hero["max_hp"]


def test_enemy_spawn_unique_ids_for_repeated_template_specs():
    """Three custom entries of Bandit x1 must not share enemy_{id}_0."""
    specs = [
        {"template_id": 5, "count": 1, "power_scale": 1.0},
        {"template_id": 5, "count": 1, "power_scale": 1.0},
        {"template_id": 5, "count": 1, "power_scale": 1.0},
    ]
    totals = _enemy_template_totals(specs)
    assert totals[5] == 3

    actors: list[dict] = []
    spawn_index_by_template: dict[int, int] = {}
    for spec in specs:
        count = spec.get("count", 1)
        tid = int(spec["template_id"])
        total_for_template = totals.get(tid, count)
        for _ in range(count):
            spawn_index = spawn_index_by_template.get(tid, 0)
            spawn_index_by_template[tid] = spawn_index + 1
            actors.append({
                "id": _actor_id("enemy", tid, spawn_index),
                "type": "enemy",
                "name": _enemy_display_name("Bandit", spawn_index, total_for_template),
                "position": {"x": 0, "y": 0},
            })

    ids = [a["id"] for a in actors]
    assert len(set(ids)) == 3
    assert ids == ["enemy_5_0", "enemy_5_1", "enemy_5_2"]
    assert [a["name"] for a in actors] == ["Bandit A", "Bandit B", "Bandit C"]

    state = _minimal_state(
        phase="setup",
        actors=[
            _minimal_state()["actors"][0],
            *actors,
        ],
    )
    positions = {
        "player_1_0": {"x": 0, "y": 0},
        "enemy_5_0": {"x": 3, "y": 0},
        "enemy_5_1": {"x": 3, "y": 1},
        "enemy_5_2": {"x": 3, "y": 2},
    }
    updated = apply_positions(state, positions)
    enemies = [a for a in updated["actors"] if a["type"] == "enemy"]
    assert len(enemies) == 3
    assert {actor_pos(e) for e in enemies} == {(3, 0), (3, 1), (3, 2)}
