from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import require_master
from app.database import get_db
from app.models import Campaign, User
from app.services import campaign_pack as camps
from app.services import settings_pack as packs

router = APIRouter(prefix="/organizer/campaign-pack", tags=["campaign-pack"])


class ExportRequest(BaseModel):
    campaign_id: int
    directory: str
    mode: Literal["full", "blank"] = "full"


class SettingsSource(BaseModel):
    directory: str | None = None
    repo: str | None = None
    branch: str | None = None
    token: str | None = None
    path_prefix: str = ""


class ImportRequest(BaseModel):
    directory: str
    reload_mode: Literal["full", "blank"] = "full"
    resume_as_active: bool = True
    confirm: str
    settings: SettingsSource = Field(default_factory=SettingsSource)


def _load_settings_source(source: SettingsSource) -> dict[str, Any]:
    if source.directory and source.directory.strip():
        directory = packs.resolve_pack_directory(source.directory)
        return packs.read_pack_from_directory(directory)
    if source.repo and source.branch:
        return packs.fetch_pack_from_remote(
            repo=source.repo,
            branch=source.branch,
            token=source.token,
            path_prefix=source.path_prefix or "",
        )
    raise ValueError("Provide settings.directory or settings.repo + settings.branch")


@router.post("/export")
def export_campaign_pack(
    payload: ExportRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    campaign = db.get(Campaign, payload.campaign_id)
    if not campaign or campaign.master_id != master.id:
        raise HTTPException(status_code=404, detail="Campaign not found")
    try:
        directory = camps.resolve_campaign_directory(payload.directory)
        media_dir = directory / "media"
        if media_dir.exists():
            import shutil

            shutil.rmtree(media_dir)
        media_dir.mkdir(parents=True, exist_ok=True)
        pack = camps.build_campaign_pack(
            db,
            campaign_id=payload.campaign_id,
            mode=payload.mode,
            media_dir=media_dir,
        )
        written = camps.write_campaign_pack(directory, pack)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not write campaign pack: {exc}") from exc
    return {
        "ok": True,
        "directory": str(directory),
        "files": written,
        "campaign": pack["campaign.json"],
    }


@router.post("/import")
def import_campaign_pack(
    payload: ImportRequest,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if payload.confirm != camps.CONFIRM_REPLACE:
        raise HTTPException(status_code=400, detail=f'confirm must be "{camps.CONFIRM_REPLACE}"')
    try:
        directory = camps.resolve_campaign_directory(payload.directory)
        pack = camps.read_campaign_pack(directory)
        settings_files = _load_settings_source(payload.settings)
        result = camps.import_campaign_pack(
            db,
            pack,
            master_id=master.id,
            reload_mode=payload.reload_mode,
            settings_files=settings_files,
            resume_as_active=payload.resume_as_active,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not import campaign pack: {exc}") from exc
    except Exception:
        db.rollback()
        raise
    return {"ok": True, "imported": result}
