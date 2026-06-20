from typing import Any

from sqlalchemy.orm import Session

from app.game.constants import STAT_CAP, STAT_NAMES, STAT_POINTS_PER_LEVEL, XP_PER_LEVEL_BASE
from app.models import Battle, Campaign, Character, StatChangeLog


def xp_to_next_level(level: int) -> int:
    return level * XP_PER_LEVEL_BASE


def stat_point_cost(current: int) -> int:
    """Free points required to raise stat from `current` to `current + 1`."""
    if current >= STAT_CAP:
        return 0
    if current < 15:
        return 1
    if current < 17:
        return 2
    if current < 19:
        return 3
    return 4


def stat_raise_costs(stats: dict[str, int]) -> dict[str, int]:
    costs: dict[str, int] = {}
    for name in STAT_NAMES:
        current = stats.get(name, 8)
        cost = stat_point_cost(current)
        if cost > 0:
            costs[name] = cost
    return costs


def points_spent_on_level_allocations(stats: dict[str, int], allocations: dict[str, int]) -> int:
    spent = 0
    for stat_name in STAT_NAMES:
        bumps = allocations.get(stat_name, 0)
        if bumps <= 0:
            continue
        current = stats.get(stat_name, 8)
        base = current - bumps
        for i in range(bumps):
            spent += stat_point_cost(base + i)
    return spent


def sync_stat_points_free(character: Character) -> None:
    """Derive unspent points from level and level_stat_allocations (source of truth)."""
    earned = max(0, character.level - 1) * STAT_POINTS_PER_LEVEL
    allocations = dict(character.level_stat_allocations or {})
    spent = points_spent_on_level_allocations(character.stats or {}, allocations)
    character.stat_points_free = max(0, earned - spent)


def progression_fields(character: Character) -> dict[str, Any]:
    return {
        "level": character.level,
        "xp": character.xp,
        "xp_to_next_level": xp_to_next_level(character.level),
        "stat_points_free": character.stat_points_free,
        "level_stat_allocations": dict(character.level_stat_allocations or {}),
        "stat_raise_costs": stat_raise_costs(character.stats or {}),
        "wallet_copper": character.wallet_copper or 0,
    }


def campaign_has_active_battle(db: Session, campaign_id: int) -> bool:
    battle = (
        db.query(Battle)
        .filter(Battle.campaign_id == campaign_id, Battle.status.in_(["pending", "active"]))
        .first()
    )
    return battle is not None


def character_in_active_battle(db: Session, character_id: int) -> bool:
    from app.services.campaign_engine import get_active_campaign_for_character

    campaign = get_active_campaign_for_character(db, character_id)
    if not campaign:
        return False
    return campaign_has_active_battle(db, campaign.id)


def _log_stat_change(
    db: Session,
    character: Character,
    stat_name: str,
    old_value: int,
    new_value: int,
    reason: str | None,
    master_id: int | None = None,
    campaign_id: int | None = None,
) -> None:
    db.add(
        StatChangeLog(
            character_id=character.id,
            stat_name=stat_name,
            old_value=old_value,
            new_value=new_value,
            reason=reason,
            changed_by_master_id=master_id,
            campaign_id=campaign_id,
        )
    )


def grant_xp(
    db: Session,
    character: Character,
    amount: int,
    master_id: int | None = None,
    campaign_id: int | None = None,
) -> list[str]:
    if amount <= 0:
        return []
    old_xp = character.xp
    character.xp += amount
    _log_stat_change(db, character, "xp", old_xp, character.xp, "XP granted", master_id, campaign_id)

    messages: list[str] = []
    while character.xp >= xp_to_next_level(character.level):
        threshold = xp_to_next_level(character.level)
        character.xp -= threshold
        old_level = character.level
        character.level += 1
        _log_stat_change(
            db,
            character,
            "level",
            old_level,
            character.level,
            "Level up",
            master_id,
            campaign_id,
        )
        messages.append(f"{character.name} reached level {character.level}")
    sync_stat_points_free(character)
    return messages


def allocate_stat_point(
    db: Session,
    character: Character,
    stat_name: str,
) -> None:
    if stat_name not in STAT_NAMES:
        raise ValueError(f"Unknown stat: {stat_name}")
    if character_in_active_battle(db, character.id):
        raise ValueError("Cannot allocate stats during an active battle")

    current = character.stats.get(stat_name, 8)
    cost = stat_point_cost(current)
    if cost <= 0:
        raise ValueError("Stat is already at cap")
    if character.stat_points_free < cost:
        raise ValueError("Not enough free stat points")

    new_value = current + 1
    character.stats = {**character.stats, stat_name: new_value}
    allocations = dict(character.level_stat_allocations or {})
    allocations[stat_name] = allocations.get(stat_name, 0) + 1
    character.level_stat_allocations = allocations
    sync_stat_points_free(character)
    _log_stat_change(db, character, stat_name, current, new_value, "Stat point allocated")


def release_stat_point(
    db: Session,
    character: Character,
    stat_name: str,
    master_id: int,
    campaign_id: int | None = None,
) -> None:
    if stat_name not in STAT_NAMES:
        raise ValueError(f"Unknown stat: {stat_name}")

    allocations = dict(character.level_stat_allocations or {})
    bumps = allocations.get(stat_name, 0)
    if bumps <= 0:
        raise ValueError("No level-allocated points on this stat")

    current = character.stats.get(stat_name, 8)
    new_value = current - 1

    character.stats = {**character.stats, stat_name: new_value}
    allocations[stat_name] = bumps - 1
    if allocations[stat_name] <= 0:
        del allocations[stat_name]
    character.level_stat_allocations = allocations
    sync_stat_points_free(character)
    _log_stat_change(
        db,
        character,
        stat_name,
        current,
        new_value,
        "Released by master",
        master_id,
        campaign_id,
    )
