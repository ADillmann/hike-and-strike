from typing import Any

from sqlalchemy.orm import Session

from app.models import Campaign, CampaignEventNode, Character, EventTemplate, InventoryItem, ItemTemplate
from app.services.campaign_engine import get_active_campaign_for_character, grant_item
from app.services.character_stats import stacks_in_inventory
from app.services.currency import calc_buy_price, calc_sell_price, format_price, format_wallet, get_system_currency_settings


def _get_shop_event(db: Session, campaign: Campaign) -> EventTemplate:
    if not campaign.current_node_id:
        raise ValueError("No current event")
    node = db.get(CampaignEventNode, campaign.current_node_id)
    if not node:
        raise ValueError("Invalid campaign node")
    template = db.get(EventTemplate, node.event_template_id)
    if not template or template.event_type != "shop":
        raise ValueError("Not at a shop event")
    return template


def _shop_config(template: EventTemplate) -> dict:
    config = template.shop_config or {}
    allowed = config.get("allowed_tiers") or [1]
    if not isinstance(allowed, list) or not allowed:
        allowed = [1]
    return {
        "allowed_tiers": [int(t) for t in allowed],
        "buy_modifier_percent": int(config.get("buy_modifier_percent", 0)),
    }


def get_shop_catalog(db: Session, character: Character, campaign: Campaign) -> dict[str, Any]:
    template = _get_shop_event(db, campaign)
    config = _shop_config(template)
    settings = get_system_currency_settings(db)
    items = (
        db.query(ItemTemplate)
        .filter(ItemTemplate.tier.in_(config["allowed_tiers"]), ItemTemplate.item_type != "secret")
        .order_by(ItemTemplate.tier, ItemTemplate.name)
        .all()
    )
    catalog = []
    for item in items:
        base = item.base_price or 0
        buy_price = calc_buy_price(base, config["buy_modifier_percent"])
        if buy_price <= 0 and base <= 0:
            continue
        catalog.append({
            "id": item.id,
            "name": item.name,
            "tier": item.tier,
            "item_type": item.item_type,
            "description": item.description,
            "base_price": base,
            "buy_price": buy_price,
            "buy_price_display": format_price(buy_price, settings),
        })
    return {
        "shop_name": template.name,
        "buy_modifier_percent": config["buy_modifier_percent"],
        "wallet_copper": character.wallet_copper,
        "wallet_display": format_wallet(character.wallet_copper, settings),
        "items": catalog,
    }


def get_shop_sellables(db: Session, character: Character, campaign: Campaign) -> dict[str, Any]:
    _get_shop_event(db, campaign)
    settings = get_system_currency_settings(db)
    sellables = []
    for inv in character.inventory_items:
        if inv.equipped_slot:
            continue
        template = inv.item_template
        if not template or (template.base_price or 0) <= 0:
            continue
        sell_price = calc_sell_price(template.base_price)
        sellables.append({
            "inventory_item_id": inv.id,
            "name": template.name,
            "tier": template.tier,
            "quantity": inv.quantity,
            "base_price": template.base_price,
            "sell_price": sell_price,
            "sell_price_display": format_price(sell_price, settings),
        })
    return {
        "wallet_copper": character.wallet_copper,
        "wallet_display": format_wallet(character.wallet_copper, settings),
        "items": sellables,
    }


def shop_buy(db: Session, character: Character, campaign: Campaign, item_template_id: int) -> None:
    template = _get_shop_event(db, campaign)
    config = _shop_config(template)
    item = db.get(ItemTemplate, item_template_id)
    if not item or item.tier not in config["allowed_tiers"]:
        raise ValueError("Item not available in this shop")
    if item.item_type == "secret":
        raise ValueError("Item not available in this shop")
    buy_price = calc_buy_price(item.base_price or 0, config["buy_modifier_percent"])
    if buy_price <= 0:
        raise ValueError("Item is not for sale")
    if character.wallet_copper < buy_price:
        raise ValueError("Not enough currency")
    character.wallet_copper -= buy_price
    grant_item(db, character.id, item_template_id)


def shop_sell(db: Session, character: Character, campaign: Campaign, inventory_item_id: int) -> None:
    _get_shop_event(db, campaign)
    inv = db.get(InventoryItem, inventory_item_id)
    if not inv or inv.character_id != character.id:
        raise ValueError("Item not found")
    if inv.equipped_slot:
        raise ValueError("Cannot sell equipped items")
    template = inv.item_template
    if not template or (template.base_price or 0) <= 0:
        raise ValueError("Item cannot be sold")
    sell_price = calc_sell_price(template.base_price)
    if sell_price <= 0:
        raise ValueError("Item cannot be sold")
    character.wallet_copper += sell_price
    if stacks_in_inventory(template) and inv.quantity > 1:
        inv.quantity -= 1
    else:
        db.delete(inv)


def validate_character_at_shop(db: Session, character: Character) -> Campaign:
    campaign = get_active_campaign_for_character(db, character.id)
    if not campaign or campaign.status not in ("active", "paused"):
        raise ValueError("No active campaign")
    _get_shop_event(db, campaign)
    return campaign
