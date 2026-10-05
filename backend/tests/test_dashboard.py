"""Current forecast expiry checks without a PostgreSQL connection."""

from datetime import date
from decimal import Decimal

import pytest

from app.dashboard import dashboard
from app.data_quality import FALLBACK_POLICY_VERSION

PRODUCT_ID = "product-1"


def prediction(day, quantity, split="future"):
    return {
        "productId": PRODUCT_ID,
        "predictionDate": day,
        "method": "fallback" if split == "future" else "moving_average",
        "datasetSplit": split,
        "predictedQuantity": str(quantity),
        "actualQuantity": None if split == "future" else "4",
        "lowerBound": None,
        "upperBound": None,
        "fallbackReason": "Insufficient history for XGBoost",
    }


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


class FakeConnection:
    def __init__(self, repository):
        self.repository = repository

    def execute(self, query, _parameters=()):
        repository = self.repository
        if "AS changed" in query:
            return FakeResult([{"changed": repository.changed}])
        if "FROM forecast_runs" in query:
            return FakeResult([repository.completed] if repository.completed else [])
        if "FROM forecast_predictions" in query:
            return FakeResult(repository.predictions)
        if "FROM sales_day_quality" in query:
            return FakeResult(repository.quality)
        if "FROM sales" in query:
            return FakeResult(repository.sales)
        raise AssertionError(f"Unexpected dashboard query: {query}")


class FakeRepository:
    def __init__(
        self, *, today=date(2026, 10, 2), final_test_end=date(2026, 10, 1),
        horizon=2, completed=True, predictions=None, sales=None, latest_status=None,
    ):
        self.today = today
        self.business_day_calls = 0
        self.changed = False
        self.settings = {
            "movingAverageWindow": 3, "forecastHorizonDays": horizon,
            "targetCoverDays": 7, "timezone": "Asia/Manila",
        }
        self.products = [{
            "id": PRODUCT_ID, "isActive": True, "currentStock": "20",
            "leadTimeDays": 2, "safetyStock": "2",
        }]
        self.sales = ([{
            "product_id": PRODUCT_ID, "sale_date": date(2026, 10, 1), "quantity": Decimal("6"),
        }] if sales is None else sales)
        self.quality = []
        self.predictions = (
            [prediction("2026-10-02", 8), prediction("2026-10-03", 6)]
            if predictions is None else predictions
        )
        self.metrics = [{
            "productId": PRODUCT_ID, "method": "moving_average", "datasetSplit": "final_test",
            "mae": "1", "rmse": "1", "observationCount": 1,
        }]
        self.completed = ({
            "id": "completed-run",
            "final_test_end": final_test_end,
            "forecast_horizon_days": horizon,
            "created_at": "2026-10-01T12:00:00Z",
            "configuration": {"fallbackPolicy": FALLBACK_POLICY_VERSION, "products": {PRODUCT_ID: {
                "historyDays": 1, "nonzeroDays": 1, "eligible": False,
                "operatingMethod": "fallback",
                "fallbackReason": "Insufficient history for XGBoost",
            }}},
            "data_snapshot": {
                "capturedAt": "2026-10-01T12:00:00Z", "products": [PRODUCT_ID],
            },
        } if completed else None)
        self.latest = ([{
            "id": "newer-run", "status": latest_status,
            "failureMessage": "Refresh failed" if latest_status == "failed" else None,
        }] if latest_status else [self._forecast_run(self.completed)] if self.completed else [])
        self.conn = FakeConnection(self)

    def get_settings(self, _business_id):
        return dict(self.settings)

    def business_day(self, _business_id):
        self.business_day_calls += 1
        return self.today

    def list_forecast_runs(self, _business_id, _limit, _offset):
        return list(self.latest)

    def list_products(self, _business_id):
        return [dict(product) for product in self.products]

    def list_metrics(self, _business_id, _run_id):
        return [dict(metric) for metric in self.metrics]

    @staticmethod
    def _prediction(row):
        return dict(row)

    @staticmethod
    def _forecast_run(row):
        return {
            "id": row["id"], "status": "completed", "createdAt": row["created_at"],
            "finalTestEnd": str(row["final_test_end"]),
            "forecastHorizonDays": row["forecast_horizon_days"],
            "configuration": row["configuration"],
        }


def assert_unavailable(recommendation):
    assert recommendation["demandAvailable"] is False
    assert recommendation["unavailableReason"]
    for field in (
        "daily_demand", "demand_during_lead_time", "reorder_point",
        "target_stock", "days_of_cover",
    ):
        assert recommendation[field] is None
    assert recommendation["suggested_quantity"] == "0"


def test_legacy_baseline_cannot_make_old_product_forecasts_current():
    repository = FakeRepository(
        predictions=[prediction("2026-10-02", 99), prediction("2026-10-03", 99)],
        sales=[{"product_id": PRODUCT_ID, "sale_date": date(2026, 9, 1), "quantity": Decimal("4")}],
    )
    repository.completed["configuration"].pop("fallbackPolicy")
    result = dashboard(repository, "business")
    assert result["stale"] is True
    assert result["metrics"] == result["predictions"] == []
    assert_unavailable(result["recommendations"][0])
    assert result["recommendations"][0]["forecastExpired"] is True
    assert "older calendar policy" in result["summaries"][PRODUCT_ID]["fallbackReason"]
    # Read-time invalidation does not modify the original saved evidence.
    assert len(repository.predictions) == 2
    assert repository.completed["configuration"]["products"][PRODUCT_ID]["historyDays"] == 1


