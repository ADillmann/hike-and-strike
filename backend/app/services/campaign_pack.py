"""Campaign pack export / destructive import (full vs blank)."""

from __future__ import annotations

import copy
import json
import shutil
from pathlib import Path
from typing import Any, Literal

from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.models import (
    Campaign,
    CampaignEventNode,
    Character,
    ClassTemplate,
    EffectTemplate,
    EventHistory,
    EventTemplate,
    Group,
    GroupMember,
    InventoryItem,
    ItemTemplate,
    Skill,
    SkillTemplate,
    TemporaryEffect,
    User,
    UserRole,
)
from app.services import settings_pack as sp

CAMPAIGN_FORMAT_VERSION = 1
CONFIRM_REPLACE = "REPLACE"
ExportMode = Literal["full", "blank"]
ReloadMode = Literal["full", "blank"]

ROOT_JSON_FILES = (
    "campaign.json",
    "events.json",
    "users.json",
    "groups.json",
    "campaign_nodes.json",
    "event_history.json",
    "characters_blank.json",
)


def resolve_campaign_directory(path: str) -> Path:
    return sp.resolve_pack_directory(path)


def wipe_event_templates(db: Session) -> None:
    db.query(CampaignEventNode).delete(synchronize_session=False)
    db.query(EventTemplate).delete(synchronize_session=False)
    db.flush()


def _uploads_path_from_url(url: str | None) -> Path | None:
    if not url or not isinstance(url, str):
        return None
    if url.startswith("/uploads/"):
        return settings.uploads_dir / url.removeprefix("/uploads/")
    return None


def _copy_media_into_pack(src_url: str | None, media_dir: Path, rel_prefix: str) -> str | None:
    src = _uploads_path_from_url(src_url)
    if not src or not src.is_file():
        return src_url
    dest_name = f"{rel_prefix}_{src.name}"
    dest = media_dir / dest_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return f"media/{dest_name}"


def _restore_media_from_pack(pack_rel: str | None, pack_dir: Path) -> str | None:
    if not pack_rel:
        return None
    if not str(pack_rel).startswith("media/"):
        return pack_rel
    src = pack_dir / pack_rel
    if not src.is_file():
        return None
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.uploads_dir / src.name
    shutil.copy2(src, dest)
    return f"/uploads/{src.name}"


def _export_battle_config(db: Session, cfg: dict[str, Any] | None) -> dict[str, Any] | None:
    if not cfg:
        return None
    out = copy.deepcopy(cfg)
    if isinstance(out.get("victory_rewards"), dict):
        out["victory_rewards"] = sp._export_rewards(db, out["victory_rewards"])
    return out


def _remap_battle_config(
    cfg: dict[str, Any] | None,
    *,
    items: dict[str, int],
    effects: dict[str, int],
) -> dict[str, Any] | None:
    if not cfg:
        return None
    out = copy.deepcopy(cfg)
    if isinstance(out.get("victory_rewards"), dict):
        out["victory_rewards"] = sp._remap_reward_block(out["victory_rewards"], items=items, effects=effects)
    return out


def _blank_character_payload(db: Session, character: Character, user: User) -> dict[str, Any]:
    class_row = character.class_template
    class_name = class_row.name if class_row else None
    race = character.race or class_name or "Unknown"
    base_stats = (
        copy.deepcopy(class_row.base_stats)
        if class_row and class_row.base_stats
        else copy.deepcopy(character.stats or {})
    )
    durability = int(base_stats.get("durability", 8) or 8)
    max_hp = 10 + durability * 5
    starters = []
    for sk in character.skills:
        tmpl = sk.skill_template
        if tmpl is None and sk.skill_template_id:
            tmpl = db.get(SkillTemplate, sk.skill_template_id)
        if tmpl and tmpl.selectable_at_creation:
            starters.append({
                "skill_template_name": tmpl.name,
                "slot_kind": sk.slot_kind,
            })
    return {
        "username": user.username,
        "password_hash": user.password_hash,
        "character_name": character.name,
        "class_template_name": class_name,
        "race": race,
        "stats": base_stats,
        "max_hp": max_hp,
        "current_hp": max_hp,
        "level": 1,
        "xp": 0,
        "stat_points_free": 0,
        "level_stat_allocations": {},
        "wallet_copper": 0,
        "starter_skills": starters,
        "portrait_path": None,
        "inventory": [],
        "skills": [],
        "temporary_effects": [],
    }


