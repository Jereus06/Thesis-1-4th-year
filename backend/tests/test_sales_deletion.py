"""Imported-history deletion, stock preservation, retries, and frozen forecast evidence."""

from copy import deepcopy
import os
from uuid import UUID

import psycopg
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.repository import Repository
from app.security import Principal, token_hash
from test_dashboard import FakeRepository
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401
from test_sales_imports import ImportConnection, owner, payload, row


@pytest.mark.parametrize("key", [None, "synthetic-record"])
def test_full_removal_allows_exact_batch_again_but_partial_removal_retains_guard(key):
    repository = Repository(ImportConnection())
    rows = [row(key), row(None if key is None else key + "-2", saleDate="2026-01-02")]
    original = repository.create_sales_import(owner(), payload(rows))
    repository.conn.sales.pop()
    with pytest.raises(HTTPException) as duplicate:
        repository.create_sales_import(owner(), payload(rows))
    assert duplicate.value.status_code == 409
    repository.conn.sales.clear()
    repeated = repository.create_sales_import(owner(), payload(rows))
    assert repeated["acceptedRows"] == 2
    assert repeated["contentSha256"] == original["contentSha256"]
    assert len(repository.conn.batches) == 2


def test_dashboard_keeps_deletion_stale_after_other_changes_no_longer_exist():
    from app.dashboard import dashboard

    repository = FakeRepository()
    repository.completed["configuration"]["salesHistoryChanged"] = True
    snapshot = deepcopy(repository.completed["data_snapshot"])
    predictions = deepcopy(repository.predictions)
    assert repository.changed is False
    result = dashboard(repository, "synthetic-business")
    assert result["stale"] is True
    assert repository.completed["data_snapshot"] == snapshot
    assert repository.predictions == predictions


@pytest.fixture()
def deletion_api(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", os.environ.get(
        "DATABASE_URL", "postgresql://synthetic:synthetic@127.0.0.1/synthetic",
    ))
    from app.config import get_settings

    get_settings.cache_clear()
    from app.main import app, current_session, repo

    class StubRepository:
        def __init__(self):
            self.calls = []

        def delete_imported_sales(self, user, sale_id=None):
            self.calls.append((user.business_id, sale_id))
            return {"deletedRows": 1}

    repository = StubRepository()
    principal = Principal("owner", "store-1", "owner@example.com", "Owner", "owner")
    csrf = "synthetic-csrf"
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[repo] = lambda: repository
    app.dependency_overrides[current_session] = lambda: (principal, token_hash(csrf))
    client = TestClient(app, cookies={"stockcast_csrf": csrf})
    client.headers["X-CSRF-Token"] = csrf
    try:
        yield client, repository, principal
    finally:
        client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


