import random
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.game.constants import STAT_NAMES
from app.models import Character, InventoryItem, ItemTemplate, SecretTemplate
from app.services.campaign_engine import apply_effect_template, grant_item
from app.services.character_progression import campaign_has_active_battle, grant_xp
from app.services.character_stats import effective_stats
from app.services.secret_solvers import get_solver, validate_solver_type


def _character_active_campaign_ids(db: Session, character_id: int) -> list[int]:
    from app.models import Campaign, GroupMember

    rows = (
        db.query(Campaign.id)
        .join(GroupMember, GroupMember.group_id == Campaign.group_id)
        .filter(GroupMember.character_id == character_id, Campaign.status == "active")
        .all()
    )
    return [row[0] for row in rows]


def _xp_blocked_in_battle(db: Session, character_id: int) -> bool:
    for campaign_id in _character_active_campaign_ids(db, character_id):
        if campaign_has_active_battle(db, campaign_id):
            return True
    return False


def run_examine_check(character: Character, secret: SecretTemplate) -> tuple[bool, int, int]:
    eff = effective_stats(character.stats, character.inventory_items, character.temporary_effects)
    stat_name = secret.examine_stat if secret.examine_stat in STAT_NAMES else "intelligence"
    stat_val = eff.get(stat_name, 8)
    dc = secret.examine_dc
    if secret.examine_mode == "stat_vs_dc":
        return stat_val >= dc, stat_val, dc
    roll = random.randint(1, 20) + stat_val
    return roll >= dc, roll, dc


def apply_secret_rewards(db: Session, character_id: int, rewards: dict | None) -> None:
    if not rewards:
        return
    character = db.get(Character, character_id)
    if not character:
        return

    for entry in rewards.get("items", []):
        item_id = entry.get("item_template_id") if isinstance(entry, dict) else entry
        if item_id:
            grant_item(db, character_id, int(item_id))

    xp = rewards.get("xp")
    if isinstance(xp, (int, float)) and xp > 0:
        if not _xp_blocked_in_battle(db, character_id):
            grant_xp(db, character, int(xp), None, None)

    for entry in rewards.get("temp_effects", []):
        template_id = entry.get("effect_template_id") if isinstance(entry, dict) else None
        if template_id:
            apply_effect_template(db, character_id, int(template_id))


def get_secret_inventory_item(db: Session, character_id: int, inventory_item_id: int) -> InventoryItem:
    inv = (
        db.query(InventoryItem)
        .options(
            joinedload(InventoryItem.item_template).joinedload(ItemTemplate.secret_template),
        )
        .filter(InventoryItem.id == inventory_item_id, InventoryItem.character_id == character_id)
        .first()
    )
    if not inv or not inv.item_template:
        raise ValueError("Item not found")
    if inv.item_template.item_type != "secret":
        raise ValueError("This item is not a secret item")
    if inv.equipped_slot:
        raise ValueError("Cannot interact with equipped items")
    if not inv.item_template.secret_template_id:
        raise ValueError("Secret item has no puzzle configured")
    return inv


def examine_secret_item(db: Session, character: Character, inventory_item_id: int) -> dict[str, Any]:
    inv = get_secret_inventory_item(db, character.id, inventory_item_id)
    secret = inv.item_template.secret_template or db.get(SecretTemplate, inv.item_template.secret_template_id)
    if not secret:
        raise ValueError("Secret puzzle not found")

    state = dict(inv.secret_state or {})
    if state.get("revealed"):
        return {
            "success": True,
            "message": secret.revealed_description,
            "revealed_description": secret.revealed_description,
            "can_solve": True,
        }

    success, _roll, _dc = run_examine_check(character, secret)
    state["examined"] = True
    inv.secret_state = state

    if success:
        state["revealed"] = True
        inv.secret_state = state
        return {
            "success": True,
            "message": secret.revealed_description,
            "revealed_description": secret.revealed_description,
            "can_solve": True,
        }

    return {
        "success": False,
        "message": secret.fail_message_examine or "Nothing happens...",
    }


def solve_secret_item(
    db: Session,
    character: Character,
    inventory_item_id: int,
    guess: str,
) -> dict[str, Any]:
    inv = get_secret_inventory_item(db, character.id, inventory_item_id)
    secret = inv.item_template.secret_template or db.get(SecretTemplate, inv.item_template.secret_template_id)
    if not secret:
        raise ValueError("Secret puzzle not found")

    state = inv.secret_state or {}
    if not state.get("revealed"):
        raise ValueError("Examine the item before trying to solve it")

    solver = get_solver(secret.solver_type)
    if solver.verify_guess(secret.solver_config or {}, guess):
        apply_secret_rewards(db, character.id, secret.rewards or {})
        if secret.consume_on_solve:
            db.delete(inv)
        return {"success": True, "message": "Success!"}

    return {
        "success": False,
        "message": secret.fail_message_solve or "That doesn't work.",
    }


def secret_inventory_payload(inv: InventoryItem, secret: SecretTemplate | None) -> dict[str, Any]:
    state = inv.secret_state or {}
    revealed = bool(state.get("revealed"))
    payload: dict[str, Any] = {
        "secret_template_id": inv.item_template.secret_template_id if inv.item_template else None,
        "secret_state": {"examined": bool(state.get("examined")), "revealed": revealed},
    }
    if secret and revealed:
        payload["revealed_description"] = secret.revealed_description
        payload["secret_solver_type"] = secret.solver_type
        try:
            payload["secret_solver_hints"] = get_solver(secret.solver_type).client_hints(secret.solver_config or {})
        except ValueError:
            payload["secret_solver_hints"] = {}
    return payload
