import random
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import Battle, Campaign, Character, EnemyTemplate, InventoryItem, Skill
from app.services.character_stats import compute_max_hp, effective_stats, weapon_attack_bonus


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
            "skills": [
                {"id": s.id, "name": s.name, "uses_remaining": s.uses_remaining}
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
        damage = max(1, actor.get("attack_bonus", 0) + roll - target["stats"].get("durability", 8) // 4)
        target["current_hp"] = max(0, target["current_hp"] - damage)
        if target["current_hp"] <= 0:
            target["alive"] = False
        log_msg = f"{actor['name']} attacks {target['name']} for {damage} damage!"
        if not target["alive"]:
            log_msg += f" {target['name']} is defeated!"

    elif action == "heal":
        if actor["type"] != "player":
            return {**state, "actors": actors}, "Only players can heal"
        skill = next((s for s in actor.get("skills", []) if s["id"] == skill_id), None)
        if not skill or skill["uses_remaining"] <= 0:
            return {**state, "actors": actors}, "Skill unavailable"
        target = actor
        if target_id:
            target = next((a for a in actors if a["id"] == target_id), None)
        if not target or target["type"] != "player" or not target["alive"]:
            return {**state, "actors": actors}, "Invalid heal target"
        heal_amount = 5 + actor["stats"].get("intelligence", 8) // 2
        target["current_hp"] = min(target["max_hp"], target["current_hp"] + heal_amount)
        skill["uses_remaining"] -= 1
        log_msg = f"{actor['name']} heals {target['name']} for {heal_amount} HP!"

    elif action == "power_strike":
        if not target_id:
            return {**state, "actors": actors}, "Target required"
        target = next((a for a in actors if a["id"] == target_id), None)
        if not target or not target["alive"] or actor["type"] == target["type"]:
            return {**state, "actors": actors}, "Invalid target"
        skill = next((s for s in actor.get("skills", []) if s.get("name") == "Power Strike"), None)
        if not skill or skill["uses_remaining"] <= 0:
            return {**state, "actors": actors}, "Power Strike unavailable"
        roll = random.randint(1, 8)
        damage = max(1, actor.get("attack_bonus", 0) + roll + 3 - target["stats"].get("durability", 8) // 4)
        target["current_hp"] = max(0, target["current_hp"] - damage)
        if target["current_hp"] <= 0:
            target["alive"] = False
        skill["uses_remaining"] -= 1
        log_msg = f"{actor['name']} uses Power Strike on {target['name']} for {damage} damage!"

    elif action == "enemy_attack":
        if actor["type"] != "enemy":
            return {**state, "actors": actors}, "Not an enemy"
        if not target_id:
            target_id = next((a["id"] for a in actors if a["type"] == "player" and a["alive"]), None)
        target = next((a for a in actors if a["id"] == target_id), None) if target_id else None
        if not target or not target["alive"]:
            return {**state, "actors": actors}, "No valid target"
        roll = random.randint(1, 6)
        damage = max(1, actor.get("attack_bonus", 0) + roll - target["stats"].get("durability", 8) // 4)
        target["current_hp"] = max(0, target["current_hp"] - damage)
        if target["current_hp"] <= 0:
            target["alive"] = False
        log_msg = f"{actor['name']} attacks {target['name']} for {damage} damage!"
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


BATTLE_PRESETS = {
    "goblin_crowd": {
        "name": "Goblin Crowd with Goblin King",
        "enemies": [
            {"template_name": "Goblin", "count": 4, "power_scale": 1.0},
            {"template_name": "Goblin King", "count": 1, "power_scale": 1.0},
        ],
    },
    "bandit_ambush": {
        "name": "Bandit Ambush",
        "enemies": [
            {"template_name": "Bandit", "count": 3, "power_scale": 1.0},
        ],
    },
}
