from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, hash_password, require_master
from app.database import get_db
from app.models import Character, User, UserRole
from app.schemas import UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def me(user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]) -> UserOut:
    has_character = db.query(Character).filter(Character.user_id == user.id).first() is not None
    return UserOut(id=user.id, username=user.username, role=user.role.value, has_character=has_character)


@router.get("", response_model=list[UserOut])
def list_users(
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[UserOut]:
    users = db.query(User).filter(User.role == UserRole.player).all()
    result = []
    for u in users:
        has_character = db.query(Character).filter(Character.user_id == u.id).first() is not None
        result.append(UserOut(id=u.id, username=u.username, role=u.role.value, has_character=has_character))
    return result


@router.post("", response_model=UserOut)
def create_user(
    payload: UserCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=UserRole.player,
        created_by_id=master.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut(id=user.id, username=user.username, role=user.role.value, has_character=False)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    user = db.get(User, user_id)
    if not user or user.role != UserRole.player:
        raise HTTPException(status_code=404, detail="Player not found")
    if payload.password:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    has_character = db.query(Character).filter(Character.user_id == user.id).first() is not None
    return UserOut(id=user.id, username=user.username, role=user.role.value, has_character=has_character)


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    _: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    user = db.get(User, user_id)
    if not user or user.role != UserRole.player:
        raise HTTPException(status_code=404, detail="Player not found")
    db.delete(user)
    db.commit()
    return {"ok": True}
