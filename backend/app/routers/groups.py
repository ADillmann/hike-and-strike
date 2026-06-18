from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import require_master
from app.database import get_db
from app.models import Character, Group, GroupMember, User
from app.schemas import GroupCreate, GroupOut

router = APIRouter(prefix="/groups", tags=["groups"])


def _serialize_group(group: Group) -> GroupOut:
    members = []
    for m in group.members:
        c = m.character
        members.append(
            {
                "character_id": c.id,
                "name": c.name,
                "username": c.user.username if c.user else None,
            }
        )
    return GroupOut(id=group.id, name=group.name, members=members)


@router.get("", response_model=list[GroupOut])
def list_groups(
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> list[GroupOut]:
    groups = (
        db.query(Group)
        .options(joinedload(Group.members).joinedload(GroupMember.character).joinedload(Character.user))
        .filter(Group.master_id == master.id)
        .all()
    )
    return [_serialize_group(g) for g in groups]


@router.post("", response_model=GroupOut)
def create_group(
    payload: GroupCreate,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> GroupOut:
    group = Group(name=payload.name, master_id=master.id)
    db.add(group)
    db.flush()
    for cid in payload.character_ids:
        if db.get(Character, cid):
            db.add(GroupMember(group_id=group.id, character_id=cid))
    db.commit()
    db.refresh(group)
    group = (
        db.query(Group)
        .options(joinedload(Group.members).joinedload(GroupMember.character).joinedload(Character.user))
        .filter(Group.id == group.id)
        .first()
    )
    return _serialize_group(group)


@router.patch("/{group_id}/members", response_model=GroupOut)
def update_members(
    group_id: int,
    character_ids: list[int],
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> GroupOut:
    group = db.get(Group, group_id)
    if not group or group.master_id != master.id:
        raise HTTPException(status_code=404, detail="Group not found")
    db.query(GroupMember).filter(GroupMember.group_id == group_id).delete()
    for cid in character_ids:
        if db.get(Character, cid):
            db.add(GroupMember(group_id=group_id, character_id=cid))
    db.commit()
    group = (
        db.query(Group)
        .options(joinedload(Group.members).joinedload(GroupMember.character).joinedload(Character.user))
        .filter(Group.id == group_id)
        .first()
    )
    return _serialize_group(group)


@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    master: Annotated[User, Depends(require_master)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    group = db.get(Group, group_id)
    if not group or group.master_id != master.id:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(group)
    db.commit()
    return {"ok": True}
