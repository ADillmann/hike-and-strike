from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_master
from app.database import get_db
from app.models import User
from app.schemas import CurrencySettingsOut, CurrencySettingsUpdate
from app.services.currency import format_wallet, get_system_currency_settings

router = APIRouter(prefix="/currency", tags=["currency"])


def _to_out(settings) -> CurrencySettingsOut:
    return CurrencySettingsOut(
        tier1_name=settings.tier1_name,
        tier2_name=settings.tier2_name,
        tier3_name=settings.tier3_name,
        copper_per_silver=settings.copper_per_silver,
        silver_per_gold=settings.silver_per_gold,
        is_system=settings.is_system,
    )


@router.get("/settings", response_model=CurrencySettingsOut)
def get_currency_settings(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CurrencySettingsOut:
    return _to_out(get_system_currency_settings(db))


@router.patch("/settings", response_model=CurrencySettingsOut)
def update_currency_settings(
    payload: CurrencySettingsUpdate,
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> CurrencySettingsOut:
    settings = get_system_currency_settings(db)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(settings, k, v)
    db.commit()
    db.refresh(settings)
    return _to_out(settings)


@router.get("/display", response_model=CurrencySettingsOut)
def get_currency_display_settings(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CurrencySettingsOut:
    return _to_out(get_system_currency_settings(db))


@router.get("/preview")
def preview_wallet(
    copper: int,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    settings = get_system_currency_settings(db)
    return {"copper": copper, "display": format_wallet(copper, settings)}
