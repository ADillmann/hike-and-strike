"""Settings pack export / destructive import / GitHub load."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from sqlalchemy.orm import Session

from app.models import (
    Battle,
    BattlePreset,
    Campaign,
    CampaignEventNode,
    Character,
    ClassTemplate,
    CurrencySettings,
    EffectTemplate,
    EnemyTemplate,
    EventHistory,
    GameSetting,
    Group,
    GroupMember,
    InventoryItem,
    ItemTemplate,
    SecretTemplate,
    Skill,
    SkillTemplate,
    StatChangeLog,
    TemporaryEffect,
    User,
    UserRole,
)
from app.services.creation_settings import get_creation_bonus_points, set_creation_bonus_points

PACK_FORMAT_VERSION = 1
APPLIED_PACK_KEY = "applied_settings_pack"
CONFIRM_REPLACE = "REPLACE"

PACK_FILES = (
    "pack.json",
    "currency.json",
    "classes.json",
    "skills.json",
    "effects.json",
    "secrets.json",
    "items.json",
    "enemies.json",
    "battle_presets.json",
    "creation_settings.json",
)


def get_applied_pack(db: Session) -> dict[str, Any] | None:
    row = db.get(GameSetting, APPLIED_PACK_KEY)
    if not row or not row.value:
        return None
    try:
        data = json.loads(row.value)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def set_applied_pack(db: Session, meta: dict[str, Any] | None) -> None:
    row = db.get(GameSetting, APPLIED_PACK_KEY)
    value = json.dumps(meta) if meta else ""
    if row:
        row.value = value
    else:
        db.add(GameSetting(key=APPLIED_PACK_KEY, value=value))


def custom_pack_active(db: Session) -> bool:
    meta = get_applied_pack(db)
    return bool(meta and meta.get("name"))


def collect_template_names(db: Session) -> dict[str, list[str]]:
    """Name inventory used to compute campaign settings deltas."""
    return {
        "classes": sorted(c.name for c in db.query(ClassTemplate).all()),
        "skills": sorted(s.name for s in db.query(SkillTemplate).all()),
        "effects": sorted(e.name for e in db.query(EffectTemplate).all()),
        "secrets": sorted(s.name for s in db.query(SecretTemplate).all()),
        "items": sorted(i.name for i in db.query(ItemTemplate).all()),
        "enemies": sorted(e.name for e in db.query(EnemyTemplate).all()),
        "battle_presets": sorted(p.id for p in db.query(BattlePreset).all()),
    }


def _name_by_id(db: Session, model: type, id_value: int | None) -> str | None:
    if id_value is None:
        return None
    row = db.get(model, id_value)
    return row.name if row else None


def _id_by_name(name_map: dict[str, int], name: str | None) -> int | None:
    if not name:
        return None
    if name not in name_map:
        raise ValueError(f"Unknown template name in pack: {name!r}")
    return name_map[name]


def _remap_reward_block(
    rewards: dict[str, Any] | None,
    *,
    items: dict[str, int],
    effects: dict[str, int],
) -> dict[str, Any]:
    if not rewards:
        return {}
    out = copy.deepcopy(rewards)
    for entry in out.get("items") or []:
        if isinstance(entry, dict) and "item_template_name" in entry:
            entry["item_template_id"] = _id_by_name(items, entry.pop("item_template_name"))
        elif isinstance(entry, dict) and "item_template_id" in entry:
            entry.pop("item_template_id", None)
    for entry in out.get("temp_effects") or []:
        if isinstance(entry, dict) and "effect_template_name" in entry:
            entry["effect_template_id"] = _id_by_name(effects, entry.pop("effect_template_name"))
        elif isinstance(entry, dict) and "effect_template_id" in entry:
            entry.pop("effect_template_id", None)
    return out


def _export_rewards(db: Session, rewards: dict[str, Any] | None) -> dict[str, Any]:
    if not rewards:
        return {}
    out = copy.deepcopy(rewards)
    for entry in out.get("items") or []:
        if isinstance(entry, dict) and entry.get("item_template_id") is not None:
            name = _name_by_id(db, ItemTemplate, int(entry["item_template_id"]))
            entry.pop("item_template_id", None)
            if name:
                entry["item_template_name"] = name
    for entry in out.get("temp_effects") or []:
        if isinstance(entry, dict) and entry.get("effect_template_id") is not None:
            name = _name_by_id(db, EffectTemplate, int(entry["effect_template_id"]))
            entry.pop("effect_template_id", None)
            if name:
                entry["effect_template_name"] = name
    return out


def build_pack_dict(
    db: Session,
    *,
    name: str = "local",
    version: str = "1.0.0",
    layout_theme: str | None = None,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return mapping of relative path -> JSON-serializable object."""
    pack_meta: dict[str, Any] = {
        "format_version": PACK_FORMAT_VERSION,
        "name": name,
        "version": version,
    }
    if layout_theme:
        pack_meta["layout_theme"] = layout_theme
    if source:
        pack_meta["source"] = source

    currency = db.query(CurrencySettings).filter(CurrencySettings.is_system == True).first()  # noqa: E712
    if not currency:
        currency = db.query(CurrencySettings).order_by(CurrencySettings.id).first()

    effects = []
    for e in db.query(EffectTemplate).order_by(EffectTemplate.name).all():
        effects.append({
            "name": e.name,
            "description": e.description,
            "label": e.label,
            "is_buff": e.is_buff,
            "stat_modifiers": e.stat_modifiers or {},
            "battle_modifiers": e.battle_modifiers or {},
            "active_in_battle": e.active_in_battle,
            "cleared_on_rest": e.cleared_on_rest,
            "cleared_on_event": e.cleared_on_event,
            "is_system": e.is_system,
        })

    skills = []
    for s in db.query(SkillTemplate).order_by(SkillTemplate.name).all():
        params = copy.deepcopy(s.effect_params or {})
        if params.get("effect_template_id") is not None:
            ename = _name_by_id(db, EffectTemplate, int(params["effect_template_id"]))
            params.pop("effect_template_id", None)
            if ename:
                params["effect_template_name"] = ename
        skills.append({
            "name": s.name,
            "description": s.description,
            "max_uses_per_rest": s.max_uses_per_rest,
            "effect_type": s.effect_type,
            "effect_params": params,
            "selectable_at_creation": s.selectable_at_creation,
            "is_system": s.is_system,
        })

    secrets = []
    for sec in db.query(SecretTemplate).order_by(SecretTemplate.name).all():
        secrets.append({
            "name": sec.name,
            "description": sec.description,
            "solver_type": sec.solver_type,
            "solver_config": sec.solver_config or {},
            "examine_stat": sec.examine_stat,
            "examine_mode": sec.examine_mode,
            "examine_dc": sec.examine_dc,
            "revealed_description": sec.revealed_description,
            "fail_message_examine": sec.fail_message_examine,
            "fail_message_solve": sec.fail_message_solve,
            "rewards": _export_rewards(db, sec.rewards if isinstance(sec.rewards, dict) else {}),
            "consume_on_solve": sec.consume_on_solve,
            "is_system": sec.is_system,
        })

    items = []
    for it in db.query(ItemTemplate).order_by(ItemTemplate.name).all():
        items.append({
            "name": it.name,
            "item_type": it.item_type,
            "tier": it.tier,
            "stats": it.stats or {},
            "description": it.description,
            "base_price": it.base_price,
            "is_system": it.is_system,
            "secret_template_name": _name_by_id(db, SecretTemplate, it.secret_template_id),
            "effect_template_name": _name_by_id(db, EffectTemplate, it.effect_template_id),
            "skill_template_name": _name_by_id(db, SkillTemplate, it.skill_template_id),
        })

    classes = []
    for c in db.query(ClassTemplate).order_by(ClassTemplate.name).all():
        classes.append({
            "name": c.name,
            "description": c.description,
            "base_stats": c.base_stats or {},
            "is_system": c.is_system,
        })

    enemies = []
    for en in db.query(EnemyTemplate).order_by(EnemyTemplate.name).all():
        stats = copy.deepcopy(en.stats or {})
        skill_ids = stats.pop("skill_template_ids", None) or []
        skill_names = []
        for sid in skill_ids:
            try:
                n = _name_by_id(db, SkillTemplate, int(sid))
            except (TypeError, ValueError):
                n = None
            if n:
                skill_names.append(n)
        if skill_names:
            stats["skill_template_names"] = skill_names
        enemies.append({
            "name": en.name,
            "description": en.description,
            "stats": stats,
            "is_system": en.is_system,
        })

    presets = []
    for p in db.query(BattlePreset).order_by(BattlePreset.id).all():
        presets.append({
            "id": p.id,
            "name": p.name,
            "enemies": p.enemies or [],
            "is_system": p.is_system,
        })

    return {
        "pack.json": pack_meta,
        "currency.json": {
            "tier1_name": currency.tier1_name if currency else "Copper",
            "tier2_name": currency.tier2_name if currency else "Silver",
            "tier3_name": currency.tier3_name if currency else "Gold",
            "copper_per_silver": currency.copper_per_silver if currency else 10,
            "silver_per_gold": currency.silver_per_gold if currency else 10,
        },
        "classes.json": {"classes": classes},
        "skills.json": {"skills": skills},
        "effects.json": {"effects": effects},
        "secrets.json": {"secrets": secrets},
        "items.json": {"items": items},
        "enemies.json": {"enemies": enemies},
        "battle_presets.json": {"battle_presets": presets},
        "creation_settings.json": {"creation_bonus_points": get_creation_bonus_points(db)},
    }


