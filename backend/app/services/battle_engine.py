import random
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.game.constants import HAND_SLOTS
from app.models import Character, EnemyTemplate, InventoryItem, Skill
from app.services.battle_geometry import (
    DEFAULT_RANGE_DISTANCE,
    GUARD_BASE_REDUCTION,
    GUARD_MAX_STEPS,
    MOVE_MAX_STEPS,
    PREBATTLE_INIT_THRESHOLD,
    SHIELD_GUARD_BONUS,
    adjacent_empty_cells,
    apply_charge_penalty,
    apply_positions,
    bfs_path_length,
    can_melee_attack,
    can_range_attack,
    cells_in_radius,
    chebyshev_distance,
    default_placement,
    grid_size,
    is_adjacent,
    line_of_sight,
    pick_enemy_charge_cell,
    reachable_cells,
    set_actor_pos,
    actor_pos,
    validate_positions,
)
from app.services.character_stats import (
    aggregate_battle_modifiers,
    compute_max_hp,
    effective_stats,
    equipped_weapon_profile,
    normalize_equipped_slot,
)
from app.services.skill_effects import normalize_effect_type, skill_battle_meta


def _actor_id(actor_type: str, entity_id: int, index: int = 0) -> str:
    return f"{actor_type}_{entity_id}_{index}"


def _enemy_hp(stats: dict) -> int:
    armor = stats.get("armor_bonus", 0)
    return compute_max_hp(stats.get("durability", 8), armor)


def _scale_stats(stats: dict, scale: float) -> dict:
    if scale == 1.0:
        return dict(stats)
    scaled = {}
    for k, v in stats.items():
        if isinstance(v, int):
            scaled[k] = max(1, int(v * scale))
        else:
            scaled[k] = v
    return scaled


def _has_shield_equipped(inventory_items) -> bool:
    for inv in inventory_items:
        if not inv.equipped_slot or not inv.item_template:
            continue
        slot = normalize_equipped_slot(inv.equipped_slot)
        if slot in HAND_SLOTS and inv.item_template.item_type == "shield":
            return True
    return False


def _guard_reduction(actor: dict) -> float:
    base = GUARD_BASE_REDUCTION
    if actor.get("has_shield"):
        base += SHIELD_GUARD_BONUS
    return min(0.9, base)


def _snapshot_consumables(inventory_items) -> list[dict]:
    items: list[dict] = []
    for inv in inventory_items:
        if not inv.item_template or inv.item_template.item_type != "consumable":
            continue
        heal = int((inv.item_template.stats or {}).get("heal", 0))
        items.append({
            "inventory_item_id": inv.id,
            "name": inv.item_template.name,
            "heal": heal,
            "quantity": inv.quantity,
        })
    return items


