import random
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import Battle, Campaign, Character, EnemyTemplate, InventoryItem, Skill
from app.services.character_stats import aggregate_battle_modifiers, compute_max_hp, effective_stats, weapon_attack_bonus
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


def build_battle_state(
    db: Session,
    campaign: Campaign,
    party: list[Character],
    enemy_specs: list[dict],
    group_initiative_bonus: float = 0.0,
    enemy_initiative_bonus: float = 0.0,
) -> dict[str, Any]:
    actors: list[dict[str, Any]] = []
    group_size = len(party)
    enemy_count = sum(s.get("count", 1) for s in enemy_specs)
    total_combatants = group_size + enemy_count

    for character in party:
        db.refresh(character, ["inventory_items", "temporary_effects", "skills"])
        for inv in character.inventory_items:
            db.refresh(inv, ["item_template"])
        for skill in character.skills:
            db.refresh(skill, ["skill_template"])
        eff = effective_stats(character.stats, character.inventory_items, character.temporary_effects)
        init_stat = eff.get("initiative", 8)
        per_turn = (1 + init_stat / 20) / total_combatants
        actor = {
            "id": _actor_id("player", character.id),
            "type": "player",
            "character_id": character.id,
            "name": character.name,
            "initiative_stat": init_stat,
            "per_turn_value": per_turn,
            "initiative_value": group_initiative_bonus + random.uniform(0, 0.0001) + per_turn,
            "current_hp": character.current_hp,
            "max_hp": character.max_hp,
            "stats": eff,
            "attack_bonus": weapon_attack_bonus(character.inventory_items, eff),
            "alive": character.current_hp > 0,
            "shield_hp": 0,
            "battle_stat_mods": {},
            "battle_modifiers": aggregate_battle_modifiers(character.temporary_effects),
            "skills": [
                {
                    "id": s.id,
                    "name": s.name,
                    "uses_remaining": s.uses_remaining,
                    **{k: skill_battle_meta(s)[k] for k in ("effect_type", "effect_params")},
                }
                for s in character.skills
            ],
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
                "initiative_value": enemy_initiative_bonus + random.uniform(0, 0.0001) + per_turn,
                "current_hp": _enemy_hp(stats),
                "max_hp": _enemy_hp(stats),
                "stats": stats,
                "attack_bonus": stats.get("damage", 2) + stats.get("strength", 8) // 3,
                "alive": True,
                "shield_hp": 0,
                "battle_stat_mods": {},
            })

    return {
        "status": "pending",
        "group_initiative_bonus": group_initiative_bonus,
        "enemy_initiative_bonus": enemy_initiative_bonus,
        "actors": actors,
        "active_actor_id": None,
        "log": [],
        "end_reason": None,
        "winner": None,
    }


def start_battle(state: dict[str, Any]) -> dict[str, Any]:
    state = dict(state)
    state["status"] = "active"
    state["active_actor_id"] = _pick_next_actor(state)
    state["log"] = state.get("log", []) + [
        _log_entry(f"Battle begins! { _actor_name(state, state['active_actor_id'])} acts first.")
    ]
    return state


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
    for a in state["actors"]:
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
    return state


def _check_battle_end(state: dict[str, Any]) -> dict[str, Any]:
    players = [a for a in state["actors"] if a["type"] == "player"]
    enemies = [a for a in state["actors"] if a["type"] == "enemy"]
    players_alive = any(a["alive"] for a in players)
    enemies_alive = any(a["alive"] for a in enemies)

    if not players_alive:
        state["status"] = "completed"
        state["end_reason"] = "party_defeated"
        state["winner"] = "enemies"
        state["active_actor_id"] = None
    elif not enemies_alive:
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


def _apply_damage(target: dict, damage: int) -> tuple[int, int]:
    """Apply damage to shield first, then HP. Returns (hp_damage, shield_absorbed)."""
    remaining = max(0, damage)
    shield_absorbed = 0
    shield = int(target.get("shield_hp") or 0)
    if shield > 0 and remaining > 0:
        shield_absorbed = min(shield, remaining)
        target["shield_hp"] = shield - shield_absorbed
        remaining -= shield_absorbed
    hp_damage = 0
    if remaining > 0:
        hp_damage = remaining
        target["current_hp"] = max(0, target["current_hp"] - remaining)
        if target["current_hp"] <= 0:
            target["alive"] = False
    return hp_damage, shield_absorbed


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


