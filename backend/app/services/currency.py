import math

from typing import Any

from sqlalchemy.orm import Session

from app.models import CurrencySettings

DEFAULT_TIER1_NAME = "Copper"
DEFAULT_TIER2_NAME = "Silver"
DEFAULT_TIER3_NAME = "Gold"
DEFAULT_COPPER_PER_SILVER = 100
DEFAULT_SILVER_PER_GOLD = 10

SELL_RATE = 0.5


def copper_per_gold(settings: CurrencySettings) -> int:
    return settings.copper_per_silver * settings.silver_per_gold


def parse_tier_breakdown(copper: int, settings: CurrencySettings) -> dict[str, int]:
    cpg = copper_per_gold(settings)
    gold = copper // cpg if cpg > 0 else 0
    rem = copper % cpg if cpg > 0 else copper
    silver = rem // settings.copper_per_silver if settings.copper_per_silver > 0 else 0
    copper_rem = rem % settings.copper_per_silver if settings.copper_per_silver > 0 else rem
    return {
        "tier1": copper_rem,
        "tier2": silver,
        "tier3": gold,
    }


def format_wallet(copper: int, settings: CurrencySettings) -> str:
    if copper <= 0:
        return f"0 {settings.tier1_name}"
    breakdown = parse_tier_breakdown(copper, settings)
    parts: list[str] = []
    if breakdown["tier3"]:
        parts.append(f"{breakdown['tier3']} {settings.tier3_name}")
    if breakdown["tier2"]:
        parts.append(f"{breakdown['tier2']} {settings.tier2_name}")
    if breakdown["tier1"] or not parts:
        parts.append(f"{breakdown['tier1']} {settings.tier1_name}")
    return ", ".join(parts)


def format_price(copper: int, settings: CurrencySettings) -> str:
    return format_wallet(copper, settings)


def settings_to_dict(settings: CurrencySettings) -> dict[str, Any]:
    return {
        "tier1_name": settings.tier1_name,
        "tier2_name": settings.tier2_name,
        "tier3_name": settings.tier3_name,
        "copper_per_silver": settings.copper_per_silver,
        "silver_per_gold": settings.silver_per_gold,
    }


def get_system_currency_settings(db: Session) -> CurrencySettings:
    row = db.query(CurrencySettings).filter(CurrencySettings.is_system == True).first()  # noqa: E712
    if row:
        return row
    row = CurrencySettings(
        tier1_name=DEFAULT_TIER1_NAME,
        tier2_name=DEFAULT_TIER2_NAME,
        tier3_name=DEFAULT_TIER3_NAME,
        copper_per_silver=DEFAULT_COPPER_PER_SILVER,
        silver_per_gold=DEFAULT_SILVER_PER_GOLD,
        is_system=True,
    )
    db.add(row)
    db.flush()
    return row


def calc_buy_price(base_price: int, buy_modifier_percent: int) -> int:
    if base_price <= 0:
        return 0
    return max(0, math.ceil(base_price * (1 + buy_modifier_percent / 100)))


def calc_sell_price(base_price: int) -> int:
    if base_price <= 0:
        return 0
    return max(0, math.floor(base_price * SELL_RATE))