def build_battle_state(
    db: Session,
    party: list[Character],
    enemy_specs: list[dict],
    group_initiative_bonus: float = 0.0,
    enemy_initiative_bonus: float = 0.0,
    preset: str | None = None,
    battle_config: dict | None = None,
) -> dict[str, Any]:
    actors: list[dict[str, Any]] = []
    group_size = len(party)
    enemy_count = sum(s.get("count", 1) for s in enemy_specs)
    total_combatants = max(1, group_size + enemy_count)
    gs = grid_size(group_size)
    cfg = battle_config or {}
    gi_bonus = group_initiative_bonus + float(cfg.get("group_initiative_bonus", 0) or 0)
    en_bonus = enemy_initiative_bonus + float(cfg.get("enemy_initiative_bonus", 0) or 0)

    for character in party:
        db.refresh(character, ["inventory_items", "temporary_effects", "skills"])
        for inv in character.inventory_items:
            db.refresh(inv, ["item_template"])
        for skill in character.skills:
            db.refresh(skill, ["skill_template"])
        eff = effective_stats(character.stats, character.inventory_items, character.temporary_effects)
        init_stat = eff.get("initiative", 8)
        per_turn = (1 + init_stat / 20) / total_combatants
        wp = equipped_weapon_profile(character.inventory_items, eff)
        actor = {
            "id": _actor_id("player", character.id),
            "type": "player",
            "character_id": character.id,
            "name": character.name,
            "initiative_stat": init_stat,
            "per_turn_value": per_turn,
            "initiative_value": gi_bonus + random.uniform(0, 0.0001) + per_turn,
            "current_hp": character.current_hp,
            "max_hp": character.max_hp,
            "stats": eff,
            "weapon_profile": wp,
            "attack_bonus": wp["melee_attack_bonus"],
            "alive": character.current_hp > 0,
            "shield_hp": 0,
            "battle_stat_mods": {},
            "battle_modifiers": aggregate_battle_modifiers(character.temporary_effects),
            "guarding": False,
            "guard_reduction": 0.0,
            "has_shield": _has_shield_equipped(character.inventory_items),
            "prebattle_eligible": init_stat >= PREBATTLE_INIT_THRESHOLD,
            "prebattle_moved": False,
            "skills": [
                {
                    "id": s.id,
                    "name": s.name,
                    "uses_remaining": s.uses_remaining,
                    **{k: skill_battle_meta(s)[k] for k in ("effect_type", "effect_params")},
                }
                for s in character.skills
            ],
            "consumables": _snapshot_consumables(character.inventory_items),
            "position": {"x": 0, "y": 0},
        }
        actors.append(actor)

    for spec in enemy_specs:
        template = db.get(EnemyTemplate, spec["template_id"])
        if not template:
            continue
        count = spec.get("count", 1)
        scale = spec.get("power_scale", 1.0)
        for i in range(count):
            stats = _scale_stats(template.stats or {}, scale)
            init_stat = stats.get("initiative", 8)
            per_turn = (1 + init_stat / 20) / total_combatants
            label = template.name if count == 1 else f"{template.name} {i + 1}"
            actors.append({
                "id": _actor_id("enemy", template.id, i),
                "type": "enemy",
                "template_id": template.id,
                "name": label,
                "initiative_stat": init_stat,
                "per_turn_value": per_turn,
                "initiative_value": en_bonus + random.uniform(0, 0.0001) + per_turn,
                "current_hp": _enemy_hp(stats),
                "max_hp": _enemy_hp(stats),
                "stats": stats,
                "attack_bonus": stats.get("damage", 2) + stats.get("strength", 8) // 3,
                "alive": True,
                "shield_hp": 0,
                "battle_stat_mods": {},
                "guarding": False,
                "position": {"x": 0, "y": 0},
            })

    default_placement(actors, gs, gs, preset=preset)
    eligible_prebattle = [a["id"] for a in actors if a["type"] == "player" and a.get("prebattle_eligible") and a["alive"]]

    return {
        "status": "pending",
        "phase": "setup" if not eligible_prebattle else "prebattle",
        "grid": {"width": gs, "height": gs},
        "group_initiative_bonus": gi_bonus,
        "enemy_initiative_bonus": en_bonus,
        "preset": preset,
        "battle_config": cfg,
        "victory_rewards": cfg.get("victory_rewards"),
        "defeat_punishments": cfg.get("defeat_punishments"),
        "actors": actors,
        "active_actor_id": None,
        "log": [],
        "end_reason": None,
        "winner": None,
        "prebattle_pending": eligible_prebattle,
    }


def sync_weapon_profiles(db: Session, state: dict[str, Any]) -> dict[str, Any]:
    """Refresh player weapon profiles from current equipped inventory."""
    state = dict(state)
    actors: list[dict[str, Any]] = []
    for a in state.get("actors", []):
        actor = dict(a)
        if actor.get("type") != "player" or not actor.get("character_id"):
            actors.append(actor)
            continue
        character = db.get(Character, actor["character_id"])
        if not character:
            actors.append(actor)
            continue
        db.refresh(character, ["inventory_items", "temporary_effects"])
        for inv in character.inventory_items:
            db.refresh(inv, ["item_template"])
        eff = effective_stats(character.stats, character.inventory_items, character.temporary_effects)
        wp = equipped_weapon_profile(character.inventory_items, eff)
        actor["weapon_profile"] = wp
        actor["attack_bonus"] = wp["melee_attack_bonus"]
        actor["stats"] = eff
        actor["has_shield"] = _has_shield_equipped(character.inventory_items)
        actors.append(actor)
    state["actors"] = actors
    return state


def update_battle_positions(state: dict[str, Any], positions: dict[str, dict[str, int]]) -> tuple[dict[str, Any], str]:
    err = validate_positions(state, positions)
    if err:
        return state, err
    return apply_positions(state, positions), "ok"


