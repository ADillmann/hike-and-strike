from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.game.constants import SECRET_EXAMINE_MODES, SECRET_SOLVER_TYPES, STAT_NAMES
from app.models import SecretTemplate, User
from app.schemas import SecretTemplateCreate, SecretTemplateOut
from app.services.secret_solvers import get_solver, validate_solver_type

router = APIRouter(prefix="/secrets", tags=["secrets"])


def _validate_secret_payload(payload: SecretTemplateCreate) -> None:
    validate_solver_type(payload.solver_type)
    if payload.examine_stat not in STAT_NAMES:
        raise HTTPException(status_code=400, detail=f"Invalid examine stat. Must be one of: {', '.join(STAT_NAMES)}")
    if payload.examine_mode not in SECRET_EXAMINE_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid examine mode. Must be one of: {', '.join(SECRET_EXAMINE_MODES)}")
    try:
        get_solver(payload.solver_type).validate_config(payload.solver_config or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=list[SecretTemplateOut])
def list_secrets(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[SecretTemplateOut]:
    return db.query(SecretTemplate).order_by(SecretTemplate.name).all()


@router.post("", response_model=SecretTemplateOut)
def create_secret(
    payload: SecretTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> SecretTemplateOut:
    _validate_secret_payload(payload)
    item = SecretTemplate(**payload.model_dump(), master_id=master.id, is_system=False)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{secret_id}", response_model=SecretTemplateOut)
def update_secret(
    secret_id: int,
    payload: SecretTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> SecretTemplateOut:
    item = db.get(SecretTemplate, secret_id)
    if not item:
        raise HTTPException(status_code=404, detail="Secret not found")
    if not item.is_system and item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Secret not found")
    _validate_secret_payload(payload)
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{secret_id}")
def delete_secret(
    secret_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    item = db.get(SecretTemplate, secret_id)
    if not item or item.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system secret")
    if item.master_id != master.id:
        raise HTTPException(status_code=404, detail="Secret not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
