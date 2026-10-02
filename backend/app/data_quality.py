"""Deterministic, ledger-preserving forecast preparation policy."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any, Iterable

EXCLUDED = {"business_closed", "incomplete", "full_stockout", "partial_stockout"}
POLICY_VERSION = "explicit-day-classification-v2"


@dataclass(frozen=True)
class PreparedDay:
    day: date
    quantity: float
    provenance: str


@dataclass(frozen=True)
class PreparationWarning:
    day: date
    code: str
    message: str


@dataclass(frozen=True)
class PreparedSeries:
    days: tuple[PreparedDay, ...]
    warnings: tuple[PreparationWarning, ...]
    unknown_dates: tuple[date, ...]
    excluded_dates: tuple[date, ...]
    policy_version: str = POLICY_VERSION

    def snapshot(self) -> dict[str, Any]:
        return {
            "policyVersion": self.policy_version,
            "targets": [{**asdict(item), "day": str(item.day)} for item in self.days],
            "warnings": [{**asdict(item), "day": str(item.day)} for item in self.warnings],
            "unknownDates": [str(item) for item in self.unknown_dates],
            "excludedDates": [str(item) for item in self.excluded_dates],
        }


def prepare_product_series(
    rows: Iterable[dict[str, Any]],
    quality: Iterable[dict[str, Any]],
    product_id: str,
    start: date,
    end: date,
) -> PreparedSeries:
    """Resolve product-over-store classifications without mutating ledger rows.

    Positive recorded sales win over a contradictory confirmed-zero classification and raise a
    review warning. Exclusion classifications always remove a forecasting target, even if the
    ledger contains sales, while retaining that ledger transaction outside this pure preparation.
    """
    totals: dict[date, float] = {}
    for row in rows:
        day = _day(row.get("sale_date", row.get("date")))
        if start <= day <= end:
            totals[day] = totals.get(day, 0.0) + float(row["quantity"])

    global_quality: dict[date, str] = {}
    product_quality: dict[date, str] = {}
    for item in quality:
        day = _day(item.get("classification_date", item.get("date")))
        if not start <= day <= end:
            continue
        item_product = item.get("product_id", item.get("productId"))
        target = (
            product_quality
            if item_product is not None and str(item_product) == product_id
            else global_quality
        )
        if item_product is None or str(item_product) == product_id:
            target[day] = str(item["classification"])

    prepared, warnings, unknown, excluded = [], [], [], []
    cursor = start
    while cursor <= end:
        classification = product_quality.get(cursor, global_quality.get(cursor))
        quantity = totals.get(cursor)
        if classification in EXCLUDED:
            excluded.append(cursor)
            if quantity is not None:
                warnings.append(
                    PreparationWarning(
                        cursor,
                        "sale_on_excluded_date",
                        f"Recorded sales exist on a date classified as {classification}; review the classification or ledger.",
                    )
                )
        elif classification == "confirmed_zero":
            if quantity is not None and quantity > 0:
                prepared.append(PreparedDay(cursor, quantity, "recorded_sales"))
                warnings.append(
                    PreparationWarning(
                        cursor,
                        "confirmed_zero_with_sales",
                        "Positive recorded sales conflict with confirmed zero; sales were retained and the date requires review.",
                    )
                )
            else:
                prepared.append(PreparedDay(cursor, 0.0, "confirmed_zero"))
        elif quantity is not None:
            prepared.append(PreparedDay(cursor, quantity, "recorded_sales"))
        else:
            unknown.append(cursor)
        cursor += timedelta(days=1)
    return PreparedSeries(tuple(prepared), tuple(warnings), tuple(unknown), tuple(excluded))


def contiguous_tail(series: PreparedSeries, window: int) -> tuple[PreparedDay, ...]:
    """Return a complete calendar-spaced tail or no data when a defensible MA is unavailable."""
    if window < 1 or len(series.days) < window:
        return ()
    tail = series.days[-window:]
    if all(
        tail[index].day - tail[index - 1].day == timedelta(days=1) for index in range(1, len(tail))
    ):
        return tail
    return ()


def _day(value: date | str | None) -> date:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    raise ValueError("A classification or sale date is required")