def resolve_pack_directory(path: str) -> Path:
    """Resolve a server filesystem path for local multi-file pack I/O."""
    raw = (path or "").strip()
    if not raw:
        raise ValueError("directory path is required")
    directory = Path(raw).expanduser().resolve()
    return directory


def write_pack_to_directory(directory: Path, files: dict[str, Any]) -> list[str]:
    """Write pack.json + content files (same layout as the GitHub settings repo)."""
    directory.mkdir(parents=True, exist_ok=True)
    if not directory.is_dir():
        raise ValueError(f"Not a directory: {directory}")
    written: list[str] = []
    for filename in PACK_FILES:
        if filename not in files:
            continue
        target = directory / filename
        target.write_text(json.dumps(files[filename], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(filename)
    if "pack.json" not in written:
        raise ValueError("pack.json missing from export payload")
    return written


def read_pack_from_directory(directory: Path) -> dict[str, Any]:
    """Load a multi-file pack directory (same layout as GitHub)."""
    if not directory.is_dir():
        raise ValueError(f"Directory not found: {directory}")
    files: dict[str, Any] = {}
    for filename in PACK_FILES:
        path = directory / filename
        if not path.is_file():
            if filename == "pack.json":
                raise ValueError(f"Invalid pack directory: missing {filename}")
            continue
        files[filename] = json.loads(path.read_text(encoding="utf-8"))
    return files


def wipe_live_world(db: Session) -> None:
    """Remove campaigns, groups, player characters, and player users. Keep masters."""
    db.query(Battle).delete(synchronize_session=False)
    db.query(EventHistory).delete(synchronize_session=False)
    db.query(StatChangeLog).delete(synchronize_session=False)
    db.query(Campaign).update({Campaign.current_node_id: None}, synchronize_session=False)
    db.query(CampaignEventNode).delete(synchronize_session=False)
    db.query(Campaign).delete(synchronize_session=False)
    db.query(GroupMember).delete(synchronize_session=False)
    db.query(Group).delete(synchronize_session=False)
    db.query(Skill).delete(synchronize_session=False)
    db.query(InventoryItem).delete(synchronize_session=False)
    db.query(TemporaryEffect).delete(synchronize_session=False)
    db.query(Character).delete(synchronize_session=False)
    db.query(User).filter(User.role == UserRole.player).delete(synchronize_session=False)
    db.flush()


def wipe_pack_templates(db: Session) -> None:
    """Delete all content templates so a pack can replace them."""
    db.query(ItemTemplate).update(
        {
            ItemTemplate.secret_template_id: None,
            ItemTemplate.effect_template_id: None,
            ItemTemplate.skill_template_id: None,
        },
        synchronize_session=False,
    )
    db.flush()
    db.query(ItemTemplate).delete(synchronize_session=False)
    db.query(SecretTemplate).delete(synchronize_session=False)
    db.query(EnemyTemplate).delete(synchronize_session=False)
    db.query(BattlePreset).delete(synchronize_session=False)
    db.query(SkillTemplate).delete(synchronize_session=False)
    db.query(EffectTemplate).delete(synchronize_session=False)
    db.query(ClassTemplate).delete(synchronize_session=False)
    db.query(CurrencySettings).delete(synchronize_session=False)
    db.flush()


def _filter_named_rows(rows: list[dict[str, Any]], known: set[str], *, key: str = "name") -> list[dict[str, Any]]:
    return [row for row in rows if isinstance(row, dict) and row.get(key) and str(row[key]) not in known]


def build_settings_delta_files(db: Session) -> dict[str, Any]:
    """Templates present in DB but not in the applied pack inventory (mid-run additions)."""
    full = build_pack_dict(db, name="delta", version="1.0.0")
    applied = get_applied_pack(db) or {}
    inventory = applied.get("template_names") if isinstance(applied.get("template_names"), dict) else None

    if inventory:
        known_effects = set(inventory.get("effects") or [])
        known_skills = set(inventory.get("skills") or [])
        known_secrets = set(inventory.get("secrets") or [])
        known_items = set(inventory.get("items") or [])
        known_classes = set(inventory.get("classes") or [])
        known_enemies = set(inventory.get("enemies") or [])
        known_presets = set(inventory.get("battle_presets") or [])
    else:
        # No pack inventory: treat master-owned / non-system rows as delta.
        known_effects = {e.name for e in db.query(EffectTemplate).filter(EffectTemplate.is_system == True).all()}  # noqa: E712
        known_skills = {s.name for s in db.query(SkillTemplate).filter(SkillTemplate.is_system == True).all()}  # noqa: E712
        known_secrets = {s.name for s in db.query(SecretTemplate).filter(SecretTemplate.is_system == True).all()}  # noqa: E712
        known_items = {i.name for i in db.query(ItemTemplate).filter(ItemTemplate.is_system == True).all()}  # noqa: E712
        known_classes = {c.name for c in db.query(ClassTemplate).filter(ClassTemplate.is_system == True).all()}  # noqa: E712
        known_enemies = {e.name for e in db.query(EnemyTemplate).filter(EnemyTemplate.is_system == True).all()}  # noqa: E712
        known_presets = {p.id for p in db.query(BattlePreset).filter(BattlePreset.is_system == True).all()}  # noqa: E712

    delta = {
        "pack.json": {
            "format_version": PACK_FORMAT_VERSION,
            "name": "settings-delta",
            "version": "1.0.0",
        },
        "effects.json": {"effects": _filter_named_rows((full.get("effects.json") or {}).get("effects") or [], known_effects)},
        "skills.json": {"skills": _filter_named_rows((full.get("skills.json") or {}).get("skills") or [], known_skills)},
        "secrets.json": {"secrets": _filter_named_rows((full.get("secrets.json") or {}).get("secrets") or [], known_secrets)},
        "items.json": {"items": _filter_named_rows((full.get("items.json") or {}).get("items") or [], known_items)},
        "classes.json": {"classes": _filter_named_rows((full.get("classes.json") or {}).get("classes") or [], known_classes)},
        "enemies.json": {"enemies": _filter_named_rows((full.get("enemies.json") or {}).get("enemies") or [], known_enemies)},
        "battle_presets.json": {
            "battle_presets": _filter_named_rows(
                (full.get("battle_presets.json") or {}).get("battle_presets") or [],
                known_presets,
                key="id",
            )
        },
    }
    return delta


def empty_settings_delta_files() -> dict[str, Any]:
    return {
        "pack.json": {
            "format_version": PACK_FORMAT_VERSION,
            "name": "settings-delta",
            "version": "1.0.0",
        },
        "effects.json": {"effects": []},
        "skills.json": {"skills": []},
        "secrets.json": {"secrets": []},
        "items.json": {"items": []},
        "classes.json": {"classes": []},
        "enemies.json": {"enemies": []},
        "battle_presets.json": {"battle_presets": []},
    }


def _load_pack_templates(db: Session, files: dict[str, Any], *, master_id: int | None, only_missing: bool = False) -> None:
    """Insert pack templates. If only_missing, skip names/ids already present (delta merge)."""
    effect_ids = {e.name: e.id for e in db.query(EffectTemplate).all()}
    skill_ids = {s.name: s.id for s in db.query(SkillTemplate).all()}
    secret_ids = {s.name: s.id for s in db.query(SecretTemplate).all()}
    item_ids = {i.name: i.id for i in db.query(ItemTemplate).all()}
    class_names = {c.name for c in db.query(ClassTemplate).all()}
    enemy_names = {e.name for e in db.query(EnemyTemplate).all()}
    preset_ids = {p.id for p in db.query(BattlePreset).all()}

    secret_rows: list[tuple[SecretTemplate, dict]] = []

    for row in (files.get("effects.json") or {}).get("effects") or []:
        name = row["name"]
        if only_missing and name in effect_ids:
            continue
        e = EffectTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=name,
            description=row.get("description") or "",
            label=row.get("label") or name,
            is_buff=bool(row.get("is_buff", True)),
            stat_modifiers=row.get("stat_modifiers") or {},
            battle_modifiers=row.get("battle_modifiers") or {},
            active_in_battle=bool(row.get("active_in_battle", False)),
            cleared_on_rest=bool(row.get("cleared_on_rest", True)),
            cleared_on_event=bool(row.get("cleared_on_event", False)),
            is_system=bool(row.get("is_system", False)),
        )
        db.add(e)
        db.flush()
        effect_ids[e.name] = e.id

    for row in (files.get("skills.json") or {}).get("skills") or []:
        name = row["name"]
        if only_missing and name in skill_ids:
            continue
        params = copy.deepcopy(row.get("effect_params") or {})
        if "effect_template_name" in params:
            params["effect_template_id"] = _id_by_name(effect_ids, params.pop("effect_template_name"))
        s = SkillTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=name,
            description=row.get("description") or "",
            max_uses_per_rest=int(row.get("max_uses_per_rest") or 1),
            effect_type=row.get("effect_type") or "none",
            effect_params=params,
            selectable_at_creation=bool(row.get("selectable_at_creation", True)),
            is_system=bool(row.get("is_system", False)),
        )
        db.add(s)
        db.flush()
        skill_ids[s.name] = s.id

    for row in (files.get("secrets.json") or {}).get("secrets") or []:
        name = row["name"]
        if only_missing and name in secret_ids:
            continue
        sec = SecretTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=name,
            description=row.get("description") or "",
            solver_type=row.get("solver_type") or "codeword",
            solver_config=row.get("solver_config") or {},
            examine_stat=row.get("examine_stat") or "intelligence",
            examine_mode=row.get("examine_mode") or "d20_plus_stat",
            examine_dc=int(row.get("examine_dc") or 10),
            revealed_description=row.get("revealed_description") or "",
            fail_message_examine=row.get("fail_message_examine") or "Nothing happens...",
            fail_message_solve=row.get("fail_message_solve") or "That doesn't work.",
            rewards={},
            consume_on_solve=bool(row.get("consume_on_solve", True)),
            is_system=bool(row.get("is_system", False)),
        )
        db.add(sec)
        db.flush()
        secret_ids[sec.name] = sec.id
        secret_rows.append((sec, row.get("rewards") if isinstance(row.get("rewards"), dict) else {}))

    for row in (files.get("items.json") or {}).get("items") or []:
        name = row["name"]
        if only_missing and name in item_ids:
            continue
        it = ItemTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=name,
            item_type=row.get("item_type") or "misc",
            tier=int(row.get("tier") or 1),
            stats=row.get("stats") or {},
            description=row.get("description") or "",
            base_price=int(row.get("base_price") or 0),
            is_system=bool(row.get("is_system", False)),
            secret_template_id=_id_by_name(secret_ids, row.get("secret_template_name")),
            effect_template_id=_id_by_name(effect_ids, row.get("effect_template_name")),
            skill_template_id=_id_by_name(skill_ids, row.get("skill_template_name")),
        )
        db.add(it)
        db.flush()
        item_ids[it.name] = it.id

    for sec, rewards in secret_rows:
        sec.rewards = _remap_reward_block(rewards, items=item_ids, effects=effect_ids)

    for row in (files.get("classes.json") or {}).get("classes") or []:
        name = row["name"]
        if only_missing and name in class_names:
            continue
        db.add(ClassTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=name,
            description=row.get("description") or "",
            base_stats=row.get("base_stats") or {},
            is_system=bool(row.get("is_system", False)),
        ))
        class_names.add(name)

    for row in (files.get("enemies.json") or {}).get("enemies") or []:
        name = row["name"]
        if only_missing and name in enemy_names:
            continue
        stats = copy.deepcopy(row.get("stats") or {})
        names = stats.pop("skill_template_names", None) or []
        if names:
            stats["skill_template_ids"] = [_id_by_name(skill_ids, n) for n in names]
        db.add(EnemyTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=name,
            description=row.get("description") or "",
            stats=stats,
            is_system=bool(row.get("is_system", False)),
        ))
        enemy_names.add(name)

    for row in (files.get("battle_presets.json") or {}).get("battle_presets") or []:
        pid = str(row["id"])
        if only_missing and pid in preset_ids:
            continue
        db.add(BattlePreset(
            id=pid,
            master_id=master_id if not row.get("is_system") else None,
            name=row.get("name") or pid,
            enemies=row.get("enemies") or [],
            is_system=bool(row.get("is_system", False)),
        ))
        preset_ids.add(pid)

    if "currency.json" in files and not only_missing:
        cur = files.get("currency.json") or {}
        db.add(CurrencySettings(
            master_id=None,
            tier1_name=cur.get("tier1_name") or "Copper",
            tier2_name=cur.get("tier2_name") or "Silver",
            tier3_name=cur.get("tier3_name") or "Gold",
            copper_per_silver=int(cur.get("copper_per_silver") or 10),
            silver_per_gold=int(cur.get("silver_per_gold") or 10),
            is_system=True,
        ))

    if "creation_settings.json" in files and not only_missing:
        creation = files.get("creation_settings.json") or {}
        set_creation_bonus_points(db, int(creation.get("creation_bonus_points") or 0))


