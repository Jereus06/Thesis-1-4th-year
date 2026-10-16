"""Product removal protects stock, historical records, and frozen forecast inputs."""

import os
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb
import pytest
from fastapi.testclient import TestClient

from app.repository import Repository
from app.security import Principal, token_hash
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


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

        def delete_product(self, user, product_id):
            self.calls.append((user.business_id, product_id))
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
        get_settings.cache_clear()


def test_delete_product_route_requires_owner_business_and_csrf(deletion_api):
    client, repository, principal = deletion_api
    product_id = UUID("00000000-0000-4000-8000-000000000001")
    path = f"/api/v1/businesses/store-1/products/{product_id}"
    assert client.delete(path).json() == {"data": {"deletedRows": 1}}
    assert repository.calls == [("store-1", product_id)]
    assert client.delete(path.replace("store-1", "other-store")).status_code == 403
    assert client.delete(path, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    client.headers.pop("X-CSRF-Token")
    assert client.delete(path).status_code == 403
    client.headers["X-CSRF-Token"] = "synthetic-csrf"
    object.__setattr__(principal, "role", "staff")
    assert client.delete(path).status_code == 403
    assert repository.calls == [("store-1", product_id)]


@pytest.mark.parametrize("active", [True, False])
def test_delete_unused_product_is_retry_safe_and_does_not_replay_creation(pg_client, active):
    client, business, dsn = pg_client
    product = create_product(client, business, stock="0")
    base = f"/api/v1/businesses/{business}"
    path = base + f"/products/{product['id']}"
    if not active:
        assert client.patch(path, json={"isActive": False}).status_code == 200
    assert client.get(base + "/inventory-movements").json()["data"] == []
    assert create_product(client, business, stock="0")["id"] == product["id"]
    assert client.delete(path).json() == {"data": {"deletedRows": 1}}
    assert client.delete(path).json() == {"data": {"deletedRows": 0}}
    assert client.get(path).status_code == 404
    assert client.get(base + "/products").json()["data"] == []
    assert client.get(base + "/inventory-movements").json()["data"] == []
    payload = {
        "sku": "TEST-1", "name": "Test Product", "category": "Test", "unit": "pc",
        "currentStock": "0", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    }
    retry = client.post(base + "/products", json=payload, headers={"Idempotency-Key": "product-1"})
    assert retry.status_code == 409, retry.text
    assert "deleted" in retry.json()["detail"]
    recreated = client.post(base + "/products", json=payload, headers={"Idempotency-Key": "new-product"})
    assert recreated.status_code == 201, recreated.text
    assert recreated.json()["data"]["id"] != product["id"]
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM idempotency_keys WHERE operation='create_product'").fetchone()[0] == 2


def test_delete_product_protects_stock_and_original_opening_movement(pg_client):
    client, business, _dsn = pg_client
    product = create_product(client, business, stock="5")
    base = f"/api/v1/businesses/{business}"
    path = base + f"/products/{product['id']}"
    before = client.get(base + "/inventory-movements").json()["data"]
    assert client.delete(path).status_code == 409
    assert client.get(path).json()["data"] == product
    assert client.get(base + "/inventory-movements").json()["data"] == before
    assert client.patch(path, json={"currentStock": "0"}).status_code == 200
    zero_stock = client.get(path).json()["data"]
    movements = client.get(base + "/inventory-movements").json()["data"]
    blocked = client.delete(path)
    assert blocked.status_code == 409
    assert "Deactivate" in blocked.json()["detail"]
    assert client.get(path).json()["data"] == zero_stock
    assert client.get(base + "/inventory-movements").json()["data"] == movements


def insert_forecast(conn, business, snapshot=None, status="completed"):
    return conn.execute(
        """INSERT INTO forecast_runs(
            business_id,data_origin,status,algorithm_name,training_start,training_end,
            validation_start,validation_end,final_test_start,final_test_end,forecast_horizon_days,
            data_snapshot)
           VALUES(%s,'demo',%s,'Synthetic deletion test','2026-01-01','2026-01-02',
                  '2026-01-03','2026-01-03','2026-01-04','2026-01-04',7,%s) RETURNING id""",
        (business, status, Jsonb(snapshot or {})),
    ).fetchone()[0]


@pytest.mark.parametrize("history", [
    "sale", "voided_sale", "movement", "prediction", "metric", "recommendation", "quality", "quality_audit",
])
def test_delete_product_preserves_each_kind_of_saved_record(pg_client, history):
    client, business, dsn = pg_client
    product = create_product(client, business, stock="0")
    product_id = product["id"]
    base = f"/api/v1/businesses/{business}"
    with psycopg.connect(dsn) as conn:
        owner_id = conn.execute("SELECT id FROM users WHERE business_id=%s AND role='owner'", (business,)).fetchone()[0]
        if history in {"sale", "voided_sale"}:
            table = "sales"
            conn.execute(
                """INSERT INTO sales(business_id,product_id,sale_date,quantity,source,data_origin,voided_at)
                   VALUES(%s,%s,'2026-01-01',1,'manual','demo',%s)""",
                (business, product_id, "2026-01-02T00:00:00Z" if history == "voided_sale" else None),
            )
        elif history == "movement":
            table = "inventory_movements"
            conn.execute(
                """INSERT INTO inventory_movements(business_id,product_id,movement_date,movement_type,
                        quantity_delta,balance_after,data_origin)
                   VALUES(%s,%s,'2026-01-01','opening_balance',1,1,'demo')""",
                (business, product_id),
            )
        elif history in {"prediction", "metric"}:
            run_id = insert_forecast(conn, business)
            if history == "prediction":
                table = "forecast_predictions"
                conn.execute(
                    """INSERT INTO forecast_predictions(business_id,forecast_run_id,product_id,prediction_date,
                            method,dataset_split,predicted_quantity)
                       VALUES(%s,%s,%s,'2026-01-05','moving_average','future',1)""",
                    (business, run_id, product_id),
                )
            else:
                table = "forecast_metrics"
                conn.execute(
                    """INSERT INTO forecast_metrics(business_id,forecast_run_id,product_id,method,dataset_split,
                            mae,rmse,observation_count)
                       VALUES(%s,%s,%s,'moving_average','final_test',1,1,1)""",
                    (business, run_id, product_id),
                )
        elif history == "recommendation":
            table = "reorder_recommendations"
            conn.execute(
                """INSERT INTO reorder_recommendations(business_id,product_id,method,recommendation_date,
                        forecast_daily_demand,current_stock,lead_time_days,safety_stock,target_cover_days,
                        demand_during_lead_time,reorder_point,target_stock,suggested_quantity,status,
                        confidence_level,calculation_version)
                   VALUES(%s,%s,'rule','2026-01-01',1,0,1,0,7,1,1,8,8,'reorder','low','synthetic-test')""",
                (business, product_id),
            )
        elif history == "quality":
            table = "sales_day_quality"
            conn.execute(
                """INSERT INTO sales_day_quality(business_id,product_id,classification_date,classification,
                        created_by,updated_by)
                   VALUES(%s,%s,'2026-01-01','confirmed_zero',%s,%s)""",
                (business, product_id, owner_id, owner_id),
            )
        else:
            table = "sales_day_quality_audit"
            conn.execute(
                """INSERT INTO sales_day_quality_audit(business_id,product_id,classification_date,
                        previous_classification,action,changed_by)
                   VALUES(%s,%s,'2026-01-01','confirmed_zero','deleted',%s)""",
                (business, product_id, owner_id),
            )
        before = conn.execute(f"SELECT * FROM {table} WHERE product_id=%s", (product_id,)).fetchall()
    blocked = client.delete(base + f"/products/{product_id}")
    assert blocked.status_code == 409, blocked.text
    assert "saved records" in blocked.json()["detail"]
    assert client.get(base + f"/products/{product_id}").json()["data"] == product
    with psycopg.connect(dsn) as conn:
        assert conn.execute(f"SELECT * FROM {table} WHERE product_id=%s", (product_id,)).fetchall() == before


@pytest.mark.parametrize("status", ["queued", "running", "completed", "failed"])
@pytest.mark.parametrize("reference", ["products", "preparedProducts", "dailySales", "dataQuality"])
def test_delete_product_preserves_frozen_forecast_inputs(pg_client, status, reference):
    client, business, dsn = pg_client
    product = create_product(client, business, stock="0")
    product_id = product["id"]
    snapshots = {
        "products": {"products": [product_id]},
        "preparedProducts": {"preparedProducts": {product_id: {"targets": []}}},
        "dailySales": {"dailySales": [{"productId": product_id, "date": "2026-01-01", "quantity": "1"}]},
        "dataQuality": {"dataQuality": [{"productId": product_id, "date": "2026-01-01", "classification": "confirmed_zero"}]},
    }
    snapshot = snapshots[reference]
    with psycopg.connect(dsn) as conn:
        run_id = insert_forecast(conn, business, snapshot, status)
    base = f"/api/v1/businesses/{business}"
    response = client.delete(base + f"/products/{product_id}")
    assert response.status_code == 409, response.text
    assert client.get(base + f"/products/{product_id}").json()["data"] == product
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT data_snapshot,status FROM forecast_runs WHERE id=%s", (run_id,)).fetchone() == (snapshot, status)


def test_delete_does_not_touch_another_business_product(pg_client):
    client, business, dsn = pg_client
    with psycopg.connect(dsn) as conn:
        other_business = conn.execute(
            "INSERT INTO businesses(name,data_origin) VALUES('Synthetic Other Store','demo') RETURNING id"
        ).fetchone()[0]
        other_product = conn.execute(
            """INSERT INTO products(business_id,sku,name,category,unit)
               VALUES(%s,'OTHER','Other product','Test','pc') RETURNING id""", (other_business,),
        ).fetchone()[0]
    assert client.delete(f"/api/v1/businesses/{other_business}/products/{other_product}").status_code == 403
    assert client.delete(f"/api/v1/businesses/{business}/products/{other_product}").json() == {"data": {"deletedRows": 0}}
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT id FROM products WHERE id=%s", (other_product,)).fetchone()


def test_concurrent_unused_product_deletions_remove_once(pg_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    client, business, dsn = pg_client
    product = create_product(client, business, stock="0")
    with psycopg.connect(dsn) as conn:
        owner_id = conn.execute("SELECT id FROM users WHERE business_id=%s AND role='owner'", (business,)).fetchone()[0]
    principal = Principal(str(owner_id), business, "owner@example.com", "Owner", "owner")
    barrier = Barrier(2)

    def remove():
        with psycopg.connect(dsn) as conn:
            repository = Repository(conn)
            barrier.wait(timeout=10)
            return repository.delete_product(principal, UUID(product["id"]))["deletedRows"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(remove) for _ in range(2)]
        assert sorted(future.result(timeout=20) for future in futures) == [0, 1]
