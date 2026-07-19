from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session


def _table_columns(engine: Engine, table: str) -> set[str]:
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return set()
    return {col["name"] for col in insp.get_columns(table)}


def _add_column_if_missing(engine: Engine, table: str, column: str, ddl: str) -> None:
    if column in _table_columns(engine, table):
        return
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


def _column_nullable(engine: Engine, table: str, column: str) -> bool | None:
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return None
    for col in insp.get_columns(table):
        if col["name"] == column:
            return col.get("nullable", False)
    return None


def _patch_stat_change_log_nullable_master(engine: Engine) -> None:
    if _column_nullable(engine, "stat_change_log", "changed_by_master_id") is not False:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE stat_change_log_new (
                    id INTEGER PRIMARY KEY,
                    character_id INTEGER NOT NULL,
                    stat_name VARCHAR(64) NOT NULL,
                    old_value INTEGER NOT NULL,
                    new_value INTEGER NOT NULL,
                    reason TEXT,
                    changed_by_master_id INTEGER REFERENCES users(id),
                    campaign_id INTEGER REFERENCES campaigns(id),
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO stat_change_log_new (
                    id, character_id, stat_name, old_value, new_value,
                    reason, changed_by_master_id, campaign_id, timestamp
                )
                SELECT
                    id, character_id, stat_name, old_value, new_value,
                    reason, changed_by_master_id, campaign_id, timestamp
                FROM stat_change_log
                """
            )
        )
        conn.execute(text("DROP TABLE stat_change_log"))
        conn.execute(text("ALTER TABLE stat_change_log_new RENAME TO stat_change_log"))


def apply_schema_patches(engine: Engine) -> None:
    """Lightweight migrations for existing SQLite DBs (create_all does not alter tables)."""
    _add_column_if_missing(
        engine,
        "skills",
        "skill_template_id",
        "skill_template_id INTEGER REFERENCES skill_templates(id)",
    )
    _add_column_if_missing(
        engine,
        "temporary_effects",
        "cleared_on_event",
        "cleared_on_event BOOLEAN DEFAULT 0",
    )
    _add_column_if_missing(engine, "characters", "level", "level INTEGER DEFAULT 1")
    _add_column_if_missing(engine, "characters", "xp", "xp INTEGER DEFAULT 0")
    _add_column_if_missing(engine, "characters", "stat_points_free", "stat_points_free INTEGER DEFAULT 0")
    _add_column_if_missing(
        engine,
        "characters",
        "level_stat_allocations",
        "level_stat_allocations TEXT DEFAULT '{}'",
    )
    _patch_stat_change_log_nullable_master(engine)
    _add_column_if_missing(
        engine,
        "temporary_effects",
        "effect_template_id",
        "effect_template_id INTEGER REFERENCES effect_templates(id)",
    )
    _add_column_if_missing(
        engine,
        "temporary_effects",
        "battle_modifiers",
        "battle_modifiers TEXT DEFAULT '{}'",
    )
    _add_column_if_missing(
        engine,
        "temporary_effects",
        "active_in_battle",
        "active_in_battle BOOLEAN DEFAULT 0",
    )
    _add_column_if_missing(
        engine,
        "item_templates",
        "secret_template_id",
        "secret_template_id INTEGER REFERENCES secret_templates(id)",
    )
    _add_column_if_missing(
        engine,
        "item_templates",
        "effect_template_id",
        "effect_template_id INTEGER REFERENCES effect_templates(id)",
    )
    _add_column_if_missing(
        engine,
        "item_templates",
        "skill_template_id",
        "skill_template_id INTEGER REFERENCES skill_templates(id)",
    )
    _add_column_if_missing(
        engine,
        "inventory_items",
        "secret_state",
        "secret_state TEXT DEFAULT '{}'",
    )
    _add_column_if_missing(engine, "characters", "wallet_copper", "wallet_copper INTEGER DEFAULT 0")
    _add_column_if_missing(engine, "item_templates", "base_price", "base_price INTEGER DEFAULT 0")
    _add_column_if_missing(
        engine,
        "event_templates",
        "shop_config",
        "shop_config TEXT",
    )
    _add_column_if_missing(
        engine,
        "event_templates",
        "battle_config",
        "battle_config TEXT",
    )
    _ensure_currency_settings_table(engine)
    _ensure_game_settings_table(engine)
    _add_column_if_missing(
        engine,
        "characters",
        "class_template_id",
        "class_template_id INTEGER REFERENCES class_templates(id)",
    )
    _add_column_if_missing(engine, "skills", "slot_kind", "slot_kind VARCHAR(16)")
    _backfill_skill_slot_kinds(engine)
    _reconcile_all_character_stat_points(engine)


def _backfill_skill_slot_kinds(engine: Engine) -> None:
    from app.models import Skill
    from app.services.skill_effects import skill_battle_meta
    from app.services.skill_slots import default_slot_for_backfill

    with Session(engine) as session:
        skills = (
            session.query(Skill)
            .filter(Skill.slot_kind.is_(None))
            .all()
        )
        if not skills:
            return
        from sqlalchemy.orm import joinedload

        skills = (
            session.query(Skill)
            .options(joinedload(Skill.skill_template))
            .filter(Skill.slot_kind.is_(None))
            .all()
        )
        for skill in skills:
            effect = skill_battle_meta(skill).get("effect_type") or "none"
            skill.slot_kind = default_slot_for_backfill(effect)
        session.commit()


def _ensure_game_settings_table(engine: Engine) -> None:
    insp = inspect(engine)
    if "game_settings" in insp.get_table_names():
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE game_settings (
                    key VARCHAR(64) PRIMARY KEY,
                    value TEXT DEFAULT ''
                )
                """
            )
        )


def _ensure_currency_settings_table(engine: Engine) -> None:
    insp = inspect(engine)
    if "currency_settings" in insp.get_table_names():
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE currency_settings (
                    id INTEGER PRIMARY KEY,
                    master_id INTEGER REFERENCES users(id),
                    tier1_name VARCHAR(64) DEFAULT 'Copper',
                    tier2_name VARCHAR(64) DEFAULT 'Silver',
                    tier3_name VARCHAR(64) DEFAULT 'Gold',
                    copper_per_silver INTEGER DEFAULT 100,
                    silver_per_gold INTEGER DEFAULT 10,
                    is_system BOOLEAN DEFAULT 0
                )
                """
            )
        )


def _reconcile_all_character_stat_points(engine: Engine) -> None:
    from app.models import Character
    from app.services.character_progression import sync_stat_points_free

    with Session(engine) as session:
        characters = session.query(Character).all()
        changed = False
        for character in characters:
            before = character.stat_points_free
            sync_stat_points_free(character)
            if character.stat_points_free != before:
                changed = True
        if changed:
            session.commit()
