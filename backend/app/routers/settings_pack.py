from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.models import User
from app.services import settings_pack as packs

router = APIRouter(prefix="/organizer/settings-pack", tags=["settings-pack"])


class ExportRequest(BaseModel):
    directory: str = Field(..., description="Server filesystem directory to write pack files into")
    name: str = "local"
    version: str = "1.0.0"
    layout_theme: str | None = None


class PathImportRequest(BaseModel):
    directory: str
    confirm: str


class GitHubImportRequest(BaseModel):
    repo: str = Field(..., description="owner/name")
    branch: str
    token: str | None = None
    path_prefix: str = ""
    confirm: str


@router.get("/status")
def pack_status(
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    return {"applied": packs.get_applied_pack(db)}


@router.post("/export")
def export_pack(
    payload: ExportRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    try:
        directory = packs.resolve_pack_directory(payload.directory)
        files = packs.build_pack_dict(
            db,
            name=payload.name.strip() or "local",
            version=payload.version.strip() or "1.0.0",
            layout_theme=payload.layout_theme,
        )
        written = packs.write_pack_to_directory(directory, files)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not write pack: {exc}") from exc
    return {
        "ok": True,
        "directory": str(directory),
        "files": written,
        "pack": files["pack.json"],
    }


@router.post("/import-path")
def import_pack_path(
    payload: PathImportRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if payload.confirm != packs.CONFIRM_REPLACE:
        raise HTTPException(status_code=400, detail=f'confirm must be "{packs.CONFIRM_REPLACE}"')
    try:
        directory = packs.resolve_pack_directory(payload.directory)
        files = packs.read_pack_from_directory(directory)
        meta = packs.import_pack_dict(db, files, master_id=master.id)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not read pack: {exc}") from exc
    except Exception:
        db.rollback()
        raise
    return {"ok": True, "applied": meta, "directory": str(directory)}


@router.post("/import-github")
def import_pack_github(
    payload: GitHubImportRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if payload.confirm != packs.CONFIRM_REPLACE:
        raise HTTPException(status_code=400, detail=f'confirm must be "{packs.CONFIRM_REPLACE}"')
    try:
        files = packs.fetch_pack_from_github(
            repo=payload.repo,
            branch=payload.branch,
            token=payload.token,
            path_prefix=payload.path_prefix,
        )
        meta = packs.import_pack_dict(db, files, master_id=master.id)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    return {"ok": True, "applied": meta}
