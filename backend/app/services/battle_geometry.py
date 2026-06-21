"""Grid math for battle: paths, LOS, range, and target validation."""

from __future__ import annotations

import random
from collections import deque
from typing import Any

Pos = tuple[int, int]

GUARD_BASE_REDUCTION = 0.3
SHIELD_GUARD_BONUS = 0.15
CHARGE_PENALTY_PER_CELL = 0.2
MOVE_MAX_STEPS = 6
GUARD_MAX_STEPS = 2
DEFAULT_MELEE_RANGE = 1
DEFAULT_RANGE_DISTANCE = 4
PREBATTLE_INIT_THRESHOLD = 14


def grid_size(party_size: int) -> int:
    return max(5, min(9, party_size + 1))


def actor_pos(actor: dict) -> Pos:
    p = actor.get("position") or {"x": 0, "y": 0}
    return int(p["x"]), int(p["y"])


def set_actor_pos(actor: dict, x: int, y: int) -> None:
    actor["position"] = {"x": x, "y": y}


def in_bounds(state: dict, x: int, y: int) -> bool:
    g = state.get("grid") or {"width": 5, "height": 5}
    return 0 <= x < g["width"] and 0 <= y < g["height"]


def chebyshev_distance(a: Pos, b: Pos) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def manhattan_distance(a: Pos, b: Pos) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def is_adjacent(a: Pos, b: Pos, melee_range: int = DEFAULT_MELEE_RANGE) -> bool:
    return chebyshev_distance(a, b) <= melee_range


def _occupancy_map(state: dict, exclude_actor_id: str | None = None) -> set[Pos]:
    occupied: set[Pos] = set()
    for actor in state.get("actors", []):
        if not actor.get("alive", True):
            continue
        if exclude_actor_id and actor["id"] == exclude_actor_id:
            continue
        occupied.add(actor_pos(actor))
    return occupied


def _ranged_los_blockers(state: dict, attacker: dict) -> set[Pos]:
    """Cells that block ranged line-of-sight for this attacker (allies do not block)."""
    attacker_type = attacker.get("type")
    blockers: set[Pos] = set()
    for actor in state.get("actors", []):
        if not actor.get("alive", True):
            continue
        if actor["id"] == attacker["id"]:
            continue
        actor_type = actor.get("type")
        if attacker_type and actor_type and actor_type == attacker_type:
            continue
        blockers.add(actor_pos(actor))
    return blockers


def adjacent_cells(x: int, y: int) -> list[Pos]:
    cells: list[Pos] = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            cells.append((x + dx, y + dy))
    return cells


def adjacent_empty_cells(state: dict, target: dict, exclude_actor_id: str | None = None) -> list[Pos]:
    tx, ty = actor_pos(target)
    occupied = _occupancy_map(state, exclude_actor_id=exclude_actor_id)
    result: list[Pos] = []
    for cell in adjacent_cells(tx, ty):
        if in_bounds(state, cell[0], cell[1]) and cell not in occupied:
            result.append(cell)
    return result


def bfs_path_length(
    state: dict,
    start: Pos,
    goal: Pos,
    exclude_actor_id: str | None = None,
    max_steps: int | None = None,
) -> int | None:
    if start == goal:
        return 0
    occupied = _occupancy_map(state, exclude_actor_id=exclude_actor_id)
    occupied.discard(start)
    if goal in occupied:
        return None
    queue: deque[tuple[Pos, int]] = deque([(start, 0)])
    seen = {start}
    while queue:
        (cx, cy), dist = queue.popleft()
        if max_steps is not None and dist >= max_steps:
            continue
        for nx, ny in adjacent_cells(cx, cy):
            if not in_bounds(state, nx, ny):
                continue
            npos = (nx, ny)
            if npos in seen:
                continue
            if npos in occupied and npos != goal:
                continue
            ndist = dist + 1
            if npos == goal:
                return ndist
            seen.add(npos)
            queue.append((npos, ndist))
    return None


def reachable_cells(
    state: dict,
    actor: dict,
    max_steps: int,
) -> list[Pos]:
    start = actor_pos(actor)
    occupied = _occupancy_map(state, exclude_actor_id=actor["id"])
    queue: deque[tuple[Pos, int]] = deque([(start, 0)])
    seen = {start}
    reachable: list[Pos] = []
    while queue:
        (cx, cy), dist = queue.popleft()
        if dist > 0:
            reachable.append((cx, cy))
        if dist >= max_steps:
            continue
        for nx, ny in adjacent_cells(cx, cy):
            npos = (nx, ny)
            if not in_bounds(state, nx, ny) or npos in seen:
                continue
            if npos in occupied:
                continue
            seen.add(npos)
            queue.append((npos, dist + 1))
    return reachable


def apply_charge_penalty(base_damage: int, cells_moved: int) -> int:
    if cells_moved <= 0:
        return base_damage
    factor = max(0.0, 1.0 - CHARGE_PENALTY_PER_CELL * cells_moved)
    return max(1, int(base_damage * factor))