def merge_pack_delta(db: Session, files: dict[str, Any], *, master_id: int | None) -> None:
    """Upsert mid-run settings additions by name without wiping the base pack."""
    _load_pack_templates(db, files, master_id=master_id, only_missing=True)
    meta = get_applied_pack(db) or {}
    meta["template_names"] = collect_template_names(db)
    set_applied_pack(db, meta)
    db.flush()


def import_pack_dict(
    db: Session,
    files: dict[str, Any],
    *,
    master_id: int | None,
    wipe: bool = True,
    commit: bool = True,
) -> dict[str, Any]:
    """Load pack templates. Destructive wipe of live world + templates when wipe=True."""
    pack = files.get("pack.json") or {}
    if not isinstance(pack, dict):
        raise ValueError("pack.json must be an object")
    fmt = int(pack.get("format_version") or 0)
    if fmt != PACK_FORMAT_VERSION:
        raise ValueError(f"Unsupported pack format_version {fmt}; expected {PACK_FORMAT_VERSION}")

    if wipe:
        wipe_live_world(db)
        wipe_pack_templates(db)

    _load_pack_templates(db, files, master_id=master_id, only_missing=False)

    meta = {
        "name": pack.get("name") or "imported",
        "version": pack.get("version") or "1.0.0",
        "format_version": PACK_FORMAT_VERSION,
        "layout_theme": pack.get("layout_theme"),
        "source": pack.get("source"),
        "template_names": collect_template_names(db),
    }
    set_applied_pack(db, meta)
    if commit:
        db.commit()
    else:
        db.flush()
    return meta