def _full_character_payload(db: Session, character: Character, user: User, media_dir: Path) -> dict[str, Any]:
    class_name = character.class_template.name if character.class_template else None
    portrait = _copy_media_into_pack(character.portrait_path, media_dir, f"portrait_{user.username}")
    inventory = []
    for inv in character.inventory_items:
        item = inv.item_template or db.get(ItemTemplate, inv.item_template_id)
        if not item:
            raise ValueError(f"Inventory item missing template for character {character.name}")
        inventory.append({
            "item_template_name": item.name,
            "equipped_slot": inv.equipped_slot,
            "quantity": inv.quantity,
            "secret_state": inv.secret_state or {},
        })
    skills = []
    for sk in character.skills:
        tmpl = sk.skill_template
        if tmpl is None and sk.skill_template_id:
            tmpl = db.get(SkillTemplate, sk.skill_template_id)
        skills.append({
            "skill_template_name": tmpl.name if tmpl else None,
            "name": sk.name,
            "max_uses_per_rest": sk.max_uses_per_rest,
            "uses_remaining": sk.uses_remaining,
            "slot_kind": sk.slot_kind,
        })
    effects = []
    for eff in character.temporary_effects:
        ename = None
        if eff.effect_template_id:
            et = db.get(EffectTemplate, eff.effect_template_id)
            ename = et.name if et else None
        effects.append({
            "effect_template_name": ename,
            "label": eff.label,
            "stat_modifiers": eff.stat_modifiers or {},
            "battle_modifiers": eff.battle_modifiers or {},
            "active_in_battle": eff.active_in_battle,
            "cleared_on_rest": eff.cleared_on_rest,
            "cleared_on_event": eff.cleared_on_event,
        })
    return {
        "username": user.username,
        "password_hash": user.password_hash,
        "character_name": character.name,
        "class_template_name": class_name,
        "race": character.race,
        "stats": character.stats or {},
        "max_hp": character.max_hp,
        "current_hp": character.current_hp,
        "level": character.level,
        "xp": character.xp,
        "stat_points_free": character.stat_points_free,
        "level_stat_allocations": character.level_stat_allocations or {},
        "wallet_copper": character.wallet_copper,
        "portrait_path": portrait,
        "inventory": inventory,
        "skills": skills,
        "temporary_effects": effects,
        "starter_skills": _blank_character_payload(db, character, user)["starter_skills"],
    }