def apply_prebattle_move(
    state: dict[str, Any],
    actor_id: str,
    cell: dict[str, int],
) -> tuple[dict[str, Any], str]:
    state = dict(state)
    if state.get("phase") != "prebattle":
        return state, "Not in pre-battle phase"
    actors = [dict(a) for a in state["actors"]]
    actor = next((a for a in actors if a["id"] == actor_id), None)
    if not actor or actor["type"] != "player":
        return state, "Invalid actor"
    if not actor.get("prebattle_eligible"):
        return state, "Not eligible for pre-battle move"
    if actor.get("prebattle_moved"):
        return state, "Already moved"
    x, y = int(cell["x"]), int(cell["y"])
    plen = bfs_path_length(state, actor_pos(actor), (x, y), exclude_actor_id=actor_id, max_steps=2)
    if plen is None or plen < 1 or plen > 2:
        return state, "Invalid pre-battle move (1-2 steps)"
    set_actor_pos(actor, x, y)
    actor["prebattle_moved"] = True
    for i, a in enumerate(actors):
        if a["id"] == actor_id:
            actors[i] = actor
            break
    state["actors"] = actors
    pending = [aid for aid in state.get("prebattle_pending", []) if aid != actor_id or not actor.get("prebattle_moved")]
    state["prebattle_pending"] = [
        a["id"] for a in actors
        if a["type"] == "player" and a.get("prebattle_eligible") and not a.get("prebattle_moved") and a["alive"]
    ]
    if not state["prebattle_pending"]:
        state["phase"] = "ready"
    state["log"] = state.get("log", []) + [_log_entry(f"{actor['name']} repositions before battle.")]
    return state, "ok"


def skip_remaining_prebattle(state: dict[str, Any]) -> dict[str, Any]:
    state = dict(state)
    actors = [dict(a) for a in state.get("actors", [])]
    for a in actors:
        if a.get("prebattle_eligible") and not a.get("prebattle_moved"):
            a["prebattle_skipped"] = True
    state["actors"] = actors
    state["prebattle_pending"] = []
    state["phase"] = "ready"
    state["log"] = state.get("log", []) + [_log_entry("Pre-battle positioning skipped.")]
    return state


def skip_prebattle_if_done(state: dict[str, Any]) -> dict[str, Any]:
    state = dict(state)
    if state.get("phase") == "prebattle" and not state.get("prebattle_pending"):
        state["phase"] = "ready"
    if state.get("phase") == "prebattle" and state.get("prebattle_pending"):
        pass
    elif state.get("phase") == "setup":
        state["phase"] = "ready"
    return state


def start_battle(state: dict[str, Any]) -> dict[str, Any]:
    state = dict(state)
    if state.get("phase") == "prebattle" and state.get("prebattle_pending"):
        return state
    state["phase"] = None
    state["status"] = "active"
    for a in state.get("actors", []):
        a["guarding"] = False
        a["guard_reduction"] = 0.0
    state["active_actor_id"] = _pick_next_actor(state)
    active = _get_actor(state, state["active_actor_id"])
    if active:
        active["guarding"] = False
    state["log"] = state.get("log", []) + [
        _log_entry(f"Battle begins! {_actor_name(state, state['active_actor_id'])} acts first.")
    ]
    return resolve_auto_turns(state)


def _actor_name(state: dict, actor_id: str | None) -> str:
    if not actor_id:
        return "—"
    for a in state["actors"]:
        if a["id"] == actor_id:
            return a["name"]
    return "—"


def _log_entry(message: str) -> dict:
    return {"message": message, "timestamp": datetime.now(timezone.utc).isoformat()}


def _pick_next_actor(state: dict[str, Any]) -> str | None:
    alive = [a for a in state["actors"] if a["alive"]]
    if not alive:
        return None
    return max(alive, key=lambda a: a["initiative_value"])["id"]


def _get_actor(state: dict, actor_id: str) -> dict | None:
    for a in state.get("actors", []):
        if a["id"] == actor_id:
            return a
    return None


