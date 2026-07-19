import pytest

from app.services.character_stats import bonus_points_spent, validate_class_point_buy
from app.services.skill_slots import (
    allowed_slots_for_effect,
    can_add_resolved,
    melee_slots,
    needs_slot_choice,
    range_slots,
    resolve_slot,
    slot_capacity,
    slot_usage_from_kinds,
    slots_within_capacity,
    support_slots,
)


def test_melee_slots_by_str_and_dex():
    assert melee_slots({"strength": 8, "dexterity": 8}) == 0
    assert melee_slots({"strength": 10, "dexterity": 8}) == 1
    assert melee_slots({"strength": 10, "dexterity": 10}) == 2
    assert melee_slots({"strength": 15, "dexterity": 10}) == 3
    assert melee_slots({"strength": 15, "dexterity": 15}) == 4
    assert melee_slots({"strength": 20, "dexterity": 20}) == 6


def test_range_and_support_thresholds():
    assert range_slots({"intelligence": 8}) == 0
    assert range_slots({"intelligence": 10}) == 1
    assert range_slots({"intelligence": 13}) == 2
    assert range_slots({"intelligence": 16}) == 3
    assert range_slots({"intelligence": 19}) == 4
    assert range_slots({"intelligence": 20}) == 5
    assert support_slots({"charisma": 8}) == 0
    assert support_slots({"charisma": 10}) == 1
    assert support_slots({"charisma": 20}) == 5


def test_allowed_slots_and_resolve():
    assert allowed_slots_for_effect("melee") == ["melee"]
    assert allowed_slots_for_effect("heal") == ["range", "support"]
    assert needs_slot_choice("heal")
    assert needs_slot_choice("none")
    assert not needs_slot_choice("range")
    assert resolve_slot("melee", None) == "melee"
    assert resolve_slot("heal", "support") == "support"
    assert resolve_slot("heal", "range") == "range"
    assert resolve_slot("melee", "range") == "melee"  # fixed types ignore chosen
    with pytest.raises(ValueError):
        resolve_slot("heal", None)
    with pytest.raises(ValueError, match="Invalid slot_kind"):
        resolve_slot("heal", "melee")
    with pytest.raises(ValueError):
        resolve_slot("none", "weapon")

def test_resolved_slot_capacity():
    stats = {"strength": 10, "dexterity": 10, "intelligence": 10, "charisma": 10}
    assert can_add_resolved(stats, ["range"], "heal") is False  # heal is not a slot kind
    assert can_add_resolved(stats, ["range"], "support")
    assert not can_add_resolved(stats, ["range"], "range")  # only 1 range slot at INT 10
    assert can_add_resolved(stats, ["support"] * 20, "range")  # other-track overfill ignored
    assert slots_within_capacity(stats, ["melee", "range", "support"])
    assert slot_usage_from_kinds(["heal", "range"])["range"] == 1


def test_class_point_buy():
    base = {
        "strength": 12,
        "dexterity": 8,
        "intelligence": 8,
        "durability": 11,
        "charisma": 8,
        "initiative": 8,
    }
    final = {**base, "strength": 13, "dexterity": 9}
    assert bonus_points_spent(base, final) == 2
    validate_class_point_buy(base, final, 2)
    with pytest.raises(ValueError, match="exceed"):
        validate_class_point_buy(base, final, 1)
    with pytest.raises(ValueError, match="below class base"):
        validate_class_point_buy(base, {**base, "strength": 11}, 10)


def test_slot_capacity_helpers():
    cap = slot_capacity({
        "strength": 15,
        "dexterity": 15,
        "intelligence": 16,
        "charisma": 13,
    })
    assert cap == {"melee": 4, "range": 3, "support": 2}
