"""Rule snapshots follow the shared reviewed-day demand policy."""

from contextlib import nullcontext
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.repository import Repository
from app.schemas import RecommendationGenerate

PRODUCT_ID = UUID("00000000-0000-4000-8000-000000000001")
OTHER_PRODUCT_ID = UUID("00000000-0000-4000-8000-000000000002")
END = date(2026, 1, 7)


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class RecommendationConnection:
    def __init__(self, sales, quality):
        self.sales, self.quality = sales, quality
        self.persisted = [{"id": "obsolete-rule-snapshot"}]
        self.deleted = False

    def transaction(self):
        return nullcontext()

    def execute(self, query, params):
        if "FROM business_settings" in query:
            return Result([{"target_cover_days": 7}])
        if "FROM products" in query:
            return Result([{
                "id": PRODUCT_ID,
                "name": "Reviewed product",
                "current_stock": Decimal("2"),
                "lead_time_days": 2,
                "safety_stock": Decimal("2"),
                "is_active": True,
            }])
        if "FROM sales_day_quality" in query:
            return Result(self.quality)
        if "FROM sales" in query:
            return Result(self.sales)
        if "DELETE FROM reorder_recommendations" in query:
            self.persisted.clear()
            self.deleted = True
            return Result([])
        if "INSERT INTO reorder_recommendations" in query:
            assert "'rule-v2-reviewed-days'" in query
            fields = (
                "business_id", "product_id", "recommendation_date",
                "forecast_daily_demand", "current_stock", "lead_time_days",
                "safety_stock", "target_cover_days", "demand_during_lead_time",
                "reorder_point", "target_stock", "suggested_quantity", "status",
            )
            row = dict(zip(fields, params, strict=True))
            row.update({
                "id": "reviewed-rule-snapshot",
                "forecast_run_id": None,
                "method": "rule",
                "confidence_level": "low",
                "calculation_version": "rule-v2-reviewed-days",
            })
            self.persisted.append(row)
            return Result([row])
        raise AssertionError(f"Unexpected query: {query}")


def sale(day, quantity):
    return {
        "product_id": PRODUCT_ID,
        "sale_date": date(2026, 1, day),
        "quantity": Decimal(quantity),
    }


def classification(day, value, product_id=None):
    return {
        "product_id": product_id,
        "classification_date": date(2026, 1, day),
        "classification": value,
        "note": None,
    }


def generate(sales=(), quality=()):
    conn = RecommendationConnection(list(sales), list(quality))
    principal = SimpleNamespace(business_id="test-business")
    rows = Repository(conn).generate_recommendations(
        principal, RecommendationGenerate(recommendation_date=END, lookback_days=7)
    )
    return rows, conn


def test_unclassified_missing_dates_are_not_zero_filled():
    rows, conn = generate([sale(5, "10"), sale(7, "6")])
    assert Decimal(rows[0]["forecastDailyDemand"]) == Decimal("6")
    assert conn.deleted and len(conn.persisted) == 1


def test_confirmed_zero_bridges_history_and_counts_as_a_reviewed_day():
    rows, _ = generate(
        [sale(5, "10"), sale(7, "6")], [classification(6, "confirmed_zero")]
    )
    assert Decimal(rows[0]["forecastDailyDemand"]) == Decimal("16") / 3


@pytest.mark.parametrize(
    "kind", ["business_closed", "full_stockout", "partial_stockout", "incomplete"]
)
def test_reviewed_exclusion_removes_sales_and_breaks_the_recent_sequence(kind):
    rows, _ = generate(
        [sale(5, "10"), sale(6, "40"), sale(7, "6")], [classification(6, kind)]
    )
    assert Decimal(rows[0]["forecastDailyDemand"]) == Decimal("6")


@pytest.mark.parametrize(
    "kind", ["business_closed", "full_stockout", "partial_stockout", "incomplete"]
)
def test_no_recent_usable_history_removes_obsolete_advice(kind):
    rows, conn = generate([sale(7, "6")], [classification(7, kind)])
    assert rows == []
    assert conn.deleted and conn.persisted == []


def test_empty_or_unclassified_latest_date_is_unavailable():
    for sales in ([], [sale(6, "4")]):
        rows, conn = generate(sales)
        assert rows == []
        assert conn.deleted and conn.persisted == []


def test_product_override_preserves_sales_despite_storewide_closure():
    rows, _ = generate([sale(7, "6")], [
        classification(7, "business_closed"),
        classification(7, "confirmed_zero", PRODUCT_ID),
        classification(7, "full_stockout", OTHER_PRODUCT_ID),
    ])
    assert Decimal(rows[0]["forecastDailyDemand"]) == Decimal("6")


def test_confirmed_zero_without_sales_is_available_zero_demand():
    rows, _ = generate([], [classification(7, "confirmed_zero", PRODUCT_ID)])
    assert len(rows) == 1
    assert Decimal(rows[0]["forecastDailyDemand"]) == 0


def test_reviewed_daily_average_preserves_database_decimal_precision():
    rows, _ = generate([sale(7, "9007199254740.993")])
    assert Decimal(rows[0]["forecastDailyDemand"]) == Decimal("9007199254740.993")
