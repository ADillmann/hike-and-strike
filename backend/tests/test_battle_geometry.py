"""Unit tests for battle grid geometry."""

from app.services.battle_geometry import (
    apply_charge_penalty,
    apply_positions,
    bfs_path_length,
    can_melee_attack,
    can_range_attack,
    default_placement,
    grid_size,
    line_of_sight,
    reachable_cells,
    validate_positions,
)


def _state(w: int = 5, h: int = 5, actors=None):
    return {"grid": {"width": w, "height": h}, "actors": actors or []}


def test_grid_size_formula():
    assert grid_size(1) == 5
    assert grid_size(4) == 5
    assert grid_size(5) == 6
    assert grid_size(8) == 9
    assert grid_size(12) == 9


def test_bfs_path_around_blocker():
    blocker = {"id": "b", "alive": True, "position": {"x": 2, "y": 2}}
    state = _state(actors=[blocker])
    assert bfs_path_length(state, (0, 0), (4, 4)) == 5
    assert bfs_path_length(state, (0, 0), (4, 4), max_steps=4) is None


def test_reachable_cells_respects_max_steps():
    actor = {"id": "p", "alive": True, "position": {"x": 2, "y": 2}}
    state = _state(actors=[actor])
    cells = reachable_cells(state, actor, 1)
    assert (2, 2) not in cells
    assert (2, 3) in cells
    assert (0, 0) not in cells


def test_line_of_sight_blocked():
    attacker = {"id": "a", "type": "player", "alive": True, "position": {"x": 0, "y": 0}}
    target = {"id": "t", "type": "enemy", "alive": True, "position": {"x": 4, "y": 0}}
    blocker = {"id": "b", "type": "enemy", "alive": True, "position": {"x": 2, "y": 0}}
    state = _state(w=6, h=5, actors=[attacker, target, blocker])
    assert line_of_sight(state, attacker, target, ignore_same_team=True) is False
    state_clear = _state(w=6, h=5, actors=[attacker, target])
    assert line_of_sight(state_clear, attacker, target, ignore_same_team=True) is True


def test_ranged_los_ally_does_not_block():
    archer = {"id": "p1", "type": "player", "alive": True, "position": {"x": 0, "y": 0}}
    ally = {"id": "p2", "type": "player", "alive": True, "position": {"x": 2, "y": 0}}
    enemy = {"id": "e1", "type": "enemy", "alive": True, "position": {"x": 4, "y": 0}}
    state = _state(w=6, h=5, actors=[archer, ally, enemy])
    assert can_range_attack(state, archer, enemy, max_range=4) is True


def test_ranged_los_enemy_still_blocks():
    archer = {"id": "p1", "type": "player", "alive": True, "position": {"x": 0, "y": 0}}
    front = {"id": "e1", "type": "enemy", "alive": True, "position": {"x": 2, "y": 0}}
    back = {"id": "e2", "type": "enemy", "alive": True, "position": {"x": 4, "y": 0}}
    state = _state(w=6, h=5, actors=[archer, front, back])
    assert can_range_attack(state, archer, front, max_range=4) is True
    assert can_range_attack(state, archer, back, max_range=4) is False


def test_can_melee_attack_adjacent_or_charge_slot():
    attacker = {"id": "p", "alive": True, "position": {"x": 0, "y": 0}}
    target = {"id": "e", "alive": True, "position": {"x": 3, "y": 0}}
    state = _state(actors=[attacker, target])
    assert can_melee_attack(state, attacker, target) is True
    # Fill every cell adjacent to the target except those reachable only via blocked lanes
    blockers = [
        {"id": "w1", "alive": True, "position": {"x": 2, "y": 0}},
        {"id": "w2", "alive": True, "position": {"x": 2, "y": 1}},
        {"id": "w3", "alive": True, "position": {"x": 4, "y": 0}},
        {"id": "w4", "alive": True, "position": {"x": 4, "y": 1}},
        {"id": "w5", "alive": True, "position": {"x": 3, "y": 1}},
    ]
    state_blocked = _state(actors=[attacker, target, *blockers])
    assert can_melee_attack(state_blocked, attacker, target) is False


def test_can_range_attack_distance_and_los():
    attacker = {"id": "p", "alive": True, "position": {"x": 0, "y": 0}}
    target = {"id": "e", "alive": True, "position": {"x": 3, "y": 0}}
    state = _state(actors=[attacker, target])
    assert can_range_attack(state, attacker, target, max_range=4) is True
    assert can_range_attack(state, attacker, target, max_range=2) is False


def test_apply_charge_penalty():
    assert apply_charge_penalty(10, 0) == 10
    assert apply_charge_penalty(10, 1) == 8
    assert apply_charge_penalty(10, 3) in (3, 4)


def test_validate_and_apply_positions():
    actors = [
        {"id": "p1", "type": "player", "position": {"x": 0, "y": 0}},
        {"id": "e1", "type": "enemy", "position": {"x": 4, "y": 0}},
    ]
    state = _state(actors=actors)
    positions = {"p1": {"x": 1, "y": 1}, "e1": {"x": 3, "y": 3}}
    assert validate_positions(state, positions) is None
    updated = apply_positions(state, positions)
    assert updated["actors"][0]["position"] == {"x": 1, "y": 1}
    bad = {"p1": {"x": 1, "y": 1}, "e1": {"x": 1, "y": 1}}
    assert validate_positions(state, bad) == "Two actors on same cell"


def test_default_placement():
    actors = [
        {"id": "p1", "type": "player", "name": "Hero", "position": {"x": 0, "y": 0}},
        {"id": "e1", "type": "enemy", "name": "Goblin", "position": {"x": 0, "y": 0}},
        {"id": "e2", "type": "enemy", "name": "Goblin King", "position": {"x": 0, "y": 0}},
    ]
    default_placement(actors, 6, 6)
    assert actors[0]["position"]["x"] == 0
    assert actors[1]["position"]["x"] == 4
    assert actors[2]["position"]["x"] == 5
