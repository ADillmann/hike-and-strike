"""Skill slot capacity from character stats."""

from __future__ import annotations

from app.game.constants import STAT_DEFAULT
from app.services.skill_effects import normalize_effect_type

MELEE_THRESHOLDS = (10, 15, 20)
RANGE_THRESHOLDS = (10, 13, 16, 19, 20)
SUPPORT_THRESHOLDS = (10, 13, 16, 19, 20)

SLOT_KINDS = ("melee", "range", "support")
FLEXIBLE_EFFECT_TYPES = frozenset({"heal", "none"})
# Heal / passives share range+support tracks; melee slots stay melee-only.
FLEXIBLE_SLOT_KINDS = ("range", "support")


def _threshold_count(value: int, thresholds: tuple[int, ...]) -> int:
    return sum(1 for t in thresholds if value >= t)


def melee_slots(stats: dict) -> int:
    strength = int(stats.get("strength", STAT_DEFAULT))
    dexterity = int(stats.get("dexterity", STAT_DEFAULT))
    return _threshold_count(strength, MELEE_THRESHOLDS) + _threshold_count(dexterity, MELEE_THRESHOLDS)


def range_slots(stats: dict) -> int:
    return _threshold_count(int(stats.get("intelligence", STAT_DEFAULT)), RANGE_THRESHOLDS)


def support_slots(stats: dict) -> int:
    return _threshold_count(int(stats.get("charisma", STAT_DEFAULT)), SUPPORT_THRESHOLDS)


def slot_capacity(stats: dict) -> dict[str, int]:
    return {
        "melee": melee_slots(stats),
        "range": range_slots(stats),
        "support": support_slots(stats),
    }


def effect_kind(effect_type: str) -> str:
    """Return melee|range|support|heal|none."""
    return normalize_effect_type(effect_type or "none")


def allowed_slots_for_effect(effect_type: str) -> list[str]:
    kind = effect_kind(effect_type)
    if kind in SLOT_KINDS:
        return [kind]
    if kind in FLEXIBLE_EFFECT_TYPES:
        return list(FLEXIBLE_SLOT_KINDS)
    return list(FLEXIBLE_SLOT_KINDS)


def needs_slot_choice(effect_type: str) -> bool:
    return effect_kind(effect_type) in FLEXIBLE_EFFECT_TYPES


def resolve_slot(effect_type: str, chosen: str | None) -> str:
    """Return the slot kind to occupy. Raises ValueError if invalid/missing."""
    allowed = allowed_slots_for_effect(effect_type)
    kind = effect_kind(effect_type)
    if kind in SLOT_KINDS:
        return kind
    if not chosen:
        raise ValueError("Choose a skill slot (range or support)")
    if chosen not in allowed:
        raise ValueError(f"Invalid slot_kind '{chosen}' for this skill")
    return chosen

def slot_usage_from_kinds(slot_kinds: list[str]) -> dict[str, int]:
    used = {"melee": 0, "range": 0, "support": 0}
    for kind in slot_kinds:
        if kind in used:
            used[kind] += 1
    return used


def slots_within_capacity(stats: dict, slot_kinds: list[str]) -> bool:
    capacity = slot_capacity(stats)
    used = slot_usage_from_kinds(slot_kinds)
    return all(used[k] <= capacity[k] for k in SLOT_KINDS)


def can_add_resolved(stats: dict, owned_slot_kinds: list[str], new_slot_kind: str) -> bool:
    """True if the target slot track still has room (ignores overfill on other tracks)."""
    if new_slot_kind not in SLOT_KINDS:
        return False
    capacity = slot_capacity(stats)
    used = slot_usage_from_kinds(owned_slot_kinds)
    return used[new_slot_kind] < capacity[new_slot_kind]


def slot_summary(stats: dict, slot_kinds: list[str]) -> dict[str, dict[str, int]]:
    capacity = slot_capacity(stats)
    used = slot_usage_from_kinds(slot_kinds)
    return {k: {"used": used[k], "max": capacity[k]} for k in SLOT_KINDS}


def slot_full_message(slot_kind: str) -> str:
    if slot_kind in SLOT_KINDS:
        return f"No free {slot_kind} skill slots"
    return "Cannot learn this skill"


def default_slot_for_backfill(effect_type: str) -> str:
    kind = effect_kind(effect_type)
    if kind in SLOT_KINDS:
        return kind
    return "support"
