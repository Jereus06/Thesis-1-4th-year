"""Normal Refresh persists calibrated intervals from the official Python worker."""

import json
from datetime import date, timedelta
from decimal import Decimal
from math import isfinite

import pytest

from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


BUSINESS_DAY = date(2026, 10, 5)
METHODS = {"moving_average", "xgboost", "ensemble"}


@pytest.fixture()
def refresh_client(pg_client, monkeypatch):
    from app.repository import Repository

    client, business, _dsn = pg_client
    # Fix time without replacing Refresh's split selection or the real trainer.
    monkeypatch.setattr(Repository, "business_day", lambda *_: BUSINESS_DAY)
    base = f"/api/v1/businesses/{business}"
    response = client.get(base + "/settings")
    assert response.status_code == 200, response.text
    settings = response.json()["data"]
    assert settings["minimumNonzeroDays"] == 100
    assert settings["minimumHistoryWeeks"] == 8
    assert settings["cvFolds"] == 3
    return client, business, base, settings


def seed_daily_history(client, business, base, count):
    product = create_product(client, business)
    start = BUSINESS_DAY - timedelta(days=count - 1)
    response = client.post(base + "/data-imports", json={
        "source": "csv",
        "rows": [
            {"sku": product["sku"], "saleDate": str(start + timedelta(days=index)),
             "quantity": str(12 + index % 7 + (index // 28) % 3)}
            for index in range(count)
        ],
    })
    assert response.status_code == 201, response.text
    assert response.json()["data"]["acceptedRows"] == count
    return product, start


def normal_refresh_and_process(client, base):
    response = client.post(base + "/forecast-refresh")
    assert response.status_code == 202, response.text
    queued = response.json()["data"]
    from app import worker

    assert worker.run_once()
    response = client.get(base + f"/forecast-runs/{queued['id']}")
    assert response.status_code == 200, response.text
    completed = response.json()["data"]
    assert completed["status"] == "completed", completed["failureMessage"]
    assert completed["algorithmName"] == "xgboost.XGBRegressor"
    assert completed["algorithmVersion"]
    assert completed["xgboostVerified"] is False
    assert completed["configuration"]["runtime"] == "xgboost.XGBRegressor"
    predictions = client.get(base + f"/forecast-runs/{queued['id']}/predictions?limit=1000")
    metrics = client.get(base + f"/forecast-runs/{queued['id']}/metrics")
    assert predictions.status_code == metrics.status_code == 200
    return queued, completed, predictions.json()["data"], metrics.json()["data"]


def assert_splits(queued, count, validation_days):
    final_test_days = 14
    training_days = count - validation_days - final_test_days
    training_start = date.fromisoformat(queued["trainingStart"])
    training_end = date.fromisoformat(queued["trainingEnd"])
    validation_start = date.fromisoformat(queued["validationStart"])
    validation_end = date.fromisoformat(queued["validationEnd"])
    final_start = date.fromisoformat(queued["finalTestStart"])
    assert (training_end - training_start).days + 1 == training_days
    assert validation_start == training_end + timedelta(days=1)
    assert (validation_end - validation_start).days + 1 == validation_days
    assert final_start == validation_end + timedelta(days=1)
    assert (BUSINESS_DAY - final_start).days + 1 == final_test_days
    assert queued["finalTestEnd"] == str(BUSINESS_DAY)
    planned = queued["configuration"]["refreshSplit"]
    assert planned["policy"]
    assert planned["trainingCalendarDays"] == training_days
    assert planned["validationCalendarDays"] == validation_days
    assert planned["finalTestCalendarDays"] == final_test_days
    assert planned["trainingReserveCalendarDays"] == 100
    return training_days, validation_start, validation_end


def assert_metrics_use_separate_observations(metrics, selection_days):
    selection = [metric for metric in metrics if metric["datasetSplit"] == "validation"]
    final_test = [metric for metric in metrics if metric["datasetSplit"] == "final_test"]
    assert {metric["method"] for metric in selection} == METHODS
    assert {metric["method"] for metric in final_test} == METHODS
    assert all(metric["observationCount"] == selection_days for metric in selection)
    assert all(metric["observationCount"] == 14 for metric in final_test)


@pytest.mark.parametrize("count, validation_days", [(134, 20), (180, 28)])
def test_normal_refresh_saves_real_calibrated_bounds_and_three_training_folds(
    refresh_client, tmp_path, count, validation_days
):
    client, business, base, settings = refresh_client
    product, start = seed_daily_history(client, business, base, count)
    queued, completed, predictions, metrics = normal_refresh_and_process(client, base)
    assert queued["trainingStart"] == str(start)
    training_days, validation_start, validation_end = assert_splits(queued, count, validation_days)
    summary = completed["configuration"]["products"][product["id"]]
    assert summary["eligible"] is True
    assert summary["historyDays"] == summary["nonzeroDays"] == training_days
    assert summary["requestedFolds"] == summary["effectiveFolds"] == 3
    assert summary["selectionFallback"] is None
    assert summary["earlyStoppingUsed"] is True
    assert isinstance(summary["bestIteration"], int)
    interval = summary["interval"]
    assert interval["available"] is True
    assert interval.get("unavailableReason") is None
    assert interval["calibrationSplit"] == "late_validation_reserved_after_selection"
    assert interval["calibrationObservations"] == 10
    selection_days = validation_days - 10
    assert interval["selectionObservations"] == selection_days
    assert interval["selectionObservations"] + interval["calibrationObservations"] == validation_days
    assert interval["calibrationStart"] == str(validation_start + timedelta(days=selection_days))
    assert interval["calibrationEnd"] == str(validation_end)
    assert interval["calibrationEnd"] < queued["finalTestStart"]
    assert isfinite(interval["lowerResidual"]) and isfinite(interval["upperResidual"])
    assert interval["lowerResidual"] <= interval["upperResidual"]
    assert 0 <= interval["finalTestCoverage"] <= 1
    assert interval["finalTestCoverage"] * 14 == pytest.approx(round(interval["finalTestCoverage"] * 14))
    planned = queued["configuration"]["refreshSplit"]
    assert planned["validationSelectionCalendarDays"] == selection_days
    assert planned["validationCalibrationCalendarDays"] == 10
    assert_metrics_use_separate_observations(metrics, selection_days)

    final_test = [point for point in predictions if point["datasetSplit"] == "final_test"]
    expected_test_dates = {str(BUSINESS_DAY - timedelta(days=offset)) for offset in range(14)}
    assert len(final_test) == 14 * len(METHODS)
    for method in METHODS:
        method_test = [point for point in final_test if point["method"] == method]
        assert {point["predictionDate"] for point in method_test} == expected_test_dates
        assert all(point["actualQuantity"] is not None for point in method_test)
    operating = "moving_average" if summary["operatingMethod"] == "movingAverage" else summary["operatingMethod"]
    future = [point for point in predictions if point["datasetSplit"] == "future"]
    horizon = settings["forecastHorizonDays"]
    selected_future = [point for point in future if point["method"] == operating]
    assert len(selected_future) == horizon
    assert {point["predictionDate"] for point in selected_future} == {str(BUSINESS_DAY + timedelta(days=offset)) for offset in range(1, horizon + 1)}
    for point in selected_future:
        predicted = float(point["predictedQuantity"])
        lower, upper = float(point["lowerBound"]), float(point["upperBound"])
        assert 0 <= lower <= upper
        # PostgreSQL stores predictions/bounds to three decimal places.
        assert lower == pytest.approx(max(0, predicted + interval["lowerResidual"]), abs=0.002)
        assert upper == pytest.approx(max(0, predicted + interval["upperResidual"]), abs=0.002)
    assert all(point["lowerBound"] is point["upperBound"] is None for point in future if point["method"] != operating)

    # Coverage's untouched test denominator must agree with the saved observations,
    # allowing only the rounding uncertainty at an exact interval boundary.
    selected_test = [point for point in final_test if point["method"] == operating]
    definitely_covered = possibly_covered = 0
    for point in selected_test:
        actual, predicted = float(point["actualQuantity"]), float(point["predictedQuantity"])
        lower = max(0, predicted + interval["lowerResidual"])
        upper = max(0, predicted + interval["upperResidual"])
        definitely_covered += lower + 0.002 < actual < upper - 0.002
        possibly_covered += lower - 0.002 <= actual <= upper + 0.002
    assert definitely_covered / 14 <= interval["finalTestCoverage"] <= possibly_covered / 14

    artifact = tmp_path / "models" / summary["artifact"]
    model = json.loads(artifact.read_text(encoding="utf8"))
    assert model["learner"]["objective"]["name"] == "reg:squarederror"
    dashboard = client.get(base + "/forecast-dashboard").json()["data"]
    assert dashboard["summaries"][product["id"]]["interval"] == interval
    assert dashboard["recommendations"][0]["demandAvailable"] is True
    assert dashboard["expired"] is False


def test_short_but_xgboost_eligible_normal_refresh_reports_unavailable_intervals(refresh_client):
    client, business, base, settings = refresh_client
    product, _start = seed_daily_history(client, business, base, 128)
    queued, completed, predictions, metrics = normal_refresh_and_process(client, base)
    assert_splits(queued, 128, 14)
    summary = completed["configuration"]["products"][product["id"]]
    assert summary["eligible"] is True
    assert summary["historyDays"] == summary["nonzeroDays"] == 100
    assert summary["requestedFolds"] == summary["effectiveFolds"] == 3
    interval = summary["interval"]
    assert interval["available"] is False
    assert interval["unavailableReason"]
    assert interval["selectionObservations"] == 14
    assert interval["calibrationObservations"] == 0
    for field in ("calibrationStart", "calibrationEnd", "lowerResidual", "upperResidual", "finalTestCoverage"):
        assert interval[field] is None
    planned = queued["configuration"]["refreshSplit"]
    assert planned["validationSelectionCalendarDays"] == 14
    assert planned["validationCalibrationCalendarDays"] == 0
    assert_metrics_use_separate_observations(metrics, 14)
    future = [point for point in predictions if point["datasetSplit"] == "future"]
    assert len(future) == settings["forecastHorizonDays"] * len(METHODS)
    assert all(point["lowerBound"] is point["upperBound"] is None for point in future)
    dashboard = client.get(base + "/forecast-dashboard").json()["data"]
    assert dashboard["summaries"][product["id"]]["interval"] == interval
