from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.auth import get_user_by_username
from app.config import settings
from app.database import SessionLocal
from app.models import Campaign, Character, GroupMember, User, UserRole
from app.services.campaign_engine import campaign_state_payload
from app.websocket.manager import ws_manager

router = APIRouter(tags=["websocket"])


def _user_from_token(token: str | None, db: Session) -> tuple[User | None, int | None]:
    if not token:
        return None, None
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username = payload.get("sub")
        if not username:
            return None, None
        user = get_user_by_username(db, username)
        if not user:
            return None, None
        character_id = None
        if user.role == UserRole.player:
            character = db.query(Character).filter(Character.user_id == user.id).first()
            character_id = character.id if character else None
        return user, character_id
    except JWTError:
        return None, None


def _can_join_campaign(db: Session, user: User, campaign_id: int) -> bool:
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        return False
    if user.role == UserRole.master:
        return campaign.master_id == user.id
    character = db.query(Character).filter(Character.user_id == user.id).first()
    if not character:
        return False
    member = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == campaign.group_id, GroupMember.character_id == character.id)
        .first()
    )
    return member is not None


@router.websocket("/ws/campaigns/{campaign_id}")
async def campaign_ws(websocket: WebSocket, campaign_id: int, token: str | None = None) -> None:
    db = SessionLocal()
    try:
        user, character_id = _user_from_token(token, db)
        if not user or not _can_join_campaign(db, user, campaign_id):
            await websocket.close(code=4401)
            return
        await ws_manager.connect(campaign_id, websocket, user.id, character_id)
        campaign = db.get(Campaign, campaign_id)
        if campaign:
            await websocket.send_json({"type": "campaign_state", "data": campaign_state_payload(db, campaign)})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(campaign_id, websocket)
    finally:
        db.close()
