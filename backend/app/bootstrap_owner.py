import os
import uuid

import psycopg

from .config import get_settings
from .security import hash_password


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Set {name}")
    return value


def bootstrap() -> str:
    business_id = os.getenv("OWNER_BUSINESS_ID") or str(uuid.uuid4())
    origin = os.getenv("OWNER_DATA_ORIGIN", "demo")
    if origin not in {"demo", "partner"}:
        raise RuntimeError("OWNER_DATA_ORIGIN must be demo or partner")
    with psycopg.connect(str(get_settings().database_url)) as conn:
        conn.execute(
            "INSERT INTO businesses(id,name,data_origin) VALUES(%s,%s,%s) ON CONFLICT(id) DO NOTHING",
            (business_id, required("OWNER_BUSINESS_NAME"), origin),
        )
        conn.execute(
            "INSERT INTO business_settings(business_id) VALUES(%s) ON CONFLICT DO NOTHING",
            (business_id,),
        )
        conn.execute(
            """INSERT INTO users(business_id,email,display_name,role,password_hash,password_changed_at)
            VALUES(%s,%s,%s,'owner',%s,now())
            ON CONFLICT(business_id,email) DO UPDATE SET display_name=excluded.display_name,
            password_hash=excluded.password_hash,password_changed_at=now(),is_active=true""",
            (business_id, required("OWNER_EMAIL").lower(), required("OWNER_DISPLAY_NAME"),
             hash_password(required("OWNER_PASSWORD"))),
        )
    return business_id


if __name__ == "__main__":
    print(f"Owner ready for business {bootstrap()}.")
