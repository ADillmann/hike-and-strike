"""Tests for equipped weapon profile (melee vs ranged)."""

from types import SimpleNamespace

from app.services.battle_engine import battle_action_hints, perform_action
from app.services.character_stats import equipped_weapon_profile


def _item(item_type: str, stats: dict, slot: str | None = None):
    return SimpleNamespace(
        equipped_slot=slot,
        item_template=SimpleNamespace(item_type=item_type, stats=stats),
    )


def _stats(**kwargs):
    base = {"strength": 12, "dexterity": 14, "intelligence": 10}
    base.update(kwargs)
    return base


def test_weapon_profile_unarmed_melee():
    profile = equipped_weapon_profile([], _stats())
    assert profile["can_melee"] is True
    assert profile["can_ranged"] is False
    assert profile["melee_attack_bonus"] == 4  # 12 // 3


def test_weapon_profile_melee_weapon():
    inv = [_item("weapon", {"damage": 4, "weapon_class": "melee"}, "right_hand")]
    profile = equipped_weapon_profile(inv, _stats())
    assert profile["can_melee"] is True
    assert profile["can_ranged"] is False
    assert profile["melee_attack_bonus"] == 8  # 4 + 12//3


def test_weapon_profile_shield_melee():
    inv = [_item("shield", {"armor_bonus": 1}, "left_hand")]
    profile = equipped_weapon_profile(inv, _stats())
    assert profile["can_melee"] is True
    assert profile["melee_attack_bonus"] >= 4


def test_weapon_profile_ranged_without_two_handed_flag():
    inv = [_item("weapon", {"damage": 3, "weapon_class": "range", "range": 4}, "right_hand")]
    profile = equipped_weapon_profile(inv, _stats())
    assert profile["can_ranged"] is True
    assert profile["can_melee"] is False


def test_weapon_profile_ranged_two_handed():
    inv = [_item("weapon", {"damage": 3, "weapon_class": "range", "two_handed": True, "range": 5}, "right_hand")]
    profile = equipped_weapon_profile(inv, _stats())
    assert profile["can_melee"] is False
    assert profile["can_ranged"] is True
    assert profile["ranged_attack_bonus"] == 7
    assert profile["weapon_range"] == 5


def _battle_state(actor: dict):
    enemy = {
        "id": "enemy_1_0",
        "type": "enemy",
        "name": "Goblin",
        "alive": True,
        "initiative_value": 1.0,
        "per_turn_value": 0.3,
        "current_hp": 10,
        "max_hp": 10,
        "position": {"x": 4, "y": 2},
        "guarding": False,
        "attack_bonus": 2,
        "stats": {"strength": 8},
    }
    return {
        "status": "active",
        "grid": {"width": 5, "height": 5},
        "actors": [actor, enemy],
        "active_actor_id": actor["id"],
        "log": [],
    }


def test_battle_hints_melee_only():
    actor = {
        "id": "player_1_0",
        "type": "player",
        "alive": True,
        "position": {"x": 0, "y": 2},
        "weapon_profile": {
            "can_melee": True,
            "can_ranged": False,
            "melee_attack_bonus": 8,
            "ranged_attack_bonus": 0,
            "weapon_range": 4,
        },
        "attack_bonus": 8,
    }
    hints = battle_action_hints(_battle_state(actor), "player_1_0")
    assert hints["can_melee"] is True
    assert hints["can_ranged"] is False
    assert len(hints["melee_targets"]) >= 1
    assert hints["range_targets"] == []


def test_battle_hints_ranged_only():
    actor = {
        "id": "player_1_0",
        "type": "player",
        "alive": True,
        "position": {"x": 0, "y": 2},
        "weapon_profile": {
            "can_melee": False,
            "can_ranged": True,
            "melee_attack_bonus": 0,
            "ranged_attack_bonus": 7,
            "weapon_range": 4,
        },
        "attack_bonus": 0,
    }
    hints = battle_action_hints(_battle_state(actor), "player_1_0")
    assert hints["can_melee"] is False
    assert hints["can_ranged"] is True
    assert hints["melee_targets"] == []
    assert len(hints["range_targets"]) >= 1


def test_attack_rejected_without_melee_weapon():
    actor = {
        "id": "player_1_0",
        "type": "player",
        "name": "Archer",
        "alive": True,
        "initiative_value": 5.0,
        "per_turn_value": 0.5,
        "current_hp": 20,
        "max_hp": 20,
        "position": {"x": 0, "y": 2},
        "guarding": False,
        "weapon_profile": {
            "can_melee": False,
            "can_ranged": True,
            "melee_attack_bonus": 0,
            "ranged_attack_bonus": 7,
            "weapon_range": 4,
        },
        "attack_bonus": 0,
        "consumables": [],
        "skills": [],
        "battle_modifiers": {},
    }
    state = _battle_state(actor)
    new_state, msg = perform_action(state, "player_1_0", "attack", target_id="enemy_1_0")
    assert msg == "No melee weapon equipped"


def test_ranged_attack_action():
    actor = {
        "id": "player_1_0",
        "type": "player",
        "name": "Archer",
        "alive": True,
        "initiative_value": 5.0,
        "per_turn_value": 0.5,
        "current_hp": 20,
        "max_hp": 20,
        "position": {"x": 0, "y": 2},
        "guarding": False,
        "weapon_profile": {
            "can_melee": False,
            "can_ranged": True,
            "melee_attack_bonus": 0,
            "ranged_attack_bonus": 7,
            "weapon_range": 4,
        },
        "attack_bonus": 0,
        "consumables": [],
        "skills": [],
        "stats": {"strength": 10, "dexterity": 14},
        "battle_modifiers": {},
    }
    state = _battle_state(actor)
    new_state, msg = perform_action(state, "player_1_0", "ranged_attack", target_id="enemy_1_0")
    assert msg == "ok"
    enemy = next(a for a in new_state["actors"] if a["id"] == "enemy_1_0")
    assert enemy["current_hp"] < 10
