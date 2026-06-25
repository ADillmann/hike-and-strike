"""Combat-class AI for guard, healer, and mage enemies."""

from __future__ import annotations

from typing import Any

from app.services.battle_geometry import (
    DEFAULT_RANGE_DISTANCE,
    GUARD_MAX_STEPS,
    MOVE_MAX_STEPS,
    actor_pos,
    can_melee_attack,
    can_range_attack,
    chebyshev_distance,
    is_adjacent,
    line_of_sight,
    pick_enemy_charge_cell,
    reachable_cells,
)
from app.services.skill_effects import normalize_effect_type

BACKLINE_CLASSES = frozenset({"range", "healer", "mage"})


def combat_class(actor: dict) -> str:
    wc = (actor.get("stats") or {}).get("weapon_class", "melee")
    return str(wc) if wc else "melee"


def _enemy_stats(actor: dict) -> dict:
    return actor.get("stats") or {}


def is_boss_actor(actor: dict) -> bool:
    return bool(_enemy_stats(actor).get("is_boss"))


def is_backline(stats: dict) -> bool:
    return str(stats.get("weapon_class", "")) in BACKLINE_CLASSES


def can_ranged_attack_enabled(actor: dict) -> bool:
    stats = _enemy_stats(actor)
    wc = str(stats.get("weapon_class", ""))
    if wc == "range":
        return True
    if wc in ("healer", "mage"):
        return bool(stats.get("can_ranged_attack", True))
    return False


def _living_enemies(state: dict, exclude_id: str | None = None) -> list[dict]:
    return [
        a for a in state.get("actors", [])
        if a.get("type") == "enemy" and a.get("alive") and a.get("id") != exclude_id
    ]


def _living_players(state: dict) -> list[dict]:
    return [a for a in state.get("actors", []) if a.get("type") == "player" and a.get("alive")]


def pick_guard_protectee(state: dict, guard: dict) -> dict | None:
    others = _living_enemies(state, exclude_id=guard["id"])
    if not others:
        return None
    bosses = [e for e in others if is_boss_actor(e)]
    if bosses:
        return max(bosses, key=lambda e: e.get("max_hp", 0))
    backline = [e for e in others if is_backline(_enemy_stats(e))]
    if backline:
        gx, gy = actor_pos(guard)
        return min(backline, key=lambda e: chebyshev_distance((gx, gy), actor_pos(e)))
    return max(others, key=lambda e: e.get("max_hp", 0))


def _near(pos: tuple[int, int], other: tuple[int, int], max_dist: int = 1) -> bool:
    return chebyshev_distance(pos, other) <= max_dist


def _player_threat_near(state: dict, pos: tuple[int, int], radius: int = 3) -> bool:
    for p in _living_players(state):
        if chebyshev_distance(pos, actor_pos(p)) <= radius:
            return True
    return False


def enemy_can_melee_without_leaving_protectee(
    state: dict,
    guard: dict,
    target: dict,
    protectee: dict,
    *,
    max_protectee_dist: int = 1,
) -> bool:
    gpos = actor_pos(guard)
    ppos = actor_pos(protectee)
    if is_adjacent(gpos, actor_pos(target)):
        return _near(gpos, ppos, max_protectee_dist)
    charge = pick_enemy_charge_cell(state, guard, target)
    if charge is None:
        return False
    return _near(charge, ppos, max_protectee_dist)


def pick_enemy_melee_target_guard(
    state: dict,
    guard: dict,
    protectee: dict,
) -> dict | None:
    candidates = []
    for player in _living_players(state):
        if enemy_can_melee_without_leaving_protectee(state, guard, player, protectee):
            candidates.append(player)
    if not candidates:
        return None
    gx, gy = actor_pos(guard)
    return min(candidates, key=lambda p: chebyshev_distance((gx, gy), actor_pos(p)))


def pick_guard_stance_cell(state: dict, guard: dict, protectee: dict) -> tuple[int, int] | None:
    px, py = actor_pos(protectee)
    reachable = reachable_cells(state, guard, GUARD_MAX_STEPS)
    if not reachable:
        return None
    gpos = actor_pos(guard)
    best: tuple[int, int] | None = None
    best_score: tuple[int, int] | None = None
    for cell in reachable:
        dist_to_protectee = chebyshev_distance(cell, (px, py))
        if dist_to_protectee > 2:
            continue
        threat = 0 if _player_threat_near(state, cell, 3) else 1
        score = (dist_to_protectee, threat, chebyshev_distance(cell, gpos))
        if best_score is None or score < best_score:
            best_score = score
            best = cell
    return best


