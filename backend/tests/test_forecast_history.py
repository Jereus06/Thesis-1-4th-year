"""Usable reviewed history bounds through real authenticated PostgreSQL flows."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.data_quality import prepare_product_series, usable_history_bounds
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


BUSINESS_DAY = date(2026, 10, 5)
FROZEN_INSTANT = datetime(2026, 10, 4, 16, 30, tzinfo=UTC)


def freeze_clock(monkeypatch, instant=FROZEN_INSTANT):
    """Fix the business day without changing session or idempotency expiry clocks."""
    from app.repository import Repository

    def business_day(self, business_id):
        timezone = ZoneInfo(self.get_settings(business_id)["timezone"])
        return instant.astimezone(timezone).date()

    monkeypatch.setattr(Repository, "business_day", business_day)


def configure(client, base, **changes):
    response = client.get(base + "/settings")
    assert response.status_code == 200, response.text
    settings = {**response.json()["data"], **changes}
    response = client.put(base + "/settings", json=settings)
    assert response.status_code == 200, response.text
    return response.json()["data"]


@pytest.fixture()
def history_client(pg_client, monkeypatch):
    client, business, _dsn = pg_client
    freeze_clock(monkeypatch)
    base = f"/api/v1/businesses/{business}"
    configure(client, base, timezone="Asia/Manila", movingAverageWindow=7, forecastHorizonDays=7)
    return client, business, base


def import_sales(client, base, rows):
    response = client.post(base + "/data-imports", json={"source": "csv", "rows": rows})
    assert response.status_code == 201, response.text
    assert response.json()["data"]["acceptedRows"] == len(rows), response.text


def sales_rows(product, days, quantity="4"):
    return [{"sku": product["sku"], "saleDate": str(day), "quantity": quantity} for day in days]


def classify(client, base, day, classification="confirmed_zero", product_id=None):
    response = client.put(base + "/data-quality", json={
        "productId": product_id, "classificationDate": str(day),
        "classification": classification, "note": "Synthetic regression review",
    })
    assert response.status_code == 200, response.text


def get_dashboard(client, base):
    response = client.get(base + "/forecast-dashboard")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def refresh(client, base):
    response = client.post(base + "/forecast-refresh")
    assert response.status_code == 202, response.text
    return response.json()["data"]


def create_extra_product(client, base, sku):
    response = client.post(base + "/products", headers={"Idempotency-Key": f"history-{sku}"}, json={
        "sku": sku, "name": f"Synthetic {sku}", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    })
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_reviewed_zeros_extend_refresh_and_preview_and_remain_frozen(history_client):
    client, business, base = history_client
    product = create_product(client, business)
    sale_days = [BUSINESS_DAY - timedelta(days=offset) for offset in (4, 3, 2)]
    import_sales(client, base, sales_rows(product, sale_days))
    before = get_dashboard(client, base)
    assert before["asOf"] == str(sale_days[-1])
    assert before["forecastThrough"] == str(sale_days[-1] + timedelta(days=7))

    reviewed_days = [BUSINESS_DAY - timedelta(days=1), BUSINESS_DAY]
    for day in reviewed_days:
        classify(client, base, day)
    preview = get_dashboard(client, base)
    assert preview["businessDay"] == str(BUSINESS_DAY)
    assert preview["asOf"] == str(BUSINESS_DAY)
    assert preview["forecastThrough"] == str(BUSINESS_DAY + timedelta(days=7))
    assert preview["summaries"][product["id"]]["historyDays"] == 5
    assert preview["summaries"][product["id"]]["nonzeroDays"] == 3
    assert preview["summaries"][product["id"]]["unknownDays"] == 0
    assert preview["recommendations"][0]["demandAvailable"] is True
    assert preview["predictions"][0]["predictionDate"] == str(BUSINESS_DAY + timedelta(days=1))
    assert Decimal(preview["predictions"][0]["predictedQuantity"]) == Decimal("2.4")

    queued = refresh(client, base)
    assert queued["trainingStart"] == str(sale_days[0])
    assert queued["trainingEnd"] == str(sale_days[-1])
    assert queued["validationStart"] == queued["validationEnd"] == str(reviewed_days[0])
    assert queued["finalTestStart"] == queued["finalTestEnd"] == str(BUSINESS_DAY)
    snapshot = queued["dataSnapshot"]
    assert snapshot["firstUsableDate"] == str(sale_days[0])
    assert snapshot["lastUsableDate"] == snapshot["businessDayAtCapture"] == str(BUSINESS_DAY)
    assert snapshot["salesCount"] == 3
    assert snapshot["lastSaleDate"] == str(sale_days[-1])
    targets = snapshot["preparedProducts"][product["id"]]["targets"]
    assert targets[-2:] == [{"day": str(day), "quantity": 0.0, "provenance": "confirmed_zero"} for day in reviewed_days]
    assert len(snapshot["dailySales"]) == 3

    # A queued run consumes its reviewed inputs even after the live review changes.
    for day in reviewed_days:
        classify(client, base, day, "incomplete", product["id"])
    from app import worker

    assert worker.run_once()
    completed = client.get(base + f"/forecast-runs/{queued['id']}").json()["data"]
    assert completed["status"] == "completed", completed["failureMessage"]
    assert completed["dataSnapshot"] == snapshot
    assert completed["configuration"]["preparationSource"] == "frozen_prepared_snapshot"
    assert completed["configuration"]["products"][product["id"]]["excludedDays"] == 0
    predictions = client.get(base + f"/forecast-runs/{queued['id']}/predictions").json()["data"]
    test_point = next(point for point in predictions if point["datasetSplit"] == "final_test")
    assert test_point["predictionDate"] == str(BUSINESS_DAY)
    assert Decimal(test_point["actualQuantity"]) == 0
    future = [point for point in predictions if point["datasetSplit"] == "future"]
    assert [point["predictionDate"] for point in future] == [str(BUSINESS_DAY + timedelta(days=index)) for index in range(1, 8)]
    assert Decimal(future[0]["predictedQuantity"]) == Decimal("2.4")
    assert get_dashboard(client, base)["stale"] is True


def test_worker_refresh_preserves_each_products_expiry_and_latest_contiguous_history(history_client):
    client, business, base = history_client
    old = create_product(client, business)
    current = create_extra_product(client, base, "CURRENT")
    last_old = BUSINESS_DAY - timedelta(days=30)
    import_sales(client, base, [
        *sales_rows(old, [last_old - timedelta(days=2)], "100"),
        *sales_rows(old, [last_old], "4"),
        *sales_rows(current, [BUSINESS_DAY - timedelta(days=1), BUSINESS_DAY], "8"),
    ])
    queued = refresh(client, base)
    from app import worker

    assert worker.run_once()
    completed = client.get(base + f"/forecast-runs/{queued['id']}").json()["data"]
    assert completed["status"] == "completed", completed["failureMessage"]
    predictions = client.get(base + f"/forecast-runs/{queued['id']}/predictions").json()["data"]
    old_future = [point for point in predictions if point["productId"] == old["id"] and point["datasetSplit"] == "future"]
    assert [point["predictionDate"] for point in old_future] == [str(last_old + timedelta(days=index)) for index in range(1, 8)]
    assert all(Decimal(point["predictedQuantity"]) == 4 for point in old_future)
    assert completed["configuration"]["products"][old["id"]]["forecastOriginDate"] == str(last_old)
    result = get_dashboard(client, base)
    recommendations = {row["productId"]: row for row in result["recommendations"]}
    assert recommendations[old["id"]]["forecastExpired"] is True
    assert recommendations[old["id"]]["demandAvailable"] is False
    assert recommendations[current["id"]]["demandAvailable"] is True
    assert Decimal(recommendations[current["id"]]["daily_demand"]) == 8
    assert all(point["productId"] != old["id"] for point in result["predictions"])


def test_product_overrides_and_inactive_records_keep_product_preview_dates(history_client):
    client, business, base = history_client
    excluded = create_product(client, business)
    reviewed = create_extra_product(client, base, "REVIEWED")
    inactive = create_extra_product(client, base, "INACTIVE")
    sale_days = [BUSINESS_DAY - timedelta(days=offset) for offset in (4, 3, 2)]
    import_sales(client, base, sales_rows(excluded, sale_days) + sales_rows(reviewed, sale_days) + sales_rows(inactive, [BUSINESS_DAY - timedelta(days=30), BUSINESS_DAY + timedelta(days=20)], "99"))
    for day in [BUSINESS_DAY - timedelta(days=1), BUSINESS_DAY]:
        classify(client, base, day)
        classify(client, base, day, "incomplete", excluded["id"])
    classify(client, base, BUSINESS_DAY + timedelta(days=21), product_id=inactive["id"])
    response = client.patch(base + f"/products/{inactive['id']}", json={"isActive": False})
    assert response.status_code == 200, response.text

    preview = get_dashboard(client, base)
    assert preview["asOf"] == str(BUSINESS_DAY)
    assert set(preview["summaries"]) == {excluded["id"], reviewed["id"]}
    assert {item["productId"] for item in preview["recommendations"]} == {excluded["id"], reviewed["id"]}
    excluded_points = [point for point in preview["predictions"] if point["productId"] == excluded["id"]]
    reviewed_points = [point for point in preview["predictions"] if point["productId"] == reviewed["id"]]
    assert max(point["predictionDate"] for point in excluded_points) == str(sale_days[-1] + timedelta(days=7))
    assert max(point["predictionDate"] for point in reviewed_points) == str(BUSINESS_DAY + timedelta(days=7))
    assert all(Decimal(point["predictedQuantity"]) == 4 for point in excluded_points)
    assert Decimal(reviewed_points[0]["predictedQuantity"]) == Decimal("2.4")
    assert preview["summaries"][excluded["id"]]["excludedDays"] == 2

    queued = refresh(client, base)
    assert queued["trainingStart"] == str(sale_days[0])
    assert queued["finalTestEnd"] == str(BUSINESS_DAY)
    snapshot = queued["dataSnapshot"]
    assert set(snapshot["products"]) == set(snapshot["preparedProducts"]) == {excluded["id"], reviewed["id"]}
    assert len(snapshot["preparedProducts"][excluded["id"]]["targets"]) == 3
    assert snapshot["preparedProducts"][excluded["id"]]["excludedDates"] == [str(BUSINESS_DAY - timedelta(days=1)), str(BUSINESS_DAY)]


def test_unknown_and_excluded_trailing_days_do_not_redate_expired_history(history_client):
    client, business, base = history_client
    product = create_product(client, business)
    last_sale = BUSINESS_DAY - timedelta(days=15)
    sale_days = [last_sale - timedelta(days=offset) for offset in (2, 1, 0)]
    import_sales(client, base, sales_rows(product, sale_days))
    classify(client, base, BUSINESS_DAY, "business_closed")
    classify(client, base, BUSINESS_DAY + timedelta(days=1))
    preview = get_dashboard(client, base)
    assert preview["asOf"] == str(last_sale)
    assert preview["forecastThrough"] == str(last_sale + timedelta(days=7))
    assert preview["expired"] is True
    assert preview["predictions"] == []
    assert preview["recommendations"][0]["demandAvailable"] is False
    assert preview["recommendations"][0]["forecastExpired"] is True
    assert preview["summaries"][product["id"]]["unknownDays"] == 14
    assert preview["summaries"][product["id"]]["excludedDays"] == 1
    queued = refresh(client, base)
    assert queued["finalTestEnd"] == str(last_sale)
    assert queued["dataSnapshot"]["lastUsableDate"] == str(last_sale)
    assert queued["dataSnapshot"]["preparedProducts"][product["id"]]["targets"] == [{"day": str(day), "quantity": 4.0, "provenance": "recorded_sales"} for day in sale_days]


def test_excluded_terminal_sale_is_not_a_cutoff_or_baseline_target(history_client):
    client, business, base = history_client
    product = create_product(client, business)
    sale_days = [BUSINESS_DAY - timedelta(days=offset) for offset in (4, 3, 2)]
    excluded_day = BUSINESS_DAY - timedelta(days=1)
    import_sales(client, base, sales_rows(product, sale_days) + sales_rows(product, [excluded_day], "100"))
    classify(client, base, excluded_day, "partial_stockout")
    preview = get_dashboard(client, base)
    assert preview["asOf"] == str(sale_days[-1])
    assert preview["summaries"][product["id"]]["excludedDays"] == 1
    assert preview["summaries"][product["id"]]["unknownDays"] == 1
    assert preview["predictions"]
    assert all(Decimal(point["predictedQuantity"]) == 4 for point in preview["predictions"])
    queued = refresh(client, base)
    assert queued["finalTestEnd"] == str(sale_days[-1])
    assert queued["dataSnapshot"]["preparedProducts"][product["id"]]["targets"] == [{"day": str(day), "quantity": 4.0, "provenance": "recorded_sales"} for day in sale_days]


@pytest.mark.parametrize("timezone, expected_day", [("Asia/Manila", BUSINESS_DAY), ("America/Los_Angeles", BUSINESS_DAY - timedelta(days=1))])
def test_reviewed_cutoff_respects_actual_business_timezone(history_client, timezone, expected_day):
    client, business, base = history_client
    configure(client, base, timezone=timezone)
    product = create_product(client, business)
    sale_days = [BUSINESS_DAY - timedelta(days=offset) for offset in (4, 3, 2)]
    import_sales(client, base, sales_rows(product, sale_days))
    for day in [BUSINESS_DAY - timedelta(days=1), BUSINESS_DAY, BUSINESS_DAY + timedelta(days=1)]:
        classify(client, base, day)
    preview = get_dashboard(client, base)
    assert preview["businessDay"] == preview["asOf"] == str(expected_day)
    assert preview["businessTimezone"] == timezone
    queued = refresh(client, base)
    assert queued["finalTestEnd"] == str(expected_day)
    snapshot = queued["dataSnapshot"]
    assert snapshot["businessDayAtCapture"] == snapshot["lastUsableDate"] == str(expected_day)
    assert all(item["day"] <= str(expected_day) for item in snapshot["preparedProducts"][product["id"]]["targets"])
    assert all(item["date"] <= str(expected_day) for item in snapshot["dataQuality"])


def test_reviewed_zero_only_history_can_refresh_without_inventing_sales(history_client):
    client, business, base = history_client
    product = create_product(client, business)
    for offset in range(4, -1, -1):
        classify(client, base, BUSINESS_DAY - timedelta(days=offset), product_id=product["id"])
    preview = get_dashboard(client, base)
    assert preview["asOf"] == str(BUSINESS_DAY)
    assert preview["recommendations"][0]["demandAvailable"] is True
    assert all(Decimal(point["predictedQuantity"]) == 0 for point in preview["predictions"])
    queued = refresh(client, base)
    snapshot = queued["dataSnapshot"]
    assert snapshot["salesCount"] == 0 and snapshot["dailySales"] == []
    assert snapshot["firstSaleDate"] is snapshot["lastSaleDate"] is None
    assert len(snapshot["preparedProducts"][product["id"]]["targets"]) == 5
    assert all(item["provenance"] == "confirmed_zero" and item["quantity"] == 0 for item in snapshot["preparedProducts"][product["id"]]["targets"])


def test_active_future_sales_keep_refresh_validation(history_client):
    client, business, base = history_client
    product = create_product(client, business)
    import_sales(client, base, sales_rows(product, [BUSINESS_DAY - timedelta(days=4), BUSINESS_DAY - timedelta(days=2), BUSINESS_DAY + timedelta(days=1)]))
    response = client.post(base + "/forecast-refresh")
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == "Forecast history cannot include future-dated sales"


@pytest.mark.parametrize("excluded", ["business_closed", "full_stockout", "partial_stockout", "incomplete"])
def test_usable_bounds_apply_overrides_to_recorded_and_reviewed_targets(excluded):
    first = BUSINESS_DAY - timedelta(days=3)
    excluded_sale = first + timedelta(days=1)
    excluded_zero = first + timedelta(days=2)
    sales = [
        {"product_id": "active", "sale_date": first, "quantity": Decimal("4")},
        {"product_id": "active", "sale_date": excluded_sale, "quantity": Decimal("99")},
        {"product_id": "inactive", "sale_date": first - timedelta(days=30), "quantity": Decimal("99")},
        {"product_id": "active", "sale_date": BUSINESS_DAY + timedelta(days=1), "quantity": Decimal("99")},
    ]
    quality = [
        {"productId": "active", "date": str(excluded_sale), "classification": excluded},
        {"productId": None, "date": str(excluded_zero), "classification": "confirmed_zero"},
        {"productId": "active", "date": str(excluded_zero), "classification": excluded},
        {"productId": None, "date": str(BUSINESS_DAY), "classification": excluded},
        {"productId": "active", "date": str(BUSINESS_DAY), "classification": "confirmed_zero"},
        {"productId": None, "date": str(BUSINESS_DAY + timedelta(days=2)), "classification": "confirmed_zero"},
    ]
    assert usable_history_bounds(sales, quality, ["active"], BUSINESS_DAY) == (first, BUSINESS_DAY)
    prepared = prepare_product_series([row for row in sales if row["product_id"] == "active"], quality, "active", first, BUSINESS_DAY)
    assert [(item.day, item.quantity) for item in prepared.targets] == [(first, 4.0), (BUSINESS_DAY, 0.0)]
    assert prepared.excluded_dates == [excluded_sale, excluded_zero]
    assert usable_history_bounds(sales, quality, [], BUSINESS_DAY) == (None, None)