def _advance_turn(state: dict[str, Any]) -> dict[str, Any]:
    state = dict(state)
    actors = [dict(a) for a in state["actors"]]
    active_id = state.get("active_actor_id")
    if active_id:
        for a in actors:
            if a["id"] == active_id:
                a["initiative_value"] = 0
    for a in actors:
        if a["alive"]:
            a["initiative_value"] = a.get("initiative_value", 0) + a["per_turn_value"]
    state["actors"] = actors
    state["active_actor_id"] = _pick_next_actor(state)
    nxt = _get_actor(state, state.get("active_actor_id"))
    if nxt:
        nxt["guarding"] = False
        nxt["guard_reduction"] = 0.0
    return state


def _check_battle_end(state: dict[str, Any]) -> dict[str, Any]:
    players = [a for a in state["actors"] if a["type"] == "player"]
    enemies = [a for a in state["actors"] if a["type"] == "enemy"]
    if not any(a["alive"] for a in players):
        state["status"] = "completed"
        state["end_reason"] = "party_defeated"
        state["winner"] = "enemies"
        state["active_actor_id"] = None
    elif not any(a["alive"] for a in enemies):
        state["status"] = "completed"
        state["end_reason"] = "enemies_defeated"
        state["winner"] = "party"
        state["active_actor_id"] = None
    return state


def _actor_stat(actor: dict, stat: str) -> int:
    base = actor.get("stats", {}).get(stat, 8)
    mods = actor.get("battle_stat_mods") or {}
    return base + int(mods.get(stat, 0))


def _battle_damage_mod(actor: dict) -> int:
    return int((actor.get("battle_modifiers") or {}).get("damage_dealt_mod", 0))


def _battle_heal_mod(actor: dict) -> int:
    return int((actor.get("battle_modifiers") or {}).get("heal_mod", 0))


def _mitigation(target: dict) -> int:
    return _actor_stat(target, "durability") // 4


def _apply_damage(target: dict, damage: int) -> tuple[int, int, int]:
    remaining = max(0, damage)
    shield_absorbed = 0
    shield = int(target.get("shield_hp") or 0)
    if shield > 0 and remaining > 0:
        shield_absorbed = min(shield, remaining)
        target["shield_hp"] = shield - shield_absorbed
        remaining -= shield_absorbed
    guard_reduced = 0
    if remaining > 0 and target.get("guarding"):
        reduction = float(target.get("guard_reduction") or GUARD_BASE_REDUCTION)
        after = max(1, int(remaining * (1 - reduction)))
        guard_reduced = remaining - after
        remaining = after
    hp_damage = 0
    if remaining > 0:
        hp_damage = remaining
        target["current_hp"] = max(0, target["current_hp"] - remaining)
        if target["current_hp"] <= 0:
            target["alive"] = False
    return hp_damage, shield_absorbed, guard_reduced


def pick_enemy_target(state: dict, enemy: dict) -> dict | None:
    players = [a for a in state["actors"] if a["type"] == "player" and a["alive"]]
    if not players:
        return None
    attackable = [p for p in players if can_melee_attack(state, enemy, p)]
    if not attackable:
        attackable = players
    ex, ey = actor_pos(enemy)
    return min(attackable, key=lambda p: chebyshev_distance((ex, ey), actor_pos(p)))


def _move_actor(actor: dict, dest: tuple[int, int]) -> int:
    start = actor_pos(actor)
    set_actor_pos(actor, dest[0], dest[1])
    return chebyshev_distance(start, dest)


def _move_actor_path(state: dict, actor: dict, dest: tuple[int, int]) -> int:
    start = actor_pos(actor)
    plen = bfs_path_length(state, start, dest, exclude_actor_id=actor["id"])
    if plen is None:
        return -1
    set_actor_pos(actor, dest[0], dest[1])
    return plen


def _weapon_profile(actor: dict) -> dict:
    wp = actor.get("weapon_profile")
    if wp:
        return wp
    return {
        "can_melee": True,
        "can_ranged": False,
        "melee_attack_bonus": actor.get("attack_bonus", 0),
        "ranged_attack_bonus": 0,
        "weapon_range": DEFAULT_RANGE_DISTANCE,
    }