def build_campaign_pack(
    db: Session,
    *,
    campaign_id: int,
    mode: ExportMode,
    media_dir: Path | None = None,
) -> dict[str, Any]:
    campaign = (
        db.query(Campaign)
        .options(
            joinedload(Campaign.nodes),
            joinedload(Campaign.history),
            joinedload(Campaign.group).joinedload(Group.members).joinedload(GroupMember.character),
        )
        .filter(Campaign.id == campaign_id)
        .first()
    )
    if not campaign:
        raise ValueError(f"Campaign {campaign_id} not found")

    group = campaign.group
    if not group:
        raise ValueError("Campaign has no group")

    media_dir = media_dir or Path(".")
    media_dir.mkdir(parents=True, exist_ok=True)

    applied = sp.get_applied_pack(db)
    settings_base = None
    if applied:
        settings_base = {
            "name": applied.get("name"),
            "version": applied.get("version"),
            "layout_theme": applied.get("layout_theme"),
            "source": applied.get("source"),
        }

    node_event_ids = {n.event_template_id for n in campaign.nodes}
    events = db.query(EventTemplate).filter(EventTemplate.id.in_(node_event_ids)).all() if node_event_ids else []
    events_out = []
    for ev in sorted(events, key=lambda e: e.name):
        images = []
        for img in ev.images or []:
            images.append(_copy_media_into_pack(img, media_dir, f"event_{ev.id}") or img)
        events_out.append({
            "name": ev.name,
            "description": ev.description,
            "event_type": ev.event_type,
            "images": images,
            "is_generic": ev.is_generic,
            "branch_hints": ev.branch_hints,
            "shop_config": copy.deepcopy(ev.shop_config) if ev.shop_config else None,
            "battle_config": _export_battle_config(db, ev.battle_config if isinstance(ev.battle_config, dict) else None),
        })

    members = []
    users_out = []
    blank_chars = []
    full_chars = []
    seen_users: set[str] = set()
    for membership in group.members:
        character = membership.character
        if not character:
            continue
        user = character.user
        if not user:
            continue
        members.append(user.username)
        if user.username not in seen_users:
            seen_users.add(user.username)
            users_out.append({
                "username": user.username,
                "password_hash": user.password_hash,
                "role": "player",
            })
            blank_chars.append(_blank_character_payload(db, character, user))
            if mode == "full":
                full_chars.append(_full_character_payload(db, character, user, media_dir))

    nodes_sorted = sorted(campaign.nodes, key=lambda n: n.sort_order)
    nodes_out = []
    current_sort = None
    for node in nodes_sorted:
        tmpl = db.get(EventTemplate, node.event_template_id)
        if campaign.current_node_id == node.id:
            current_sort = node.sort_order
        nodes_out.append({
            "sort_order": node.sort_order,
            "label": node.label,
            "event_template_name": tmpl.name if tmpl else None,
        })

    history_out = []
    for h in sorted(campaign.history, key=lambda x: x.id):
        node_sort = None
        if h.node_id:
            node = db.get(CampaignEventNode, h.node_id)
            if node:
                node_sort = node.sort_order
        history_out.append({
            "node_sort_order": node_sort,
            "outcome": h.outcome,
            "master_notes": h.master_notes,
            "rewards": sp._export_rewards(db, h.rewards_json if isinstance(h.rewards_json, dict) else None),
            "punishments": sp._export_rewards(db, h.punishments_json if isinstance(h.punishments_json, dict) else None),
        })

    delta = sp.build_settings_delta_files(db) if mode == "full" else sp.empty_settings_delta_files()

    return {
        "campaign.json": {
            "format_version": CAMPAIGN_FORMAT_VERSION,
            "name": campaign.name,
            "export_mode": mode,
            "status": campaign.status,
            "layout_theme": campaign.layout_theme or "default",
            "current_node_sort_order": current_sort,
            "settings_base": settings_base,
            "group_name": group.name,
        },
        "events.json": {"events": events_out},
        "users.json": {"users": users_out},
        "groups.json": {"groups": [{"name": group.name, "member_usernames": members}]},
        "campaign_nodes.json": {"nodes": nodes_out},
        "event_history.json": {"history": history_out},
        "characters_blank.json": {"characters": blank_chars},
        "characters_full.json": {"characters": full_chars} if mode == "full" else {"characters": []},
        "settings_delta": delta,
    }