@pytest.mark.parametrize("suffix", ["imported", "00000000-0000-4000-8000-000000000001"])
def test_delete_api_routes_scope_permissions_and_csrf(deletion_api, suffix):
    client, repository, principal = deletion_api
    path = f"/api/v1/businesses/store-1/sales/{suffix}"
    assert client.delete(path).json() == {"data": {"deletedRows": 1}}
    assert len(repository.calls) == 1
    assert repository.calls[0][1] == (None if suffix == "imported" else UUID(suffix))
    assert client.delete(path.replace("store-1", "other-store")).status_code == 403
    assert client.delete(path, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    client.headers.pop("X-CSRF-Token")
    assert client.delete(path).status_code == 403
    client.headers["X-CSRF-Token"] = "synthetic-csrf"
    object.__setattr__(principal, "role", "staff")
    assert client.delete(path).status_code == 403
    assert len(repository.calls) == 1


def import_history(client, base, key=None, days=2):
    rows = [
        {"sku": "TEST-1", "saleDate": f"2026-01-{index:02d}", "quantity": "2",
         **({"sourceRecordKey": f"{key}:{index}"} if key else {})}
        for index in range(1, days + 1)
    ]
    response = client.post(base + "/data-imports", json={"source": "csv", "rows": rows})
    assert response.status_code == 201, response.text
    return rows, response.json()["data"]


@pytest.mark.parametrize("key", [None, "synthetic-pos"])
def test_delete_imported_sales_preserves_live_stock_audits_and_allows_full_reimport(pg_client, key):
    client, business, dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    rows, original = import_history(client, base, key)
    live = client.post(base + "/sales", json={
        "productId": product["id"], "saleDate": "2026-01-03", "quantity": "1",
    })
    assert live.status_code == 201, live.text
    live_id = live.json()["data"]["id"]
    products_before = client.get(base + "/products").json()["data"]
    movements_before = client.get(base + "/inventory-movements").json()["data"]
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        batch_before = conn.execute("SELECT * FROM data_imports WHERE id=%s", (original["id"],)).fetchone()
    sales = client.get(base + "/sales").json()["data"]
    imported = [sale for sale in sales if sale["source"] == "csv_import"]
    assert all(sale["importId"] == original["id"] for sale in imported)
    assert next(sale for sale in sales if sale["id"] == live_id)["importId"] is None
    assert client.delete(base + f"/sales/{live_id}").status_code == 409
    assert client.delete(base + f"/sales/{imported[0]['id']}").json() == {"data": {"deletedRows": 1}}
    assert client.delete(base + f"/sales/{imported[0]['id']}").json() == {"data": {"deletedRows": 0}}
    # A partially removed unkeyed batch must not duplicate its surviving history.
    assert client.post(base + "/data-imports", json={"source": "csv", "rows": rows}).status_code == 409
    assert client.delete(base + "/sales/imported").json() == {"data": {"deletedRows": 1}}
    assert client.delete(base + "/sales/imported").json() == {"data": {"deletedRows": 0}}
    assert [sale["id"] for sale in client.get(base + "/sales").json()["data"]] == [live_id]
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        assert conn.execute("SELECT * FROM data_imports WHERE id=%s", (original["id"],)).fetchone() == batch_before
    repeated = client.post(base + "/data-imports", json={"source": "csv", "rows": rows})
    assert repeated.status_code == 201, repeated.text
    assert repeated.json()["data"]["acceptedRows"] == 2
    assert repeated.json()["data"]["id"] != original["id"]
    assert client.get(base + "/products").json()["data"] == products_before
    assert client.get(base + "/inventory-movements").json()["data"] == movements_before


def test_stock_linked_import_blocks_single_and_bulk_deletion_atomically(pg_client):
    client, business, dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    import_history(client, base)
    sales_before = client.get(base + "/sales").json()["data"]
    linked_id = sales_before[0]["id"]
    with psycopg.connect(dsn) as conn:
        conn.execute(
            """INSERT INTO inventory_movements
               (business_id,product_id,movement_date,movement_type,quantity_delta,
                balance_after,data_origin,sale_id)
               VALUES(%s,%s,'2026-01-02','sale',-2,20,'demo',%s)""",
            (business, product["id"], linked_id),
        )
    products_before = client.get(base + "/products").json()["data"]
    movements_before = client.get(base + "/inventory-movements").json()["data"]
    assert client.delete(base + f"/sales/{linked_id}").status_code == 409
    assert client.delete(base + "/sales/imported").status_code == 409
    assert client.get(base + "/sales").json()["data"] == sales_before
    assert client.get(base + "/products").json()["data"] == products_before
    assert client.get(base + "/inventory-movements").json()["data"] == movements_before


@pytest.mark.parametrize("status", ["queued", "running", "completed"])
def test_deletion_marks_frozen_forecast_stale_including_during_worker_processing(pg_client, status):
    from app import worker

    client, business, dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    import_history(client, base, days=5)
    boundaries = {
        "trainingStart": "2026-01-01", "trainingEnd": "2026-01-03",
        "validationStart": "2026-01-04", "validationEnd": "2026-01-04",
        "finalTestStart": "2026-01-05", "finalTestEnd": "2026-01-05",
        "forecastHorizonDays": 7,
    }
    queued = client.post(base + "/forecast-runs", json=boundaries)
    assert queued.status_code == 202, queued.text
    original = queued.json()["data"]
    if status == "completed":
        assert worker.run_once()
        assert not client.get(base + "/forecast-dashboard").json()["data"]["stale"]
    selected = next(sale for sale in client.get(base + "/sales").json()["data"]
                    if sale["saleDate"] == "2026-01-02")
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row, autocommit=True) as conn:
        # Claiming before deletion reproduces a worker's older in-memory config.
        claimed = worker.claim_run(conn) if status == "running" else None
        assert client.delete(base + f"/sales/{selected['id']}").json() == {"data": {"deletedRows": 1}}
        saved = conn.execute("SELECT * FROM forecast_runs WHERE id=%s", (original["id"],)).fetchone()
        assert saved["configuration"]["salesHistoryChanged"] is True
        assert saved["data_snapshot"] == original["dataSnapshot"]
        if claimed:
            assert "salesHistoryChanged" not in claimed["configuration"]
            worker.process_run(conn, claimed)
            conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", (original["id"],))
        elif status == "queued":
            assert worker.run_once()
        saved = conn.execute("SELECT * FROM forecast_runs WHERE id=%s", (original["id"],)).fetchone()
        assert saved["status"] == "completed"
        assert saved["configuration"]["salesHistoryChanged"] is True
        assert saved["data_snapshot"] == original["dataSnapshot"]
        assert conn.execute("SELECT count(*) FROM forecast_predictions WHERE forecast_run_id=%s",
                            (original["id"],)).fetchone()["count"] > 0
    assert client.get(base + "/forecast-dashboard").json()["data"]["stale"]
    refreshed = client.post(base + "/forecast-runs", json=boundaries)
    assert refreshed.status_code == 202, refreshed.text
    assert worker.run_once()
    assert not client.get(base + "/forecast-dashboard").json()["data"]["stale"]