def _execute_melee_attack(
    state: dict,
    actor: dict,
    target: dict,
    charge_cell: dict[str, int] | None,
    is_enemy: bool,
) -> str:
    cells_moved = 0
    if not is_adjacent(actor_pos(actor), actor_pos(target)):
        if is_enemy:
            dest = pick_enemy_charge_cell(state, actor, target)
            if dest is None:
                raise ValueError("Target blocked")
            cells_moved = _move_actor_path(state, actor, dest)
        else:
            if not charge_cell:
                raise ValueError("Charge cell required")
            cx, cy = int(charge_cell["x"]), int(charge_cell["y"])
            valid = adjacent_empty_cells(state, target, exclude_actor_id=actor["id"])
            if (cx, cy) not in valid:
                raise ValueError("Invalid charge cell")
            cells_moved = _move_actor_path(state, actor, (cx, cy))
            if cells_moved < 0:
                raise ValueError("No path to charge cell")
    roll = random.randint(1, 6)
    dmg_mod = _battle_damage_mod(actor) if actor["type"] == "player" else 0
    if actor["type"] == "player":
        atk_bonus = _weapon_profile(actor)["melee_attack_bonus"]
    else:
        atk_bonus = actor.get("attack_bonus", 0)
    base = max(1, atk_bonus + roll - _mitigation(target) + dmg_mod)
    damage = apply_charge_penalty(base, cells_moved)
    _, shield_abs, guard_red = _apply_damage(target, damage)
    msg = f"{actor['name']} attacks {target['name']} for {damage} damage!"
    if cells_moved:
        msg = f"{actor['name']} charges {cells_moved} cell(s) and attacks {target['name']} for {damage} damage!"
    if shield_abs:
        msg += f" ({shield_abs} absorbed by shield)"
    if guard_red:
        msg += f" ({guard_red} reduced by guard)"
    if not target["alive"]:
        msg += f" {target['name']} is defeated!"
    return msg


def _execute_ranged_attack(state: dict, actor: dict, target: dict) -> str:
    wp = _weapon_profile(actor)
    max_range = int(wp.get("weapon_range", DEFAULT_RANGE_DISTANCE))
    if not can_range_attack(state, actor, target, max_range):
        raise ValueError("No line of sight or out of range")
    roll = random.randint(1, 6)
    dmg_mod = _battle_damage_mod(actor)
    base = max(1, wp["ranged_attack_bonus"] + roll - _mitigation(target) + dmg_mod)
    _, shield_abs, guard_red = _apply_damage(target, base)
    msg = f"{actor['name']} shoots {target['name']} for {base} damage!"
    if shield_abs:
        msg += f" ({shield_abs} absorbed by shield)"
    if guard_red:
        msg += f" ({guard_red} reduced by guard)"
    if not target["alive"]:
        msg += f" {target['name']} is defeated!"
    return msg


def _find_skill(actor: dict, skill_id: int | None, action: str) -> dict | None:
    skills = actor.get("skills", [])
    if skill_id is not None:
        found = next((s for s in skills if s["id"] == skill_id), None)
        if found:
            found = dict(found)
            found["effect_type"] = normalize_effect_type(found.get("effect_type", "none"))
        return found
    if action == "heal":
        return next((s for s in skills if normalize_effect_type(s.get("effect_type", "")) == "heal"), None)
    return None


