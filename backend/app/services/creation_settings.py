"""Character creation settings helpers."""

from sqlalchemy.orm import Session

from app.game.constants import POINT_BUY_POOL
from app.models import GameSetting

CREATION_BONUS_POINTS_KEY = "creation_bonus_points"


def get_creation_bonus_points(db: Session) -> int:
    row = db.get(GameSetting, CREATION_BONUS_POINTS_KEY)
    if not row or not row.value:
        return POINT_BUY_POOL
    try:
        return max(0, int(row.value))
    except ValueError:
        return POINT_BUY_POOL


def set_creation_bonus_points(db: Session, value: int) -> int:
    value = max(0, int(value))
    row = db.get(GameSetting, CREATION_BONUS_POINTS_KEY)
    if row:
        row.value = str(value)
    else:
        db.add(GameSetting(key=CREATION_BONUS_POINTS_KEY, value=str(value)))
    return value