def test_delete_api_enforces_real_sessions_csrf_staff_and_business_scope(pg_client):
    from app.auth_repository import AuthRepository

    client, business, dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    import_history(client, base)
    sale = client.get(base + "/sales").json()["data"][0]
    paths = [base + "/sales/imported", base + f"/sales/{sale['id']}"]
    owner_csrf = client.headers.pop("X-CSRF-Token")
    for path in paths:
        assert client.delete(path).status_code == 403
    client.headers["X-CSRF-Token"] = owner_csrf
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        foreign_business = conn.execute(
            "INSERT INTO businesses(name,data_origin) VALUES('Synthetic Other Store','demo') RETURNING id"
        ).fetchone()["id"]
        foreign_product = conn.execute(
            """INSERT INTO products(business_id,sku,name,category,unit)
               VALUES(%s,'FOREIGN-1','Other product','Test','pc') RETURNING id""",
            (foreign_business,),
        ).fetchone()["id"]
        foreign_import = conn.execute(
            """INSERT INTO data_imports(business_id,source,data_origin,status,total_rows,accepted_rows)
               VALUES(%s,'csv','demo','completed',1,1) RETURNING id""",
            (foreign_business,),
        ).fetchone()["id"]
        foreign_sale = conn.execute(
            """INSERT INTO sales(business_id,product_id,sale_date,quantity,source,data_origin,import_id)
               VALUES(%s,%s,'2026-01-01',2,'csv_import','demo',%s) RETURNING id""",
            (foreign_business, foreign_product, foreign_import),
        ).fetchone()["id"]
        staff = conn.execute(
            """INSERT INTO users(business_id,email,display_name,role,password_hash)
               SELECT business_id,'synthetic.staff@example.test','Staff','staff',password_hash
               FROM users WHERE business_id=%s AND role='owner' RETURNING id""",
            (business,),
        ).fetchone()
        staff_session, staff_csrf, _ = AuthRepository(conn).issue_session(
            Principal(str(staff["id"]), business, "synthetic.staff@example.test", "Staff", "staff"), 12,
        )
    for path in paths:
        assert client.delete(path, headers={"Cookie": "stockcast_csrf=synthetic-only"}).status_code == 401
        assert client.delete(path, headers={
            "Cookie": f"stockcast_session={staff_session}; stockcast_csrf={staff_csrf}",
            "X-CSRF-Token": staff_csrf,
        }).status_code == 403
        assert client.delete(path.replace(business, str(foreign_business))).status_code == 403
    assert len(client.get(base + "/sales").json()["data"]) == 2
    assert client.delete(base + f"/sales/{foreign_sale}").json() == {"data": {"deletedRows": 0}}
    assert client.delete(base + "/sales/imported").json() == {"data": {"deletedRows": 2}}
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT id FROM sales WHERE id=%s", (foreign_sale,)).fetchone()