def parse_remote_repo(repo: str) -> dict[str, str]:
    """
    Accept a full git forge URL or GitHub shorthand owner/name.

    Returns keys: host, project_path, forge (github|gitlab|gitea), display
    """
    raw = (repo or "").strip()
    if not raw:
        raise ValueError("repository URL is required")

    # Shorthand: owner/name → GitHub
    if "://" not in raw and raw.count("/") == 1 and " " not in raw:
        owner, name = raw.split("/", 1)
        if owner and name and not name.endswith(".git"):
            return {
                "host": "github.com",
                "project_path": f"{owner}/{name}",
                "forge": "github",
                "display": f"https://github.com/{owner}/{name}",
            }

    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("Could not parse repository URL host")

    path = (parsed.path or "").strip("/")
    if path.endswith(".git"):
        path = path[: -len(".git")]
    # Drop trailing /tree/branch or /blob/... if pasted from browser
    for marker in ("/tree/", "/blob/", "/src/branch/", "/-/tree/", "/-/blob/"):
        if marker in f"/{path}":
            path = path.split(marker, 1)[0].strip("/")
            break
    path = path.strip("/")
    if not path or "/" not in path:
        raise ValueError("Repository URL must include owner/project path")

    if host in ("github.com", "www.github.com"):
        forge = "github"
        # github.com/owner/repo only (ignore extra path segments beyond 2)
        parts = path.split("/")
        path = "/".join(parts[:2])
    elif host == "gitlab.com" or host.startswith("gitlab.") or "gitlab" in host:
        forge = "gitlab"
    else:
        # Gitea / Forgejo / Codeberg / many self-hosted forges
        forge = "gitea"
        parts = path.split("/")
        path = "/".join(parts[:2])

    return {
        "host": host,
        "project_path": path,
        "forge": forge,
        "display": f"https://{host}/{path}",
    }


