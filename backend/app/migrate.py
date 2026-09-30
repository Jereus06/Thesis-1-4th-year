import hashlib
import re
from pathlib import Path

import psycopg

from .config import get_settings


MIGRATION_DIR = Path(__file__).parents[1] / "db" / "migrations"
LOCK_ID = 7_341_921


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
                    conn.execute(migration_body(source))
                    conn.execute(
                        "INSERT INTO schema_migrations(filename,checksum) VALUES(%s,%s)",
                        (path.name, checksum),
                    )
                applied.append(path.name)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))
    return applied


def main() -> None:
    names = migrate()
    print(f"Applied: {', '.join(names)}" if names else "Database is up to date.")


if __name__ == "__main__":
    main()
