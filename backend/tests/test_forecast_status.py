"""Polling observes persisted changes without preparing forecast history."""

from copy import deepcopy
from datetime import date, timedelta
from uuid import uuid4

import psycopg
import pytest

from app.dashboard import dashboard_status
from test_postgres_integration import create_product, pg_client  # noqa: F401


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class StatusRepository:
    def __init__(self):
        self.conn = self
        self.today = date(2026, 10, 15)
        self.state = {
            "sales": [{"count": 10, "latest": "2026-10-15T00:00:00Z", "identities": 123}],
            "products": [{"id": "p1", "updated_at": "2026-10-15T00:00:00Z"}],
            "settings": [{"updated_at": "2026-10-15T00:00:00Z"}],
            "business": [{
                "name": "Synthetic store", "location": None, "data_origin": "demo",
                "updated_at": "2026-10-15T00:00:00Z",
            }],
            "quality": [{"count": 0, "latest": None}],
            "latest": [{"id": "run1", "status": "queued"}],
            "completed": [],
        }
        self.queries = []

    def business_day(self, _business_id):
        return self.today

    def execute(self, query, parameters):
        self.queries.append(query)
        assert parameters == ("business",)
        if "FROM sales WHERE" in query:
            return Result(self.state["sales"])
        if "FROM products" in query:
            return Result(self.state["products"])
        if "FROM business_settings" in query:
            return Result(self.state["settings"])
        if "FROM businesses" in query:
            return Result(self.state["business"])
        if "FROM sales_day_quality_audit" in query:
            return Result(self.state["quality"])
        if "FROM forecast_runs" in query:
            return Result(self.state["completed" if "status='completed'" in query else "latest"])
        raise AssertionError(query)


def test_status_is_stable_and_never_reads_or_prepares_daily_history(monkeypatch):
    repository = StatusRepository()

    def unexpected(*_args, **_kwargs):
        raise AssertionError("Polling must not prepare history")

    monkeypatch.setattr("app.dashboard.prepare_product_series", unexpected)
    before = dashboard_status(repository, "business")
    assert dashboard_status(repository, "business") == before
    assert len(before["revision"]) == 64
    assert all("sale_date" not in query and "forecast_predictions" not in query
               and "data_snapshot" not in query for query in repository.queries)


@pytest.mark.parametrize(
    "field", ["sales", "products", "settings", "business", "quality", "latest", "completed"],
)
def test_each_saved_revision_input_invalidates_the_dashboard(field):
    repository = StatusRepository()
    before = dashboard_status(repository, "business")
    repository.state[field] = deepcopy(repository.state[field]) + [{"changed": field}]
    # Scalar aggregates return a single row; mutate that row for scalar sources.
    if field in {"sales", "settings", "business", "quality", "latest", "completed"}:
        repository.state[field] = [{"changed": field}]
    assert dashboard_status(repository, "business") != before


def test_profile_value_change_invalidates_status_even_with_same_timestamp():
    repository = StatusRepository()
    before = dashboard_status(repository, "business")
    repository.state["business"][0]["name"] = "Renamed synthetic store"
    assert dashboard_status(repository, "business") != before


def test_status_tracks_business_midnight_and_schedule_settings():
    repository = StatusRepository()
    schedule = {"enabled": True, "localTime": "00:15"}
    before = dashboard_status(repository, "business", forecast_schedule=schedule)
    repository.today = date(2026, 10, 16)
    assert dashboard_status(repository, "business", forecast_schedule=schedule) != before
    repository.today = date(2026, 10, 15)
    assert dashboard_status(repository, "business", forecast_schedule={**schedule, "enabled": False}) != before


def test_same_count_and_latest_timestamp_still_detect_replaced_sales():
    repository = StatusRepository()
    before = dashboard_status(repository, "business")
    repository.state["sales"][0]["identities"] = 456
    assert dashboard_status(repository, "business") != before


def test_status_route_tracks_stock_import_deletion_quality_and_worker_changes(pg_client):
    client, business, dsn = pg_client
    base = f"/api/v1/businesses/{business}"

    def revision():
        response = client.get(base + "/forecast-status")
        assert response.status_code == 200, response.text
        assert set(response.json()["data"]) == {"revision"}
        return response.json()["data"]["revision"]

    previous = revision()

    def changed():
        nonlocal previous
        current = revision()
        assert current != previous
        assert revision() == current
        previous = current

    product = create_product(client, business)
    changed()
    today = client.get(base + "/forecast-dashboard").json()["data"]["businessDay"]
    response = client.post(base + "/sales", json={
        "productId": product["id"], "saleDate": today, "quantity": "2",
    })
    assert response.status_code == 201, response.text
    sale = response.json()["data"]
    changed()
    response = client.post(base + "/inventory-movements", json={
        "productId": product["id"], "movementDate": today,
        "movementType": "receipt", "quantityDelta": "1",
    })
    assert response.status_code == 201, response.text
    changed()
    settings = client.get(base + "/settings").json()["data"]
    response = client.put(base + "/settings", json={**settings, "movingAverageWindow": 14})
    assert response.status_code == 200, response.text
    changed()
    response = client.put(base + "/data-quality", json={
        "productId": product["id"], "classificationDate": today,
        "classification": "confirmed_zero", "note": "Synthetic polling regression",
    })
    assert response.status_code == 200, response.text
    changed()
    response = client.request("DELETE", base + "/data-quality", json={
        "productId": product["id"], "classificationDate": today,
    })
    assert response.status_code == 200, response.text
    changed()
    response = client.post(base + "/data-imports", json={"source": "csv", "rows": [{
        "sku": product["sku"], "saleDate": today, "quantity": "3",
    }]})
    assert response.status_code == 201, response.text
    changed()
    response = client.delete(base + "/sales/imported")
    assert response.status_code == 200, response.text
    changed()
    response = client.put(base + "/data-quality", json={
        "productId": product["id"],
        "classificationDate": str(date.fromisoformat(today) - timedelta(days=2)),
        "classification": "confirmed_zero", "note": "Synthetic three-day run history",
    })
    assert response.status_code == 200, response.text
    changed()
    response = client.post(base + "/forecast-refresh")
    assert response.status_code == 202, response.text
    run_id = response.json()["data"]["id"]
    changed()
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE forecast_runs SET status='running',started_at=now() WHERE id=%s", (run_id,))
    changed()
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE forecast_runs SET status='completed',completed_at=now() WHERE id=%s", (run_id,))
    changed()
    response = client.delete(base + f"/sales/{sale['id']}")
    assert response.status_code == 200, response.text
    changed()
    assert client.get(f"/api/v1/businesses/{uuid4()}/forecast-status").status_code == 403
    client.cookies.clear()
    assert client.get(base + "/forecast-status").status_code == 401
