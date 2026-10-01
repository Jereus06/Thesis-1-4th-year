"""Real PostgreSQL checks in a temporary schema in an explicit test database."""

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg_pool import ConnectionPool


@pytest.fixture()
def pg_client(monkeypatch, tmp_path):
    database = os.getenv("STOCKCAST_TEST_DATABASE_URL")
    if not database:
        pytest.skip("Set STOCKCAST_TEST_DATABASE_URL to an isolated PostgreSQL test database")
    schema = f"test_{uuid4().hex}"
    with psycopg.connect(database, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    url = urlsplit(database)
    query = dict(parse_qsl(url.query))
    query["options"] = f"-csearch_path={schema}"
    dsn = urlunsplit(url._replace(query=urlencode(query)))
    monkeypatch.setenv("DATABASE_URL", dsn)
    monkeypatch.setenv("OWNER_PASSWORD", "test-owner-password")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("ARTIFACT_DIR", str(tmp_path / "models"))
    from app.config import get_settings

    get_settings.cache_clear()
    from app import db
    from app.bootstrap_owner import bootstrap
    from app.migrate import migrate

    migrate()
    business = bootstrap()
    monkeypatch.setattr(
        db, "pool", ConnectionPool(dsn, open=False, kwargs={"row_factory": psycopg.rows.dict_row})
    )
    from app.main import app

    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/auth/sign-in",
                json={
                    "businessId": business,
                    "email": "owner@example.com",
                    "password": "test-owner-password",
                },
            )
            assert response.status_code == 200, response.text
            client.headers["X-CSRF-Token"] = client.cookies["stockcast_csrf"]
            yield client, business, dsn
    finally:
        get_settings.cache_clear()
        with psycopg.connect(database, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def create_product(client, business, stock="20"):
    response = client.post(
        f"/api/v1/businesses/{business}/products",
        headers={"Idempotency-Key": "product-1"},
        json={
            "sku": "TEST-1",
            "name": "Test Product",
            "category": "Test",
            "unit": "pc",
            "currentStock": stock,
            "leadTimeDays": 2,
            "safetyStock": "2",
            "unitCost": "10",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_postgres_writes_idempotency_import_export_and_owner_restart(pg_client):
    client, business, dsn = pg_client
    product = create_product(client, business)
    assert create_product(client, business)["id"] == product["id"]
    base = f"/api/v1/businesses/{business}"
    sale = {"productId": product["id"], "saleDate": "2026-09-30", "quantity": "2"}
    for _ in range(2):
        assert (
            client.post(
                base + "/sales", json=sale, headers={"Idempotency-Key": "sale-1"}
            ).status_code
            == 201
        )
    assert len(client.get(base + "/sales").json()["data"]) == 1
    changed = client.patch(base + f"/products/{product['id']}", json={"currentStock": "25"})
    assert changed.status_code == 200
    movements = client.get(base + "/inventory-movements").json()["data"]
    assert len(movements) == 3
    assert any(
        row["movementType"] == "adjustment" and float(row["quantityDelta"]) == 7
        for row in movements
    )
    imported = client.post(
        base + "/data-imports",
        json={
            "source": "csv",
            "rows": [{"sku": "TEST-1", "saleDate": "2026-09-29", "quantity": "4"}],
        },
    )
    assert imported.status_code == 201, imported.text
    assert float(client.get(base + "/products").json()["data"][0]["currentStock"]) == 25
    assert "TEST-1" in client.get(base + "/exports/sales.csv").text
    assert client.get(base + "/exports/inventory-movements.csv").status_code == 200
    settings = client.get(base + "/settings").json()["data"]
    saved = client.put(
        base + "/settings",
        json={**settings, "businessName": "My Test Store", "businessLocation": "Test City"},
    )
    assert saved.status_code == 200, saved.text
    assert client.get(base).json()["data"]["name"] == "My Test Store"
    rejected = client.put(
        base + "/settings", json={**settings, "businessName": "   ", "movingAverageWindow": 14}
    )
    assert rejected.status_code == 422
    assert (
        client.get(base + "/settings").json()["data"]["movingAverageWindow"]
        == settings["movingAverageWindow"]
    )
    from app.bootstrap_owner import bootstrap

    with psycopg.connect(dsn) as conn:
        before = conn.execute("SELECT password_hash FROM users").fetchone()[0]
    bootstrap()
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT password_hash FROM users").fetchone()[0] == before
    assert (
        client.get("/api/v1/businesses/00000000-0000-4000-8000-000000000099/products").status_code
        == 403
    )


def test_worker_commits_failed_job_and_processes_next_job(pg_client, monkeypatch):
    client, business, _dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    payload = {
        "trainingStart": "2026-01-01",
        "trainingEnd": "2026-01-01",
        "validationStart": "2026-01-02",
        "validationEnd": "2026-01-02",
        "finalTestStart": "2026-01-03",
        "finalTestEnd": "2026-01-03",
        "forecastHorizonDays": 7,
    }
    first = client.post(base + "/forecast-runs", json=payload)
    assert first.status_code == 202, first.text
    from app import worker

    real_process = worker.process_run
    monkeypatch.setattr(
        worker, "process_run", lambda *_: (_ for _ in ()).throw(RuntimeError("Test failure"))
    )
    assert worker.run_once()
    failed = client.get(base + f"/forecast-runs/{first.json()['data']['id']}").json()["data"]
    assert failed["status"] == "failed"
    monkeypatch.setattr(worker, "process_run", real_process)
    second = client.post(base + "/forecast-runs", json=payload)
    assert second.status_code == 202
    assert worker.run_once()
    completed = client.get(base + f"/forecast-runs/{second.json()['data']['id']}").json()["data"]
    assert completed["status"] == "completed"
    dashboard = client.get(base + "/forecast-dashboard")
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["data"]["recommendations"][0]["suggested_quantity"] == "0"
