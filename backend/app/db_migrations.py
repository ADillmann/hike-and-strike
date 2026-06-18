from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


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
