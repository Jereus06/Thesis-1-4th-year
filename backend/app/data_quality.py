"""Pure helpers for turning audited day classifications into forecast observations."""

from datetime import date
from typing import Any


def observed_daily_values(rows: list[dict[str, Any]], start: date, end: date, quality=()):
    """Return dated values without interpreting an absent date as zero demand."""
    totals = {row["sale_date"]: float(row["quantity"]) for row in rows}
    for item in quality:
        day = date.fromisoformat(item["date"]) if isinstance(item["date"], str) else item["date"]
        if start <= day <= end and item["classification"] == "confirmed_zero":
            totals.setdefault(day, 0.0)
    return [(day, totals[day]) for day in sorted(totals) if start <= day <= end]