def write_campaign_pack(directory: Path, pack: dict[str, Any]) -> list[str]:
    directory.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for name in ROOT_JSON_FILES:
        if name not in pack:
            continue
        (directory / name).write_text(json.dumps(pack[name], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(name)
    if "characters_full.json" in pack:
        (directory / "characters_full.json").write_text(
            json.dumps(pack["characters_full.json"], indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        written.append("characters_full.json")
    delta = pack.get("settings_delta") or sp.empty_settings_delta_files()
    delta_dir = directory / "settings_delta"
    delta_dir.mkdir(parents=True, exist_ok=True)
    for filename, payload in delta.items():
        (delta_dir / filename).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(f"settings_delta/{filename}")
    if "campaign.json" not in written:
        raise ValueError("campaign.json missing from export payload")
    return written


def read_campaign_pack(directory: Path) -> dict[str, Any]:
    if not directory.is_dir():
        raise ValueError(f"Directory not found: {directory}")
    pack: dict[str, Any] = {}
    for name in ROOT_JSON_FILES:
        path = directory / name
        if not path.is_file():
            if name == "campaign.json":
                raise ValueError("Invalid campaign pack: missing campaign.json")
            continue
        pack[name] = json.loads(path.read_text(encoding="utf-8"))
    full_path = directory / "characters_full.json"
    if full_path.is_file():
        pack["characters_full.json"] = json.loads(full_path.read_text(encoding="utf-8"))
    else:
        pack["characters_full.json"] = {"characters": []}
    delta_dir = directory / "settings_delta"
    delta: dict[str, Any] = {}
    if delta_dir.is_dir():
        for filename in sp.PACK_FILES:
            path = delta_dir / filename
            if path.is_file():
                delta[filename] = json.loads(path.read_text(encoding="utf-8"))
    if "pack.json" not in delta:
        delta = sp.empty_settings_delta_files()
    pack["settings_delta"] = delta
    pack["_directory"] = str(directory)
    return pack


def _name_maps(db: Session) -> dict[str, dict[str, int]]:
    return {
        "items": {i.name: i.id for i in db.query(ItemTemplate).all()},
        "effects": {e.name: e.id for e in db.query(EffectTemplate).all()},
        "skills": {s.name: s.id for s in db.query(SkillTemplate).all()},
        "classes": {c.name: c.id for c in db.query(ClassTemplate).all()},
    }


def _resolve_class_and_race(row: dict[str, Any], class_map: dict[str, int]) -> tuple[int | None, str]:
    """Map class_template_name when it exists; never treat a bare race label as a missing class error."""
    explicit_class = row.get("class_template_name")
    race = row.get("race")
    if explicit_class and explicit_class in class_map:
        return class_map[explicit_class], race or explicit_class
    if race and race in class_map and not explicit_class:
        # Newer characters often store class name in race as well.
        return class_map[race], race
    # Legacy: race-only characters, or older packs that wrongly put race in class_template_name.
    return None, race or explicit_class or "Unknown"


def _create_character_from_row(
    db: Session,
    row: dict[str, Any],
    *,
    user: User,
    maps: dict[str, dict[str, int]],
    pack_dir: Path,
    blank: bool,
) -> Character:
    class_id, race = _resolve_class_and_race(row, maps["classes"])
    portrait = _restore_media_from_pack(row.get("portrait_path"), pack_dir) if not blank else None
    character = Character(
        user_id=user.id,
        name=row.get("character_name") or row.get("name") or user.username,
        race=race,
        class_template_id=class_id,
        portrait_path=portrait,
        stats=row.get("stats") or {},
        max_hp=int(row.get("max_hp") or 10),
        current_hp=int(row.get("current_hp") or row.get("max_hp") or 10),
        level=int(row.get("level") or 1),
        xp=int(row.get("xp") or 0),
        stat_points_free=int(row.get("stat_points_free") or 0),
        level_stat_allocations=row.get("level_stat_allocations") or {},
        wallet_copper=int(row.get("wallet_copper") or 0),
    )
    db.add(character)
    db.flush()

    if blank:
        for starter in row.get("starter_skills") or []:
            sname = starter.get("skill_template_name")
            sid = sp._id_by_name(maps["skills"], sname)
            tmpl = db.get(SkillTemplate, sid) if sid else None
            if not tmpl:
                continue
            db.add(Skill(
                character_id=character.id,
                skill_template_id=tmpl.id,
                name=tmpl.name,
                max_uses_per_rest=tmpl.max_uses_per_rest,
                uses_remaining=tmpl.max_uses_per_rest,
                slot_kind=starter.get("slot_kind"),
            ))
        return character

    for inv in row.get("inventory") or []:
        item_id = sp._id_by_name(maps["items"], inv.get("item_template_name"))
        db.add(InventoryItem(
            character_id=character.id,
            item_template_id=item_id,
            equipped_slot=inv.get("equipped_slot"),
            quantity=int(inv.get("quantity") or 1),
            secret_state=inv.get("secret_state") or {},
        ))
    for sk in row.get("skills") or []:
        sid = None
        if sk.get("skill_template_name"):
            sid = sp._id_by_name(maps["skills"], sk.get("skill_template_name"))
        db.add(Skill(
            character_id=character.id,
            skill_template_id=sid,
            name=sk.get("name") or sk.get("skill_template_name") or "Skill",
            max_uses_per_rest=int(sk.get("max_uses_per_rest") or 1),
            uses_remaining=int(sk.get("uses_remaining") or 0),
            slot_kind=sk.get("slot_kind"),
        ))
    for eff in row.get("temporary_effects") or []:
        eid = None
        if eff.get("effect_template_name"):
            eid = sp._id_by_name(maps["effects"], eff.get("effect_template_name"))
        db.add(TemporaryEffect(
            character_id=character.id,
            effect_template_id=eid,
            label=eff.get("label") or "Effect",
            stat_modifiers=eff.get("stat_modifiers") or {},
            battle_modifiers=eff.get("battle_modifiers") or {},
            active_in_battle=bool(eff.get("active_in_battle", False)),
            cleared_on_rest=bool(eff.get("cleared_on_rest", True)),
            cleared_on_event=bool(eff.get("cleared_on_event", False)),
        ))
    return character


def import_campaign_pack(
    db: Session,
    pack: dict[str, Any],
    *,
    master_id: int,
    reload_mode: ReloadMode,
    settings_files: dict[str, Any],
    resume_as_active: bool = True,
) -> dict[str, Any]:
    meta = pack.get("campaign.json") or {}
    if not isinstance(meta, dict):
        raise ValueError("campaign.json must be an object")
    fmt = int(meta.get("format_version") or 0)
    if fmt != CAMPAIGN_FORMAT_VERSION:
        raise ValueError(f"Unsupported campaign format_version {fmt}; expected {CAMPAIGN_FORMAT_VERSION}")

    pack_dir = Path(pack.get("_directory") or ".")

    # Settings base replaces templates + clears live world; then wipe orphaned events.
    sp.import_pack_dict(db, settings_files, master_id=master_id, wipe=True, commit=False)
    wipe_event_templates(db)

    if reload_mode == "full":
        delta = pack.get("settings_delta") or sp.empty_settings_delta_files()
        sp.merge_pack_delta(db, delta, master_id=master_id)

    maps = _name_maps(db)

    # Events
    event_ids: dict[str, int] = {}
    for row in (pack.get("events.json") or {}).get("events") or []:
        images = []
        for img in row.get("images") or []:
            restored = _restore_media_from_pack(img, pack_dir)
            if restored:
                images.append(restored)
        battle_cfg = _remap_battle_config(
            row.get("battle_config") if isinstance(row.get("battle_config"), dict) else None,
            items=maps["items"],
            effects=maps["effects"],
        )
        ev = EventTemplate(
            master_id=master_id,
            name=row["name"],
            description=row.get("description") or "",
            event_type=row.get("event_type") or "story",
            images=images,
            is_generic=bool(row.get("is_generic", False)),
            branch_hints=row.get("branch_hints"),
            shop_config=row.get("shop_config"),
            battle_config=battle_cfg,
        )
        db.add(ev)
        db.flush()
        event_ids[ev.name] = ev.id

    # Players
    user_by_name: dict[str, User] = {}
    for row in (pack.get("users.json") or {}).get("users") or []:
        username = row["username"]
        existing = db.query(User).filter(User.username == username).first()
        if existing:
            if existing.role == UserRole.master:
                raise ValueError(f"Cannot import player username that belongs to a master: {username}")
            existing.password_hash = row.get("password_hash") or existing.password_hash
            existing.created_by_id = master_id
            user = existing
        else:
            user = User(
                username=username,
                password_hash=row.get("password_hash") or "",
                role=UserRole.player,
                created_by_id=master_id,
            )
            db.add(user)
            db.flush()
        user_by_name[username] = user

    # Characters
    char_source = (
        (pack.get("characters_full.json") or {}).get("characters")
        if reload_mode == "full"
        else (pack.get("characters_blank.json") or {}).get("characters")
    ) or []
    if reload_mode == "full" and not char_source:
        raise ValueError("Full reload requires characters_full.json with characters")

    char_by_username: dict[str, Character] = {}
    for row in char_source:
        username = row["username"]
        user = user_by_name.get(username)
        if not user:
            raise ValueError(f"Character references unknown user {username!r}")
        char_by_username[username] = _create_character_from_row(
            db,
            row,
            user=user,
            maps=maps,
            pack_dir=pack_dir,
            blank=(reload_mode == "blank"),
        )

    # Group
    groups = (pack.get("groups.json") or {}).get("groups") or []
    if not groups:
        raise ValueError("Campaign pack missing groups")
    g_row = groups[0]
    group = Group(name=g_row.get("name") or meta.get("group_name") or "Party", master_id=master_id)
    db.add(group)
    db.flush()
    for username in g_row.get("member_usernames") or []:
        character = char_by_username.get(username)
        if not character:
            raise ValueError(f"Group member {username!r} has no character in pack")
        db.add(GroupMember(group_id=group.id, character_id=character.id))

    # Campaign + nodes
    if reload_mode == "blank":
        initial_status = "active"
    elif resume_as_active:
        initial_status = "active"
    else:
        initial_status = meta.get("status") or "draft"

    campaign = Campaign(
        name=meta.get("name") or "Imported Campaign",
        group_id=group.id,
        master_id=master_id,
        status=initial_status,
        layout_theme=meta.get("layout_theme") or "default",
        current_node_id=None,
    )
    db.add(campaign)
    db.flush()

    node_by_sort: dict[int, CampaignEventNode] = {}
    for node_row in (pack.get("campaign_nodes.json") or {}).get("nodes") or []:
        ename = node_row.get("event_template_name")
        if not ename or ename not in event_ids:
            raise ValueError(f"Unknown event template for node: {ename!r}")
        node = CampaignEventNode(
            campaign_id=campaign.id,
            event_template_id=event_ids[ename],
            sort_order=int(node_row.get("sort_order") or 0),
            label=node_row.get("label"),
        )
        db.add(node)
        db.flush()
        node_by_sort[node.sort_order] = node

    if reload_mode == "blank":
        # True campaign restart: first node, no history.
        if node_by_sort:
            first_sort = min(node_by_sort)
            campaign.current_node_id = node_by_sort[first_sort].id
    else:
        current_sort = meta.get("current_node_sort_order")
        if current_sort is not None and int(current_sort) in node_by_sort:
            campaign.current_node_id = node_by_sort[int(current_sort)].id
        elif node_by_sort:
            campaign.current_node_id = node_by_sort[min(node_by_sort)].id

        for h in (pack.get("event_history.json") or {}).get("history") or []:
            node_id = None
            sort_order = h.get("node_sort_order")
            if sort_order is not None and int(sort_order) in node_by_sort:
                node_id = node_by_sort[int(sort_order)].id
            db.add(EventHistory(
                campaign_id=campaign.id,
                node_id=node_id,
                outcome=h.get("outcome") or "unknown",
                master_notes=h.get("master_notes"),
                rewards_json=sp._remap_reward_block(
                    h.get("rewards") if isinstance(h.get("rewards"), dict) else {},
                    items=maps["items"],
                    effects=maps["effects"],
                ),
                punishments_json=sp._remap_reward_block(
                    h.get("punishments") if isinstance(h.get("punishments"), dict) else {},
                    items=maps["items"],
                    effects=maps["effects"],
                ),
            ))

    db.commit()
    return {
        "campaign_id": campaign.id,
        "name": campaign.name,
        "status": campaign.status,
        "reload_mode": reload_mode,
        "export_mode": meta.get("export_mode"),
        "resume_as_active": resume_as_active if reload_mode == "full" else False,
        "settings_applied": sp.get_applied_pack(db),
    }
