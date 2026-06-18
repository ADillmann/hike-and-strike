import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import require_master
from app.config import settings
from app.database import get_db
from app.models import EventTemplate, User
from app.schemas import EventTemplateCreate, EventTemplateOut

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventTemplateOut])
def list_events(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[EventTemplateOut]:
    return db.query(EventTemplate).order_by(EventTemplate.name).all()


@router.post("", response_model=EventTemplateOut)
def create_event(
    payload: EventTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> EventTemplateOut:
    event = EventTemplate(**payload.model_dump(), master_id=master.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}", response_model=EventTemplateOut)
def update_event(
    event_id: int,
    payload: EventTemplateCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> EventTemplateOut:
    event = db.get(EventTemplate, event_id)
    if not event or (event.master_id and event.master_id != master.id and not event.is_generic):
        raise HTTPException(status_code=404, detail="Event not found")
    for k, v in payload.model_dump().items():
        setattr(event, k, v)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}")
def delete_event(
    event_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    event = db.get(EventTemplate, event_id)
    if not event or event.is_generic:
        raise HTTPException(status_code=400, detail="Cannot delete generic/system event")
    if event.master_id != master.id:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()
    return {"ok": True}


@router.post("/{event_id}/images")
async def upload_event_image(
    event_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
) -> EventTemplateOut:
    event = db.get(EventTemplate, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    ext = Path(file.filename or "img.png").suffix or ".png"
    filename = f"event_{event_id}_{uuid.uuid4().hex}{ext}"
    dest = settings.uploads_dir / filename
    dest.write_bytes(await file.read())
    images = list(event.images or [])
    images.append(f"/uploads/{filename}")
    event.images = images
    db.commit()
    db.refresh(event)
    return event
