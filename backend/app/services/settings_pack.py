"""Settings pack export / destructive import / GitHub load."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
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


def import_pack_dict(db: Session, files: dict[str, Any], *, master_id: int | None) -> dict[str, Any]:
    """Destructive: wipe live world + templates, then load pack. Returns applied pack meta."""
    pack = files.get("pack.json") or {}
    if not isinstance(pack, dict):
        raise ValueError("pack.json must be an object")
    fmt = int(pack.get("format_version") or 0)
    if fmt != PACK_FORMAT_VERSION:
        raise ValueError(f"Unsupported pack format_version {fmt}; expected {PACK_FORMAT_VERSION}")

    wipe_live_world(db)
    wipe_pack_templates(db)

    effects_data = (files.get("effects.json") or {}).get("effects") or []
    effect_ids: dict[str, int] = {}
    for row in effects_data:
        e = EffectTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=row["name"],
            description=row.get("description") or "",
            label=row.get("label") or row["name"],
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

    skills_data = (files.get("skills.json") or {}).get("skills") or []
    skill_ids: dict[str, int] = {}
    for row in skills_data:
        params = copy.deepcopy(row.get("effect_params") or {})
        if "effect_template_name" in params:
            params["effect_template_id"] = _id_by_name(effect_ids, params.pop("effect_template_name"))
        s = SkillTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=row["name"],
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

    secrets_data = (files.get("secrets.json") or {}).get("secrets") or []
    secret_ids: dict[str, int] = {}
    secret_rows: list[tuple[SecretTemplate, dict]] = []
    for row in secrets_data:
        sec = SecretTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=row["name"],
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

    items_data = (files.get("items.json") or {}).get("items") or []
    item_ids: dict[str, int] = {}
    for row in items_data:
        it = ItemTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=row["name"],
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
        db.add(ClassTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=row["name"],
            description=row.get("description") or "",
            base_stats=row.get("base_stats") or {},
            is_system=bool(row.get("is_system", False)),
        ))

    for row in (files.get("enemies.json") or {}).get("enemies") or []:
        stats = copy.deepcopy(row.get("stats") or {})
        names = stats.pop("skill_template_names", None) or []
        if names:
            stats["skill_template_ids"] = [_id_by_name(skill_ids, n) for n in names]
        db.add(EnemyTemplate(
            master_id=master_id if not row.get("is_system") else None,
            name=row["name"],
            description=row.get("description") or "",
            stats=stats,
            is_system=bool(row.get("is_system", False)),
        ))

    for row in (files.get("battle_presets.json") or {}).get("battle_presets") or []:
        db.add(BattlePreset(
            id=str(row["id"]),
            master_id=master_id if not row.get("is_system") else None,
            name=row.get("name") or row["id"],
            enemies=row.get("enemies") or [],
            is_system=bool(row.get("is_system", False)),
        ))

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

    creation = files.get("creation_settings.json") or {}
    set_creation_bonus_points(db, int(creation.get("creation_bonus_points") or 0))

    meta = {
        "name": pack.get("name") or "imported",
        "version": pack.get("version") or "1.0.0",
        "format_version": PACK_FORMAT_VERSION,
        "layout_theme": pack.get("layout_theme"),
        "source": pack.get("source"),
    }
    set_applied_pack(db, meta)
    db.commit()
    return meta


def fetch_pack_from_github(
    *,
    repo: str,
    branch: str,
    token: str | None = None,
    path_prefix: str = "",
) -> dict[str, Any]:
    """Fetch pack JSON files from a public (or token-auth) GitHub repo branch."""
    repo = repo.strip().strip("/")
    if repo.count("/") != 1:
        raise ValueError("repo must be owner/name")
    branch = branch.strip() or "main"
    prefix = path_prefix.strip().strip("/")
    files: dict[str, Any] = {}
    for filename in PACK_FILES:
        rel = f"{prefix}/{filename}" if prefix else filename
        url = f"https://raw.githubusercontent.com/{repo}/{branch}/{rel}"
        headers = {"User-Agent": "hike-and-strike-settings-pack"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = Request(url, headers=headers)
        try:
            with urlopen(req, timeout=30) as resp:
                files[filename] = json.loads(resp.read().decode("utf-8"))
        except HTTPError as exc:
            if filename == "pack.json" or exc.code != 404:
                raise ValueError(f"Failed to fetch {rel} from {repo}@{branch}: HTTP {exc.code}") from exc
            continue
        except URLError as exc:
            raise ValueError(f"Network error fetching {rel}: {exc}") from exc
    if "pack.json" not in files:
        raise ValueError("pack.json not found on that branch")
    files["pack.json"]["source"] = {"repo": repo, "branch": branch, "path_prefix": prefix or None}
    return files
