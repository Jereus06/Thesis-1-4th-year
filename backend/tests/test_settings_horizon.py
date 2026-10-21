"""Future forecast limits agree; historical training dates remain unrestricted."""

import pytest
from pydantic import ValidationError

from app.schemas import ForecastRunCreate, SettingsUpdate
from test_postgres_integration import fresh_auth_limiter, pg_client  # noqa: F401
from test_sqlite_demo import client as sqlite_client, sign_in  # noqa: F401
from app import sqlite_demo


SETTINGS = {
    "movingAverageWindow": 7, "targetCoverDays": 7,
    "minimumHistoryWeeks": 8, "minimumNonzeroDays": 100,
    "topNProducts": 20, "cvFolds": 3, "timezone": "Asia/Manila",
}
PERIODS = {
    "trainingStart": "2023-01-01", "trainingEnd": "2025-12-31",
    "validationStart": "2026-01-01", "validationEnd": "2026-01-28",
    "finalTestStart": "2026-01-29", "finalTestEnd": "2026-02-27",
}


@pytest.mark.parametrize("days", [1, 30, 365])
def test_settings_and_forecast_accept_supported_horizons(days):
    assert SettingsUpdate.model_validate({**SETTINGS, "forecastHorizonDays": days}).forecast_horizon_days == days
    run = ForecastRunCreate.model_validate({**PERIODS, "forecastHorizonDays": days})
    assert run.forecast_horizon_days == days
    assert (run.training_end - run.training_start).days > 365


@pytest.mark.parametrize("days", [-1, 0, 366, 100_000])
@pytest.mark.parametrize("schema,payload", [(SettingsUpdate, SETTINGS), (ForecastRunCreate, PERIODS)])
def test_settings_and_forecast_reject_unsupported_horizons(schema, payload, days):
    with pytest.raises(ValidationError) as error:
        schema.model_validate({**payload, "forecastHorizonDays": days})
    assert error.value.errors()[0]["loc"] == ("forecastHorizonDays",)


@pytest.mark.parametrize("backend", ["sqlite", "postgres"])
@pytest.mark.parametrize("days", [1, 365, 0, -1, 366])
def test_settings_api_checks_horizon_before_saving(request, backend, days):
    if backend == "postgres":
        client, business, _dsn = request.getfixturevalue("pg_client")
    else:
        client = request.getfixturevalue("sqlite_client")
        client.headers.update(sign_in(client))
        business = sqlite_demo.DEMO_BUSINESS_ID
    path = f"/api/v1/businesses/{business}/settings"
    before = client.get(path).json()["data"]
    response = client.put(path, json={
        **before, "expectedVersion": before["version"],
        "forecastHorizonDays": days, "movingAverageWindow": 14,
    })
    after = client.get(path).json()["data"]
    if 1 <= days <= 365:
        assert response.status_code == 200, response.text
        assert after["forecastHorizonDays"] == days
        assert after["movingAverageWindow"] == 14
    else:
        assert response.status_code == 422, response.text
        assert any(item["loc"][-1] == "forecastHorizonDays" for item in response.json()["detail"])
        assert after == before