def _apply_skill(
    actor: dict,
    target: dict | None,
    skill: dict,
) -> str:
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

    if effect == "melee":
        if not target or not target["alive"] or actor["type"] == target["type"]:
            raise ValueError("Invalid target")
        bonus = int(params.get("bonus_damage", 0))
        roll = random.randint(1, 8)
        damage = max(1, actor.get("attack_bonus", 0) + roll + bonus - _mitigation(target) + _battle_damage_mod(actor))
        _, shield_abs = _apply_damage(target, damage)
        skill["uses_remaining"] -= 1
        msg = f"{actor['name']} uses {name} (melee) on {target['name']} for {damage} damage!"
        if shield_abs:
            msg += f" ({shield_abs} absorbed by shield)"
        if not target["alive"]:
            msg += f" {target['name']} is defeated!"
        return msg

    if effect == "range":
        if not target or not target["alive"] or actor["type"] == target["type"]:
            raise ValueError("Invalid target")
        bonus = int(params.get("bonus_damage", 0))
        range_stat = params.get("range_stat", "dexterity")
        if range_stat not in actor.get("stats", {}):
            range_stat = "dexterity"
        roll = random.randint(1, 6)
        damage = max(1, _actor_stat(actor, range_stat) // 2 + roll + bonus - _mitigation(target) + _battle_damage_mod(actor))
        _, shield_abs = _apply_damage(target, damage)
        skill["uses_remaining"] -= 1
        msg = f"{actor['name']} uses {name} (range) on {target['name']} for {damage} damage!"
        if shield_abs:
            msg += f" ({shield_abs} absorbed by shield)"
        if not target["alive"]:
            msg += f" {target['name']} is defeated!"
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
                actor_str_gain = bonus // 3
                if actor_str_gain:
                    target["attack_bonus"] = target.get("attack_bonus", 0) + actor_str_gain
            skill["uses_remaining"] -= 1
            return f"{actor['name']} uses {name} — {target['name']} gains +{bonus} {stat} for this battle!"
        raise ValueError("Unknown support mode")

    raise ValueError("Skill not usable in battle")


def perform_action(
    state: dict[str, Any],
    actor_id: str,
    action: str,
    target_id: str | None = None,
    skill_id: int | None = None,
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

    if action == "attack":
        if not target_id:
            return {**state, "actors": actors}, "Target required"
        target = next((a for a in actors if a["id"] == target_id), None)
        if not target or not target["alive"]:
            return {**state, "actors": actors}, "Invalid target"
        if actor["type"] == target["type"]:
            return {**state, "actors": actors}, "Cannot attack allies"

        roll = random.randint(1, 6)
        dmg_mod = _battle_damage_mod(actor) if actor["type"] == "player" else 0
        damage = max(1, actor.get("attack_bonus", 0) + roll - _mitigation(target) + dmg_mod)
        _, shield_abs = _apply_damage(target, damage)
        log_msg = f"{actor['name']} attacks {target['name']} for {damage} damage!"
        if shield_abs:
            log_msg += f" ({shield_abs} absorbed by shield)"
        if not target["alive"]:
            log_msg += f" {target['name']} is defeated!"

    elif action in ("skill", "heal", "power_strike"):
        if actor["type"] != "player":
            return {**state, "actors": actors}, "Only players can use skills"
        skill = _find_skill(actor, skill_id, action)
        if not skill or skill["uses_remaining"] <= 0:
            return {**state, "actors": actors}, "Skill unavailable"
        effect = normalize_effect_type(skill.get("effect_type", "none"))
        if effect == "none":
            return {**state, "actors": actors}, "Skill not usable in battle"

        target = None
        if effect in ("heal", "support"):
            target = actor
            if target_id:
                target = next((a for a in actors if a["id"] == target_id), None)
        else:
            if not target_id:
                return {**state, "actors": actors}, "Target required"
            target = next((a for a in actors if a["id"] == target_id), None)

        skill_ref = next((s for s in actor.get("skills", []) if s["id"] == skill["id"]), None)
        if not skill_ref:
            return {**state, "actors": actors}, "Skill unavailable"

        try:
            log_msg = _apply_skill(actor, target, skill_ref)
        except ValueError as exc:
            return {**state, "actors": actors}, str(exc)

    elif action == "enemy_attack":
        if actor["type"] != "enemy":
            return {**state, "actors": actors}, "Not an enemy"
        if not target_id:
            target_id = next((a["id"] for a in actors if a["type"] == "player" and a["alive"]), None)
        target = next((a for a in actors if a["id"] == target_id), None) if target_id else None
        if not target or not target["alive"]:
            return {**state, "actors": actors}, "No valid target"
        roll = random.randint(1, 6)
        damage = max(1, actor.get("attack_bonus", 0) + roll - _mitigation(target))
        _, shield_abs = _apply_damage(target, damage)
        log_msg = f"{actor['name']} attacks {target['name']} for {damage} damage!"
        if shield_abs:
            log_msg += f" ({shield_abs} absorbed by shield)"
        if not target["alive"]:
            log_msg += f" {target['name']} is down!"

    else:
        return {**state, "actors": actors}, f"Unknown action: {action}"

    state["actors"] = actors
    state["log"] = state.get("log", []) + [_log_entry(log_msg)]
    state = _check_battle_end(state)

    if state["status"] == "active":
        state = _advance_turn(state)
        next_name = _actor_name(state, state.get("active_actor_id"))
        state["log"] = state.get("log", []) + [_log_entry(f"{next_name}'s turn.")]

    return state, "ok"


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