def pick_move_toward(state: dict, actor: dict, goal: tuple[int, int], max_steps: int = MOVE_MAX_STEPS) -> tuple[int, int] | None:
    ax, ay = actor_pos(actor)
    current = chebyshev_distance((ax, ay), goal)
    reachable = reachable_cells(state, actor, max_steps)
    best: tuple[int, int] | None = None
    best_dist = current
    for cell in reachable:
        dist = chebyshev_distance(cell, goal)
        if dist < best_dist:
            best_dist = dist
            best = cell
    return best


def can_enemy_heal(state: dict, healer: dict, ally: dict) -> bool:
    if ally.get("type") != "enemy" or not ally.get("alive"):
        return False
    if ally["id"] == healer["id"]:
        return False
    max_hp = int(ally.get("max_hp") or 1)
    if ally.get("current_hp", 0) >= max_hp:
        return False
    stats = _enemy_stats(healer)
    threshold = float(stats.get("heal_threshold", 0.5))
    if ally["current_hp"] / max_hp >= threshold:
        return False
    heal_range = int(stats.get("heal_range", DEFAULT_RANGE_DISTANCE))
    if chebyshev_distance(actor_pos(healer), actor_pos(ally)) > heal_range:
        return False
    return line_of_sight(state, healer, ally, ignore_same_team=True)


def pick_enemy_heal_target(state: dict, healer: dict) -> dict | None:
    candidates = []
    for ally in _living_enemies(state, exclude_id=healer["id"]):
        if can_enemy_heal(state, healer, ally):
            hp_pct = ally["current_hp"] / max(int(ally.get("max_hp") or 1), 1)
            candidates.append((hp_pct, ally))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


def pick_subthreshold_ally_out_of_heal_range(state: dict, healer: dict) -> dict | None:
    stats = _enemy_stats(healer)
    threshold = float(stats.get("heal_threshold", 0.5))
    heal_range = int(stats.get("heal_range", DEFAULT_RANGE_DISTANCE))
    hx, hy = actor_pos(healer)
    best: dict | None = None
    best_dist = heal_range + 1
    for ally in _living_enemies(state, exclude_id=healer["id"]):
        max_hp = int(ally.get("max_hp") or 1)
        if ally["current_hp"] >= max_hp:
            continue
        if ally["current_hp"] / max_hp >= threshold:
            continue
        dist = chebyshev_distance((hx, hy), actor_pos(ally))
        if dist <= heal_range:
            continue
        if dist < best_dist:
            best_dist = dist
            best = ally
    return best


def _weapon_profile(actor: dict) -> dict:
    wp = actor.get("weapon_profile")
    if wp:
        return wp
    return {"can_ranged": False, "weapon_range": DEFAULT_RANGE_DISTANCE}


def pick_enemy_ranged_target(state: dict, enemy: dict) -> dict | None:
    if not can_ranged_attack_enabled(enemy):
        return None
    wp = _weapon_profile(enemy)
    if not wp.get("can_ranged"):
        return None
    max_range = int(wp.get("weapon_range", DEFAULT_RANGE_DISTANCE))
    players = _living_players(state)
    in_range = [p for p in players if can_range_attack(state, enemy, p, max_range)]
    if not in_range:
        return None
    ex, ey = actor_pos(enemy)
    return min(in_range, key=lambda p: chebyshev_distance((ex, ey), actor_pos(p)))


def pick_enemy_melee_target(state: dict, enemy: dict) -> dict | None:
    players = _living_players(state)
    if not players:
        return None
    attackable = [p for p in players if can_melee_attack(state, enemy, p)]
    if not attackable:
        attackable = players
    ex, ey = actor_pos(enemy)
    return min(attackable, key=lambda p: chebyshev_distance((ex, ey), actor_pos(p)))


def pick_enemy_move_dest(state: dict, enemy: dict) -> tuple[int, int] | None:
    target = pick_enemy_melee_target(state, enemy)
    if not target:
        return None
    return pick_move_toward(state, enemy, actor_pos(target))


def _mage_spell_interval(actor: dict) -> int:
    return max(1, int(_enemy_stats(actor).get("spell_interval", 3)))


def _pick_mage_skill(actor: dict) -> dict | None:
    skills = [s for s in actor.get("skills", []) if s.get("uses_remaining", 0) > 0]
    if not skills:
        return None
    ai = actor.get("ai_state") or {}
    idx = int(ai.get("spell_skill_index", 0)) % len(skills)
    return skills[idx]


def _skill_valid_on_player(state: dict, mage: dict, skill: dict, player: dict) -> bool:
    effect = normalize_effect_type(skill.get("effect_type", "none"))
    params = skill.get("effect_params") or {}
    if effect == "melee":
        return can_melee_attack(state, mage, player)
    if effect == "range":
        max_range = int(params.get("range", DEFAULT_RANGE_DISTANCE))
        return can_range_attack(state, mage, player, max_range)
    return False