def test_legacy_baseline_preview_uses_only_contiguous_latest_history():
    repository = FakeRepository(sales=[
        {"product_id": PRODUCT_ID, "sale_date": date(2026, 9, 29), "quantity": Decimal("100")},
        {"product_id": PRODUCT_ID, "sale_date": date(2026, 10, 1), "quantity": Decimal("4")},
    ])
    repository.completed["configuration"].pop("fallbackPolicy")
    result = dashboard(repository, "business")
    assert result["stale"] is True
    assert result["metrics"] == []
    assert [Decimal(point["predictedQuantity"]) for point in result["predictions"]] == [Decimal("4"), Decimal("4")]
    assert Decimal(result["recommendations"][0]["daily_demand"]) == Decimal("4")


@pytest.mark.parametrize(
    ("today", "expired"), [(date(2026, 10, 3), False), (date(2026, 10, 4), True)]
)
def test_forecast_is_valid_through_its_last_business_date(today, expired):
    repository = FakeRepository(today=today)
    result = dashboard(repository, "business")
    recommendation = result["recommendations"][0]
    assert result["businessDay"] == str(today)
    assert result["businessTimezone"] == "Asia/Manila"
    assert result["forecastThrough"] == "2026-10-03"
    assert result["expired"] is expired
    assert recommendation["forecastExpired"] is expired
    assert repository.business_day_calls == 1
    if expired:
        assert_unavailable(recommendation)
        assert result["predictions"] == []
    else:
        assert recommendation["demandAvailable"] is True
        assert Decimal(recommendation["daily_demand"]) == Decimal("6")
        assert [point["predictionDate"] for point in result["predictions"]] == ["2026-10-03"]


def test_elapsed_prediction_dates_are_excluded_from_current_demand():
    repository = FakeRepository(
        final_test_end=date(2026, 9, 30), horizon=3,
        predictions=[
            prediction("2026-10-01", 100), prediction("2026-10-02", 4),
            prediction("2026-10-03", 6),
        ],
    )
    result = dashboard(repository, "business")
    assert result["expired"] is False
    assert Decimal(result["recommendations"][0]["daily_demand"]) == Decimal("5")
    assert [point["predictionDate"] for point in result["predictions"]] == [
        "2026-10-02", "2026-10-03",
    ]


def test_old_history_baseline_expires_without_being_shifted_to_today():
    repository = FakeRepository(
        completed=False, predictions=[],
        sales=[{"product_id": PRODUCT_ID, "sale_date": date(2026, 9, 20),
                "quantity": Decimal("6")}],
    )
    result = dashboard(repository, "business")
    assert result["run"] is None
    assert result["forecastThrough"] == "2026-09-22"
    assert result["expired"] is True
    assert result["predictions"] == []
    assert result["recommendations"][0]["forecastExpired"] is True
    assert_unavailable(result["recommendations"][0])


def test_expired_saved_predictions_are_not_rebased_using_new_sales():
    repository = FakeRepository(
        final_test_end=date(2026, 9, 20),
        predictions=[prediction("2026-09-21", 8), prediction("2026-09-22", 6)],
        sales=[{"product_id": PRODUCT_ID, "sale_date": date(2026, 10, 2),
                "quantity": Decimal("50")}],
    )
    repository.changed = True
    result = dashboard(repository, "business")
    assert result["stale"] is True
    assert result["expired"] is True
    assert result["forecastThrough"] == "2026-09-22"
    assert result["predictions"] == []
    assert result["recommendations"][0]["forecastExpired"] is True
    assert_unavailable(result["recommendations"][0])


def test_expiration_preserves_final_test_predictions_and_metrics():
    holdout = prediction("2026-10-01", 3, "final_test")
    repository = FakeRepository(
        today=date(2026, 10, 4),
        predictions=[holdout, prediction("2026-10-02", 8), prediction("2026-10-03", 6)],
    )
    original_predictions = [dict(point) for point in repository.predictions]
    result = dashboard(repository, "business")
    assert result["expired"] is True
    assert result["predictions"] == [holdout]
    assert result["metrics"] == repository.metrics
    assert repository.predictions == original_predictions
    assert_unavailable(result["recommendations"][0])


@pytest.mark.parametrize("latest_status", ["queued", "running", "failed"])
def test_refresh_status_does_not_hide_completed_forecast_expiration(latest_status):
    repository = FakeRepository(today=date(2026, 10, 4), latest_status=latest_status)
    result = dashboard(repository, "business")
    assert result["latestRun"]["status"] == latest_status
    assert result["run"]["id"] == "completed-run"
    assert result["expired"] is True
    assert result["recommendations"][0]["forecastExpired"] is True
    assert_unavailable(result["recommendations"][0])


def test_no_usable_history_is_unavailable_without_inventing_an_expired_forecast():
    repository = FakeRepository(completed=False, predictions=[], sales=[])
    result = dashboard(repository, "business")
    assert result["forecastThrough"] is None
    assert result["expired"] is False
    assert result["predictions"] == []
    assert result["recommendations"][0]["forecastExpired"] is False
    assert_unavailable(result["recommendations"][0])