def raw_pack_file_url(*, forge: str, host: str, project_path: str, branch: str, rel_path: str) -> str:
    """Build a raw-file URL for pack JSON on common git forges."""
    branch = branch.strip() or "main"
    rel = rel_path.lstrip("/")
    if forge == "github":
        return f"https://raw.githubusercontent.com/{project_path}/{branch}/{rel}"
    if forge == "gitlab":
        return f"https://{host}/{project_path}/-/raw/{branch}/{rel}"
    # Gitea / Forgejo / Codeberg
    return f"https://{host}/{project_path}/raw/branch/{branch}/{rel}"


def fetch_pack_from_remote(
    *,
    repo: str,
    branch: str,
    token: str | None = None,
    path_prefix: str = "",
) -> dict[str, Any]:
    """Fetch pack JSON files from a git forge URL (GitHub, GitLab, Gitea-style) + branch."""
    info = parse_remote_repo(repo)
    branch = branch.strip() or "main"
    prefix = path_prefix.strip().strip("/")
    files: dict[str, Any] = {}
    for filename in PACK_FILES:
        rel = f"{prefix}/{filename}" if prefix else filename
        url = raw_pack_file_url(
            forge=info["forge"],
            host=info["host"],
            project_path=info["project_path"],
            branch=branch,
            rel_path=rel,
        )
        headers = {"User-Agent": "hike-and-strike-settings-pack"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = Request(url, headers=headers)
        try:
            with urlopen(req, timeout=30) as resp:
                files[filename] = json.loads(resp.read().decode("utf-8"))
        except HTTPError as exc:
            if filename == "pack.json" or exc.code != 404:
                raise ValueError(
                    f"Failed to fetch {rel} from {info['display']}@{branch}: HTTP {exc.code}"
                ) from exc
            continue
        except URLError as exc:
            raise ValueError(f"Network error fetching {rel}: {exc}") from exc
    if "pack.json" not in files:
        raise ValueError(f"pack.json not found on {info['display']}@{branch}")
    files["pack.json"]["source"] = {
        "repo": info["display"],
        "branch": branch,
        "path_prefix": prefix or None,
        "forge": info["forge"],
    }
    return files


def fetch_pack_from_github(
    *,
    repo: str,
    branch: str,
    token: str | None = None,
    path_prefix: str = "",
) -> dict[str, Any]:
    """Backward-compatible alias for fetch_pack_from_remote."""
    return fetch_pack_from_remote(
        repo=repo,
        branch=branch,
        token=token,
        path_prefix=path_prefix,
    )