def pick_mage_spell_target(state: dict, mage: dict, skill: dict) -> dict | None:
    effect = normalize_effect_type(skill.get("effect_type", "none"))
    if effect not in ("melee", "range"):
        return None
    players = _living_players(state)
    valid = [p for p in players if _skill_valid_on_player(state, mage, skill, p)]
    if not valid:
        return None
    mx, my = actor_pos(mage)
    return min(valid, key=lambda p: chebyshev_distance((mx, my), actor_pos(p)))


def decide_guard_action(state: dict, guard: dict) -> tuple[str, dict[str, Any]]:
    protectee = pick_guard_protectee(state, guard)
    if not protectee:
        return _default_action(state, guard)

    gpos = actor_pos(guard)
    ppos = actor_pos(protectee)

    melee_target = pick_enemy_melee_target_guard(state, guard, protectee)
    if melee_target:
        return "enemy_attack", {"target_id": melee_target["id"]}

    if _near(gpos, ppos, 2) and _player_threat_near(state, gpos, 3):
        guard_cell = pick_guard_stance_cell(state, guard, protectee)
        kwargs: dict[str, Any] = {}
        if guard_cell and guard_cell != gpos:
            kwargs["guard_cell"] = {"x": guard_cell[0], "y": guard_cell[1]}
        return "enemy_guard", kwargs

    move = pick_move_toward(state, guard, ppos)
    if move:
        return "enemy_move", {"move_cell": {"x": move[0], "y": move[1]}}

    return "enemy_guard", {}


def decide_healer_action(state: dict, healer: dict) -> tuple[str, dict[str, Any]]:
    heal_target = pick_enemy_heal_target(state, healer)
    if heal_target:
        return "enemy_heal", {"target_id": heal_target["id"]}

    ranged = pick_enemy_ranged_target(state, healer)
    if ranged:
        return "enemy_ranged_attack", {}

    wounded = pick_subthreshold_ally_out_of_heal_range(state, healer)
    if wounded:
        move = pick_move_toward(state, healer, actor_pos(wounded))
        if move:
            return "enemy_move", {"move_cell": {"x": move[0], "y": move[1]}}

    move = pick_enemy_move_dest(state, healer)
    if move:
        return "enemy_move", {"move_cell": {"x": move[0], "y": move[1]}}

    return "enemy_wait", {}


def decide_mage_action(state: dict, mage: dict) -> tuple[str, dict[str, Any]]:
    ai = mage.get("ai_state") or {}
    turns = int(ai.get("turns_since_spell", 0))
    interval = _mage_spell_interval(mage)

    if turns >= interval:
        skill = _pick_mage_skill(mage)
        if skill:
            target = pick_mage_spell_target(state, mage, skill)
            if target:
                return "enemy_skill", {"target_id": target["id"], "skill_id": skill["id"]}

    if can_ranged_attack_enabled(mage):
        if pick_enemy_ranged_target(state, mage):
            return "enemy_ranged_attack", {}

    move = pick_enemy_move_dest(state, mage)
    if move:
        return "enemy_move", {"move_cell": {"x": move[0], "y": move[1]}}

    return "enemy_wait", {}


def _default_action(state: dict, enemy: dict) -> tuple[str, dict[str, Any]]:
    if pick_enemy_ranged_target(state, enemy):
        return "enemy_ranged_attack", {}
    for player in _living_players(state):
        if can_melee_attack(state, enemy, player):
            return "enemy_attack", {}
    move = pick_enemy_move_dest(state, enemy)
    if move:
        return "enemy_move", {"move_cell": {"x": move[0], "y": move[1]}}
    return "enemy_wait", {}


def decide_enemy_action(state: dict, enemy: dict) -> tuple[str, dict[str, Any]]:
    wc = combat_class(enemy)
    if wc == "guard":
        return decide_guard_action(state, enemy)
    if wc == "healer":
        return decide_healer_action(state, enemy)
    if wc == "mage":
        return decide_mage_action(state, enemy)
    return _default_action(state, enemy)


def on_enemy_turn_start(actor: dict) -> None:
    """Increment per-turn AI counters before deciding an action."""
    wc = combat_class(actor)
    if wc != "mage":
        return
    ai = dict(actor.get("ai_state") or {})
    ai["turns_since_spell"] = int(ai.get("turns_since_spell", 0)) + 1
    actor["ai_state"] = ai


def on_enemy_spell_cast(actor: dict) -> None:
    ai = dict(actor.get("ai_state") or {})
    ai["turns_since_spell"] = 0
    skills = actor.get("skills") or []
    if skills:
        ai["spell_skill_index"] = (int(ai.get("spell_skill_index", 0)) + 1) % len(skills)
    actor["ai_state"] = ai
