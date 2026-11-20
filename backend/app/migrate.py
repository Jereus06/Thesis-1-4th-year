import hashlib
import re
from pathlib import Path

import psycopg

from .config import get_settings


MIGRATION_DIR = Path(__file__).parents[1] / "db" / "migrations"
LOCK_ID = 7_341_921

# This exact published migration also exists in installations whose attributes
# were added under older filenames or by 012_selling_prices. Preserve its bytes
# and checksum; recognize the already-satisfied schema instead of adding twice.
ATTRIBUTE_BASELINE = (
    "012_product_attributes.up.sql",
    "9e7aee18a78d9e205e42f3e34b2fb7c1782dbc9e69a550182ff0719df2991f16",
)


def existing_attribute_baseline(conn, filename: str, checksum: str) -> bool:
    if (filename, checksum) != ATTRIBUTE_BASELINE:
        return False
    rows = conn.execute(
        """SELECT column_name,data_type,character_maximum_length,is_nullable,column_default
           FROM information_schema.columns WHERE table_schema=current_schema()
           AND table_name='products' AND column_name IN ('brand','model','variant')"""
    ).fetchall()
    required_width = {"brand": 100, "model": 150, "variant": 150}
    return len(rows) == 3 and all(
        (kind == "text" or (kind == "character varying" and (width is None or width >= required_width[name])))
        and nullable == "NO" and default in {"''::text", "''::character varying"}
        for name, kind, width, nullable, default in rows
    )


def migration_body(source: str) -> str:
    body = re.sub(r"^\s*BEGIN;\s*", "", source, flags=re.IGNORECASE)
    return re.sub(r"\s*COMMIT;\s*$", "", body, flags=re.IGNORECASE)


def migrate() -> list[str]:
    applied: list[str] = []
    with psycopg.connect(str(get_settings().database_url), autocommit=True) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_ID,))
        try:
            conn.execute("""CREATE TABLE IF NOT EXISTS schema_migrations(
                filename text PRIMARY KEY, checksum text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now())""")
            for path in sorted(MIGRATION_DIR.glob("*.up.sql")):
                source = path.read_text(encoding="utf-8")
                checksum = hashlib.sha256(source.encode()).hexdigest()
                row = conn.execute(
                    "SELECT checksum FROM schema_migrations WHERE filename=%s", (path.name,)
                ).fetchone()
                if row:
                    if row[0] != checksum:
                        raise RuntimeError(f"Applied migration {path.name} has changed")
                    continue
                with conn.transaction():
                    if not existing_attribute_baseline(conn, path.name, checksum):
                        conn.execute(migration_body(source))
                    conn.execute(
                        "INSERT INTO schema_migrations(filename,checksum) VALUES(%s,%s)",
                        (path.name, checksum),
                    )
                applied.append(path.name)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))
    return applied


if __name__ == "__main__":
    names = migrate()
    print(f"Applied: {', '.join(names)}" if names else "Database is up to date.")
