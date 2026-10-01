import psycopg

from .config import get_settings
from .security import hash_password


def bootstrap() -> str:
    settings = get_settings()
    business_id = str(settings.owner_business_id)
    origin = settings.owner_data_origin
    if origin not in {"demo", "partner"}:
        raise RuntimeError("OWNER_DATA_ORIGIN must be demo or partner")
    if len(settings.owner_password) < 12:
        raise RuntimeError("OWNER_PASSWORD must contain at least 12 characters")
    with psycopg.connect(str(settings.database_url)) as conn:
        conn.execute(
            "INSERT INTO businesses(id,name,data_origin) VALUES(%s,%s,%s) ON CONFLICT(id) DO NOTHING",
            (business_id, settings.owner_business_name, origin),
        )
        conn.execute(
            "INSERT INTO business_settings(business_id) VALUES(%s) ON CONFLICT DO NOTHING",
            (business_id,),
        )
        conn.execute(
            """INSERT INTO users(business_id,email,display_name,role,password_hash,password_changed_at)
            VALUES(%s,%s,%s,'owner',%s,now())
            ON CONFLICT(business_id,email) DO NOTHING""",
            (
                business_id,
                str(settings.owner_email).lower(),
                settings.owner_display_name,
                hash_password(settings.owner_password),
            ),
        )
    return business_id


if __name__ == "__main__":
    print(f"Owner ready for business {bootstrap()}.")
