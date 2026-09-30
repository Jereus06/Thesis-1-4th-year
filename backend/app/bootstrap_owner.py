import psycopg

from .config import BootstrapSettings, get_settings
from .security import hash_password


def bootstrap() -> str:
    owner = BootstrapSettings()  # type: ignore[call-arg]
    business_id = owner.owner_business_id
    origin = owner.owner_data_origin
    if origin not in {"demo", "partner"}:
        raise RuntimeError("OWNER_DATA_ORIGIN must be demo or partner")
    with psycopg.connect(str(get_settings().database_url)) as conn:
        conn.execute(
            "INSERT INTO businesses(id,name,data_origin) VALUES(%s,%s,%s) ON CONFLICT(id) DO NOTHING",
            (business_id, owner.owner_business_name.strip(), origin),
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
            (
                business_id,
                owner.owner_email.strip().lower(),
                owner.owner_display_name.strip(),
                hash_password(owner.owner_password),
            ),
        )
    return business_id


def main() -> None:
    print(f"Owner ready for business {bootstrap()}.")


if __name__ == "__main__":
    main()
