"""Pure helpers for turning audited day classifications into forecast observations."""

from dataclasses import dataclass
from datetime import date
from typing import Any

POLICY_VERSION = "2026-10-02"

_EXCLUDED_CLASSIFICATIONS = {"business_closed", "full_stockout", "partial_stockout", "incomplete"}


@dataclass(frozen=True)
class QualityWarning:
    code: str
    message: str
    date: date

    def snapshot(self):
        return {"code": self.code, "message": self.message, "date": str(self.date)}


@dataclass(frozen=True)
class PreparedTarget:
    day: date
    quantity: float
    provenance: str

    def snapshot(self):
        return {"day": str(self.day), "quantity": self.quantity, "provenance": self.provenance}


@dataclass
class PreparedProductSeries:
    days: list[PreparedTarget]
    targets: list[PreparedTarget]
    warnings: list[QualityWarning]
    unknown_dates: list[date]
    excluded_dates: list[date]

    def snapshot(self):
        return {
            "targets": [item.snapshot() for item in self.targets],
            "warnings": [item.snapshot() for item in self.warnings],
            "unknownDates": [str(item) for item in self.unknown_dates],
            "excludedDates": [str(item) for item in self.excluded_dates],
        }


def observed_daily_values(rows: list[dict[str, Any]], start: date, end: date, quality=()):
    """Return dated values without interpreting an absent date as zero demand."""
    totals = {row["sale_date"]: float(row["quantity"]) for row in rows}
    for item in quality:
        day = date.fromisoformat(item["date"]) if isinstance(item["date"], str) else item["date"]
        if start <= day <= end and item["classification"] == "confirmed_zero":
            totals.setdefault(day, 0.0)
    return [(day, totals[day]) for day in sorted(totals) if start <= day <= end]


def contiguous_tail(targets: list[PreparedTarget], end: date):
    contiguous = []
    expected = end
    for item in reversed(targets):
        if item.day != expected:
            break
        contiguous.append(item)
        expected = expected.fromordinal(expected.toordinal() - 1)
    return list(reversed(contiguous))


def prepare_product_series(rows, quality, product_id, start: date, end: date):
    totals = {row["sale_date"]: float(row["quantity"]) for row in rows}
    storewide, specific = {}, {}
    for item in quality:
        day = date.fromisoformat(item["date"]) if isinstance(item["date"], str) else item["date"]
        if not (start <= day <= end):
            continue
        if item.get("productId") in (None, ""):
            storewide[day] = item["classification"]
        elif item.get("productId") == product_id:
            specific[day] = item["classification"]

    targets = []
    warnings = []
    unknown_dates = []
    excluded_dates = []
    day = start
    while day <= end:
        classification = specific.get(day, storewide.get(day))
        quantity = totals.get(day)
        if quantity is not None:
            if classification == "confirmed_zero":
                warnings.append(
                    QualityWarning(
                        "confirmed_zero_with_sales",
                        "Confirmed-zero classification kept recorded sales for this date.",
                        day,
                    )
                )
                targets.append(PreparedTarget(day, quantity, "recorded_sales"))
            elif classification in _EXCLUDED_CLASSIFICATIONS:
                excluded_dates.append(day)
            else:
                targets.append(PreparedTarget(day, quantity, "recorded_sales"))
        else:
            if classification == "confirmed_zero":
                targets.append(PreparedTarget(day, 0.0, "confirmed_zero"))
            elif classification in _EXCLUDED_CLASSIFICATIONS:
                excluded_dates.append(day)
            else:
                unknown_dates.append(day)
        day = day.fromordinal(day.toordinal() + 1)
    return PreparedProductSeries(targets, targets, warnings, unknown_dates, excluded_dates)