def pick_enemy_charge_cell(state: dict, enemy: dict, target: dict) -> Pos | None:
    cells = adjacent_empty_cells(state, target, exclude_actor_id=enemy["id"])
    if not cells:
        return None
    ex, ey = actor_pos(enemy)
    best_dist = None
    best: list[Pos] = []
    for cell in cells:
        plen = bfs_path_length(state, (ex, ey), cell, exclude_actor_id=enemy["id"])
        if plen is None:
            continue
        if best_dist is None or plen < best_dist:
            best_dist = plen
            best = [cell]
        elif plen == best_dist:
            best.append(cell)
    if not best:
        return random.choice(cells)
    return random.choice(best)


def _line_cells(x0: int, y0: int, x1: int, y1: int) -> list[Pos]:
    cells: list[Pos] = []
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    x, y = x0, y0
    while True:
        cells.append((x, y))
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x += sx
        if e2 < dx:
            err += dx
            y += sy
    return cells


def line_of_sight(state: dict, attacker: dict, target: dict, *, ignore_same_team: bool = False) -> bool:
    ax, ay = actor_pos(attacker)
    tx, ty = actor_pos(target)
    if ax == tx and ay == ty:
        return True
    line = _line_cells(ax, ay, tx, ty)
    if ignore_same_team:
        occupied = _ranged_los_blockers(state, attacker)
    else:
        occupied = _occupancy_map(state)
    for cell in line[1:-1]:
        if cell in occupied:
            return False
    return True


def cells_in_radius(center: Pos, radius: int) -> list[Pos]:
    cx, cy = center
    cells: list[Pos] = []
    for x in range(cx - radius, cx + radius + 1):
        for y in range(cy - radius, cy + radius + 1):
            if chebyshev_distance(center, (x, y)) <= radius:
                cells.append((x, y))
    return cells


def actors_at_cells(state: dict, cells: list[Pos], actor_type: str | None = None) -> list[dict]:
    cell_set = set(cells)
    result: list[dict] = []
    for actor in state.get("actors", []):
        if not actor.get("alive", True):
            continue
        if actor_type and actor.get("type") != actor_type:
            continue
        if actor_pos(actor) in cell_set:
            result.append(actor)
    return result


def can_melee_attack(state: dict, attacker: dict, target: dict) -> bool:
    if is_adjacent(actor_pos(attacker), actor_pos(target)):
        return True
    return bool(adjacent_empty_cells(state, target, exclude_actor_id=attacker["id"]))


def can_range_attack(state: dict, attacker: dict, target: dict, max_range: int = DEFAULT_RANGE_DISTANCE) -> bool:
    if chebyshev_distance(actor_pos(attacker), actor_pos(target)) > max_range:
        return False
    return line_of_sight(state, attacker, target, ignore_same_team=True)


def prebattle_reachable_cells(state: dict, actor: dict) -> list[Pos]:
    """Empty cells reachable in 1–2 steps for pre-battle reposition."""
    start = actor_pos(actor)
    cells = reachable_cells(state, actor, 2)
    result: list[Pos] = []
    for cell in cells:
        plen = bfs_path_length(state, start, cell, exclude_actor_id=actor["id"], max_steps=2)
        if plen is not None and plen >= 1:
            result.append(cell)
    return result


def validate_positions(state: dict, positions: dict[str, dict[str, int]]) -> str | None:
    seen: set[Pos] = set()
    actor_ids = {a["id"] for a in state.get("actors", [])}
    for aid, pos in positions.items():
        if aid not in actor_ids:
            return f"Unknown actor {aid}"
        x, y = int(pos["x"]), int(pos["y"])
        if not in_bounds(state, x, y):
            return f"Position out of bounds for {aid}"
        if (x, y) in seen:
            return "Two actors on same cell"
        seen.add((x, y))
    for actor in state.get("actors", []):
        if actor["id"] not in positions:
            return f"Missing position for {actor['id']}"
    return None


def apply_positions(state: dict, positions: dict[str, dict[str, int]]) -> dict:
    state = dict(state)
    actors = []
    for actor in state.get("actors", []):
        a = dict(actor)
        pos = positions[actor["id"]]
        set_actor_pos(a, int(pos["x"]), int(pos["y"]))
        actors.append(a)
    state["actors"] = actors
    return state


def default_placement(
    actors: list[dict],
    grid_w: int,
    grid_h: int,
    preset: str | None = None,
) -> None:
    players = [a for a in actors if a["type"] == "player"]
    enemies = [a for a in actors if a["type"] == "enemy"]
    for i, p in enumerate(players):
        y = min(grid_h - 1, max(0, (grid_h // 2) - len(players) // 2 + i))
        set_actor_pos(p, 0, y)
    kings = [e for e in enemies if "king" in e.get("name", "").lower()]
    grunts = [e for e in enemies if e not in kings]
    front_x = max(1, grid_w - 2)
    back_x = grid_w - 1
    for i, e in enumerate(grunts):
        y = min(grid_h - 1, max(0, (grid_h // 2) - len(grunts) // 2 + i))
        set_actor_pos(e, front_x, y)
    for i, e in enumerate(kings):
        y = min(grid_h - 1, max(0, (grid_h // 2) - len(kings) // 2 + i))
        set_actor_pos(e, back_x, y)
