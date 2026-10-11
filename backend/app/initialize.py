"""Idempotent first-start setup; restarting never resets an existing owner's password."""

from .bootstrap_owner import bootstrap
from .migrate import migrate

if __name__ == "__main__":
    migrations = migrate()
    print(f"Database ready ({len(migrations)} new migrations).")
    print(f"Owner ready for business {bootstrap()}.")
