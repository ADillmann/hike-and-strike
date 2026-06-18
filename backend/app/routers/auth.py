from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import authenticate_user, create_access_token, hash_password
from app.database import get_db
from app.models import Character, User, UserRole
from app.schemas import LoginRequest, SetupMasterRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/setup-needed")
def setup_needed(db: Annotated[Session, Depends(get_db)]) -> dict:
    has_master = db.query(User).filter(User.role == UserRole.master).first() is not None
    return {"setup_needed": not has_master}


@router.post("/setup", response_model=TokenResponse)
def setup_master(payload: SetupMasterRequest, db: Annotated[Session, Depends(get_db)]) -> TokenResponse:
    if db.query(User).filter(User.role == UserRole.master).first():
        raise HTTPException(status_code=400, detail="Master already exists")
    user = User(username=payload.username, password_hash=hash_password(payload.password), role=UserRole.master)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.username, "role": user.role.value})
    return TokenResponse(access_token=token, role=user.role.value, username=user.username, has_character=False)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> TokenResponse:
    user = authenticate_user(db, payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    has_character = db.query(Character).filter(Character.user_id == user.id).first() is not None
    token = create_access_token({"sub": user.username, "role": user.role.value})
    return TokenResponse(
        access_token=token,
        role=user.role.value,
        username=user.username,
        has_character=has_character,
    )
