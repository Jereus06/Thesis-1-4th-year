"""Structural checks for StockCast SQL migration contracts."""

import re
from pathlib import Path


MIGRATIONS = Path(__file__).parents[1] / "db" / "migrations"
TABLES = (
    "businesses",
    "users",
    "products",
    "sales",
    "inventory_movements",
    "data_imports",
    "business_settings",
    "forecast_runs",
    "forecast_predictions",
    "forecast_metrics",
    "reorder_recommendations",
    "sessions",
    "idempotency_keys",
    "google_identities",
    "oauth_flows",
    "google_pending",
    "sales_day_quality",
    "sales_day_quality_audit",
)


def check_schema() -> None:
    paths = sorted(MIGRATIONS.glob("*.sql"))
    if not paths:
        raise AssertionError("No SQL migrations found")
    up = "\n".join(
        path.read_text(encoding="utf-8") for path in paths if path.name.endswith(".up.sql")
    )
    down = "\n".join(
        path.read_text(encoding="utf-8") for path in paths if path.name.endswith(".down.sql")
    )
    for table in TABLES:
        if not re.search(rf"CREATE TABLE {table}\s*\(", up):
            raise AssertionError(f"Missing table {table}")
        if f"DROP TABLE IF EXISTS {table};" not in down:
            raise AssertionError(f"Down migrations do not drop {table}")
    for method in ("moving_average", "xgboost", "ensemble", "fallback", "rule"):
        if f"'{method}'" not in up:
            raise AssertionError(f"Missing forecast method {method}")
    for split in ("train", "validation", "final_test"):
        if f"'{split}'" not in up:
            raise AssertionError(f"Missing dataset split {split}")
    required = (
        "training_end < validation_start",
        "validation_end < final_test_start",
        "quantity_delta numeric",
        "xgboost_verified boolean NOT NULL DEFAULT false",
    )
    for contract in required:
        if contract not in up:
            raise AssertionError(f"Missing schema contract: {contract}")
    for path in paths:
        sql = path.read_text(encoding="utf-8").strip()
        if not sql.upper().startswith("BEGIN;") or not sql.upper().endswith("COMMIT;"):
            raise AssertionError(f"{path.name} must be transactional")


if __name__ == "__main__":
    check_schema()
    print(f"Schema contract check passed for {len(TABLES)} tables.")
