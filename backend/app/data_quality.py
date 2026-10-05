"""Pure helpers for turning audited day classifications into forecast observations."""

from dataclasses import dataclass
from datetime import date
from math import isfinite
from typing import Any

POLICY_VERSION = "2026-10-05"

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
    prepared = prepare_product_series(rows, quality, None, start, end)
    return [(item.day, item.quantity) for item in prepared.targets]


def effective_classifications(quality, product_id, start: date | None = None, end: date | None = None):
    """Resolve product-specific reviews over the store-wide review on each date."""
    storewide, specific = {}, {}
    for item in quality:
        day = date.fromisoformat(item["date"]) if isinstance(item["date"], str) else item["date"]
        if (start is not None and day < start) or (end is not None and day > end):
            continue
        item_product = item.get("productId")
        if item_product in (None, ""):
            storewide[day] = item["classification"]
        elif str(item_product) == str(product_id):
            specific[day] = item["classification"]
    return {**storewide, **specific}


def _daily_sales_totals(rows):
    totals = {}
    for row in rows:
        day = row["sale_date"]
        if isinstance(day, str):
            day = date.fromisoformat(day)
        quantity = float(row["quantity"])
        # The sales contract requires positive quantities. Reviewed zeros are
        # supplied by classifications, never by invalid or absent transactions.
        if isfinite(quantity) and quantity > 0:
            totals[day] = totals.get(day, 0.0) + quantity
    return totals


def usable_history_bounds(sales, quality, product_ids, through: date, start: date | None = None):
    """Find actual usable observation dates for the requested active products.

    No unclassified absent date extends the history. Exclusions remove recorded
    sales; an effective confirmed-zero review supplies an observed zero instead.
    The caller supplies active product IDs and the configured business-day cutoff.
    """
    active_ids = {str(product_id) for product_id in product_ids}
    grouped = {product_id: [] for product_id in active_ids}
    for row in sales:
        product_id = str(row["product_id"])
        if product_id in grouped:
            grouped[product_id].append(row)
    usable_dates = set()
    for product_id, rows in grouped.items():
        classifications = effective_classifications(quality, product_id, start, through)
        usable_dates.update(
            day for day in _daily_sales_totals(rows)
            if day <= through and (start is None or day >= start)
            and classifications.get(day) not in _EXCLUDED_CLASSIFICATIONS
        )
        usable_dates.update(
            day for day, classification in classifications.items()
            if classification == "confirmed_zero"
        )
    return (
        (min(usable_dates), max(usable_dates))
        if usable_dates else (None, None)
    )


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
    totals = _daily_sales_totals(rows)
    classifications = effective_classifications(quality, product_id, start, end)

    targets = []
    warnings = []
    unknown_dates = []
    excluded_dates = []
    day = start
    while day <= end:
        classification = classifications.get(day)
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