def _apply_skill(state: dict, actor: dict, target: dict | None, skill: dict, charge_cell: dict | None) -> str:
    effect = normalize_effect_type(skill.get("effect_type", "none"))
    params = skill.get("effect_params") or {}
    name = skill.get("name", "Skill")

    if effect == "heal":
        if not target or target["type"] != "player" or not target["alive"]:
            raise ValueError("Invalid heal target")
        heal_base = int(params.get("heal_base", 5))
        heal_amount = max(1, heal_base + _actor_stat(actor, "intelligence") // 2 + _battle_heal_mod(actor))
        target["current_hp"] = min(target["max_hp"], target["current_hp"] + heal_amount)
        skill["uses_remaining"] -= 1
        return f"{actor['name']} uses {name} on {target['name']} for {heal_amount} HP!"

    splash_radius = int(params.get("splash_radius", 0))

    if effect == "melee":
        if not target or not target["alive"] or actor["type"] == target["type"]:
            raise ValueError("Invalid target")
        if not can_melee_attack(state, actor, target):
            raise ValueError("Cannot reach target")
        msg = _execute_melee_attack(state, actor, target, charge_cell, is_enemy=False)
        skill["uses_remaining"] -= 1
        if splash_radius > 0:
            msg += _apply_splash(state, actor, target, splash_radius, params)
        return msg.replace(f"{actor['name']} attacks", f"{actor['name']} uses {name} on", 1)

    if effect == "range":
        if not target or not target["alive"] or actor["type"] == target["type"]:
            raise ValueError("Invalid target")
        max_range = int(params.get("range", DEFAULT_RANGE_DISTANCE))
        if not can_range_attack(state, actor, target, max_range):
            raise ValueError("No line of sight or out of range")
        bonus = int(params.get("bonus_damage", 0))
        range_stat = params.get("range_stat", "dexterity")
        roll = random.randint(1, 6)
        damage = max(1, _actor_stat(actor, range_stat) // 2 + roll + bonus - _mitigation(target) + _battle_damage_mod(actor))
        _, shield_abs, guard_red = _apply_damage(target, damage)
        skill["uses_remaining"] -= 1
        msg = f"{actor['name']} uses {name} (range) on {target['name']} for {damage} damage!"
        if shield_abs:
            msg += f" ({shield_abs} absorbed by shield)"
        if guard_red:
            msg += f" (guard reduced {guard_red})"
        if not target["alive"]:
            msg += f" {target['name']} is defeated!"
        if splash_radius > 0:
            msg += _apply_splash(state, actor, target, splash_radius, params)
        return msg

    if effect == "support":
        if not target or target["type"] != "player" or not target["alive"]:
            raise ValueError("Invalid support target")
        mode = params.get("support_mode", "shield")
        if mode == "shield":
            amount = int(params.get("shield_amount", 5))
            target["shield_hp"] = int(target.get("shield_hp") or 0) + amount
            skill["uses_remaining"] -= 1
            return f"{actor['name']} uses {name} — {target['name']} gains {amount} shield HP!"
        if mode == "stat_boost":
            stat = params.get("stat", "strength")
            bonus = int(params.get("stat_bonus", 1))
            mods = dict(target.get("battle_stat_mods") or {})
            mods[stat] = int(mods.get(stat, 0)) + bonus
            target["battle_stat_mods"] = mods
            if stat == "strength":
                gain = bonus // 3
                if gain:
                    target["attack_bonus"] = target.get("attack_bonus", 0) + gain
            skill["uses_remaining"] -= 1
            return f"{actor['name']} uses {name} — {target['name']} gains +{bonus} {stat} for this battle!"
        raise ValueError("Unknown support mode")
    raise ValueError("Skill not usable in battle")


def _apply_splash(state: dict, actor: dict, primary: dict, radius: int, params: dict) -> str:
    center = actor_pos(primary)
    bonus = int(params.get("bonus_damage", 0))
    extra = ""
    for cell in cells_in_radius(center, radius):
        for other in state.get("actors", []):
            if other["id"] == primary["id"] or not other["alive"]:
                continue
            if actor_pos(other) != cell:
                continue
            if other["type"] == actor["type"]:
                continue
            roll = random.randint(1, 4)
            dmg = max(1, roll + bonus - _mitigation(other))
            _apply_damage(other, dmg)
            extra += f" Splash hits {other['name']} for {dmg}!"
            if not other["alive"]:
                extra += f" {other['name']} falls!"
    return extra


def perform_action(
    state: dict[str, Any],
    actor_id: str,
    action: str,
    target_id: str | None = None,
    skill_id: int | None = None,
    charge_cell: dict[str, int] | None = None,
    move_cell: dict[str, int] | None = None,
    guard_cell: dict[str, int] | None = None,
    inventory_item_id: int | None = None,
) -> tuple[dict[str, Any], str]:
    state = dict(state)
    actors = [dict(a) for a in state["actors"]]
    actor = next((a for a in actors if a["id"] == actor_id), None)
    if not actor or not actor["alive"]:
        return state, "Invalid actor"
    if state.get("status") != "active":
        return state, "Battle not active"
    if state.get("active_actor_id") != actor_id:
        return state, "Not this actor's turn"

    log_msg = ""

    try:
        if action == "attack":
            if actor["type"] != "player":
                return {**state, "actors": actors}, "Invalid action"
            if not _weapon_profile(actor).get("can_melee"):
                return {**state, "actors": actors}, "No melee weapon equipped"
            if not target_id:
                return {**state, "actors": actors}, "Target required"
            target = next((a for a in actors if a["id"] == target_id), None)
            if not target or not target["alive"] or target["type"] == actor["type"]:
                return {**state, "actors": actors}, "Invalid target"
            if not can_melee_attack(state, actor, target):
                return {**state, "actors": actors}, "Target blocked or unreachable"
            log_msg = _execute_melee_attack(state, actor, target, charge_cell, is_enemy=False)

        elif action == "ranged_attack":
            if actor["type"] != "player":
                return {**state, "actors": actors}, "Invalid action"
            if not _weapon_profile(actor).get("can_ranged"):
                return {**state, "actors": actors}, "No ranged weapon equipped"
            if not target_id:
                return {**state, "actors": actors}, "Target required"
            target = next((a for a in actors if a["id"] == target_id), None)
            if not target or not target["alive"] or target["type"] == actor["type"]:
                return {**state, "actors": actors}, "Invalid target"
            log_msg = _execute_ranged_attack(state, actor, target)

        elif action == "move":
            if actor["type"] != "player":
                return {**state, "actors": actors}, "Invalid action"
            if not move_cell:
                return {**state, "actors": actors}, "Destination required"
            mx, my = int(move_cell["x"]), int(move_cell["y"])
            reachable = reachable_cells({**state, "actors": actors}, actor, MOVE_MAX_STEPS)
            if (mx, my) not in reachable:
                return {**state, "actors": actors}, "Invalid move destination"
            plen = _move_actor_path(state, actor, (mx, my))
            log_msg = f"{actor['name']} moves to ({mx}, {my})."

        elif action == "guard":
            if actor["type"] != "player":
                return {**state, "actors": actors}, "Invalid action"
            if guard_cell:
                gx, gy = int(guard_cell["x"]), int(guard_cell["y"])
                reachable = reachable_cells({**state, "actors": actors}, actor, GUARD_MAX_STEPS)
                if (gx, gy) not in reachable and (gx, gy) != actor_pos(actor):
                    return {**state, "actors": actors}, "Invalid guard destination"
                if (gx, gy) != actor_pos(actor):
                    _move_actor_path(state, actor, (gx, gy))
            actor["guarding"] = True
            actor["guard_reduction"] = _guard_reduction(actor)
            pct = int(actor["guard_reduction"] * 100)
            log_msg = f"{actor['name']} takes a guard stance (−{pct}% damage until next turn)."

        elif action == "use_item":
            if actor["type"] != "player":
                return {**state, "actors": actors}, "Invalid action"
            if not inventory_item_id:
                return {**state, "actors": actors}, "Item required"
            consumables = actor.get("consumables") or []
            item = next((c for c in consumables if c["inventory_item_id"] == inventory_item_id), None)
            if not item or item.get("quantity", 0) <= 0:
                return {**state, "actors": actors}, "Item unavailable"
            heal = int(item.get("heal", 0))
            if heal <= 0:
                return {**state, "actors": actors}, "Item not usable in battle"
            target = actor
            if target_id:
                target = next((a for a in actors if a["id"] == target_id), None)
            if not target or target["type"] != "player" or not target["alive"]:
                return {**state, "actors": actors}, "Invalid target"
            target["current_hp"] = min(target["max_hp"], target["current_hp"] + heal)
            item["quantity"] -= 1
            log_msg = f"{actor['name']} uses {item['name']} on {target['name']} for {heal} HP!"

        elif action in ("skill", "heal", "power_strike"):
            if actor["type"] != "player":
                return {**state, "actors": actors}, "Only players can use skills"
            skill = _find_skill(actor, skill_id, action)
            if not skill or skill["uses_remaining"] <= 0:
                return {**state, "actors": actors}, "Skill unavailable"
            effect = normalize_effect_type(skill.get("effect_type", "none"))
            if effect == "none":
                return {**state, "actors": actors}, "Skill not usable in battle"
            target = actor
            if effect in ("heal", "support"):
                if target_id:
                    target = next((a for a in actors if a["id"] == target_id), None)
            else:
                if not target_id:
                    return {**state, "actors": actors}, "Target required"
                target = next((a for a in actors if a["id"] == target_id), None)
            skill_ref = next((s for s in actor.get("skills", []) if s["id"] == skill["id"]), None)
            if not skill_ref or not target:
                return {**state, "actors": actors}, "Skill unavailable"
            log_msg = _apply_skill(state, actor, target, skill_ref, charge_cell)

        elif action == "enemy_attack":
            if actor["type"] != "enemy":
                return {**state, "actors": actors}, "Not an enemy"
            target = pick_enemy_target({**state, "actors": actors}, actor)
            if not target:
                return {**state, "actors": actors}, "No valid target"
            if not can_melee_attack({**state, "actors": actors}, actor, target):
                return {**state, "actors": actors}, "No valid target"
            log_msg = _execute_melee_attack(state, actor, target, None, is_enemy=True)

        else:
            return {**state, "actors": actors}, f"Unknown action: {action}"
    except ValueError as exc:
        return {**state, "actors": actors}, str(exc)

    state["actors"] = actors
    state["log"] = state.get("log", []) + [_log_entry(log_msg)]
    state = _check_battle_end(state)
    if state["status"] == "active":
        state = _advance_turn(state)
        state = resolve_auto_turns(state)
        if state.get("status") == "active":
            next_name = _actor_name(state, state.get("active_actor_id"))
            if state.get("log") and "turn." not in state["log"][-1]["message"]:
                state["log"] = state.get("log", []) + [_log_entry(f"{next_name}'s turn.")]
    return state, "ok"


def resolve_auto_turns(state: dict[str, Any], max_iters: int = 30) -> dict[str, Any]:
    iters = 0
    while state.get("status") == "active" and iters < max_iters:
        active_id = state.get("active_actor_id")
        actor = _get_actor(state, active_id)
        if not actor or actor["type"] != "enemy":
            break
        state, msg = perform_action(state, active_id, "enemy_attack")
        if msg != "ok":
            break
        iters += 1
    return state


def end_battle(state: dict[str, Any], reason: str = "master_ended") -> dict[str, Any]:
    state = dict(state)
    state["status"] = "completed"
    state["end_reason"] = reason
    state["active_actor_id"] = None
    state["log"] = state.get("log", []) + [_log_entry("The Master ended the battle.")]
    return state


def sync_party_hp_to_characters(db: Session, state: dict[str, Any]) -> None:
    for actor in state.get("actors", []):
        if actor["type"] != "player":
            continue
        character = db.get(Character, actor["character_id"])
        if character:
            character.current_hp = max(0, actor["current_hp"])
            for skill_data in actor.get("skills", []):
                skill = db.get(Skill, skill_data["id"])
                if skill:
                    skill.uses_remaining = skill_data["uses_remaining"]
            for cons in actor.get("consumables") or []:
                inv = db.get(InventoryItem, cons["inventory_item_id"])
                if inv:
                    inv.quantity = max(0, cons.get("quantity", inv.quantity))


def battle_action_hints(state: dict[str, Any], actor_id: str) -> dict[str, Any]:
    """Legal targets and cells for UI."""
    actor = _get_actor(state, actor_id)
    if not actor:
        return {}
    wp = _weapon_profile(actor)
    hints: dict[str, Any] = {
        "move_cells": [{"x": x, "y": y} for x, y in reachable_cells(state, actor, MOVE_MAX_STEPS)],
        "guard_cells": [{"x": x, "y": y} for x, y in reachable_cells(state, actor, GUARD_MAX_STEPS)],
        "melee_targets": [],
        "range_targets": [],
        "skill_range_targets": [],
        "can_melee": bool(wp.get("can_melee")),
        "can_ranged": bool(wp.get("can_ranged")),
    }
    max_range = int(wp.get("weapon_range", DEFAULT_RANGE_DISTANCE))
    for other in state.get("actors", []):
        if other["id"] == actor_id or not other["alive"]:
            continue
        if other["type"] == actor["type"]:
            continue
        if can_range_attack(state, actor, other, DEFAULT_RANGE_DISTANCE):
            hints["skill_range_targets"].append(other["id"])
        if wp.get("can_melee") and can_melee_attack(state, actor, other):
            entry = {"id": other["id"], "charge_cells": []}
            if not is_adjacent(actor_pos(actor), actor_pos(other)):
                entry["charge_cells"] = [
                    {"x": x, "y": y} for x, y in adjacent_empty_cells(state, other, exclude_actor_id=actor_id)
                ]
            hints["melee_targets"].append(entry)
        if wp.get("can_ranged") and can_range_attack(state, actor, other, max_range):
            hints["range_targets"].append(other["id"])
    return hints
