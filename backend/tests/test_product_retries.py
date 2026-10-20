"""Product updates confirm saved requests without reapplying stock counts."""

import sqlite3
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest

from app import sqlite_demo
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401
from test_sqlite_demo import client as sqlite_client, sign_in  # noqa: F401


def product_stock(client, base, product_id):
    response = client.get(base + f"/products/{product_id}")
    assert response.status_code == 200, response.text
    return Decimal(response.json()["data"]["currentStock"])


def test_count_retry_preserves_intervening_sale_and_original_adjustment(pg_client):
    client, business, dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    product = create_product(client, business)
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "stock-count-retry"}
    payload = {"currentStock": "8"}

    # The first response is considered lost by the caller, but the count saved.
    saved = client.patch(path, json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    assert Decimal(saved.json()["data"]["currentStock"]) == 8
    sale = client.post(base + "/sales", json={
        "productId": product["id"], "saleDate": "2026-01-01", "quantity": "1",
    }, headers={"Idempotency-Key": "intervening-sale"})
    assert sale.status_code == 201, sale.text
    assert product_stock(client, base, product["id"]) == 7
    before_movements = client.get(base + "/inventory-movements").json()["data"]

    replay = client.patch(path, json=payload, headers=headers)
    assert replay.status_code == 200, replay.text
    assert replay.json() == saved.json()
    assert product_stock(client, base, product["id"]) == 7
    assert client.get(base + "/inventory-movements").json()["data"] == before_movements
    adjustments = [row for row in before_movements if row["movementType"] == "adjustment"]
    assert len(adjustments) == 1
    assert Decimal(adjustments[0]["quantityDelta"]) == -12
    assert Decimal(adjustments[0]["balanceAfter"]) == 8
    with psycopg.connect(dsn) as conn:
        cached = conn.execute(
            "SELECT operation FROM idempotency_keys WHERE key=%s", (headers["Idempotency-Key"],)
        ).fetchall()
        assert cached == [(f"update_product:{product['id']}",)]


def test_count_retry_rejects_changed_payload_without_changing_stock(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    product = create_product(client, business)
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "changed-stock-count"}
    saved = client.patch(path, json={"currentStock": "8"}, headers=headers)
    assert saved.status_code == 200, saved.text
    before_movements = client.get(base + "/inventory-movements").json()["data"]

    changed = client.patch(path, json={"currentStock": "9"}, headers=headers)
    assert changed.status_code == 409, changed.text
    assert product_stock(client, base, product["id"]) == 8
    assert client.get(base + "/inventory-movements").json()["data"] == before_movements


def test_update_request_key_is_scoped_to_the_product(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    first = create_product(client, business)
    second_response = client.post(base + "/products", json={
        "sku": "TEST-2", "name": "Second synthetic product", "category": "Test", "unit": "pc",
        "currentStock": "10", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    }, headers={"Idempotency-Key": "second-product"})
    assert second_response.status_code == 201, second_response.text
    second = second_response.json()["data"]
    headers = {"Idempotency-Key": "shared-product-update-key"}

    responses = []
    for product, stock in [(first, "8"), (second, "4")]:
        response = client.patch(
            base + f"/products/{product['id']}", json={"currentStock": stock}, headers=headers,
        )
        assert response.status_code == 200, response.text
        responses.append(response.json())
    before_movements = client.get(base + "/inventory-movements").json()["data"]
    for (product, stock), expected in zip([(first, "8"), (second, "4")], responses, strict=True):
        replay = client.patch(
            base + f"/products/{product['id']}", json={"currentStock": stock}, headers=headers,
        )
        assert replay.status_code == 200, replay.text
        assert replay.json() == expected
    assert client.get(base + "/inventory-movements").json()["data"] == before_movements


def test_product_updates_without_request_key_remain_supported(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    product = create_product(client, business)
    path = base + f"/products/{product['id']}"

    for stock in ["8", "7", "8"]:
        response = client.patch(path, json={"currentStock": stock})
        assert response.status_code == 200, response.text
        assert product_stock(client, base, product["id"]) == Decimal(stock)
    movements = client.get(base + "/inventory-movements").json()["data"]
    assert len([row for row in movements if row["movementType"] == "adjustment"]) == 3


def test_rejected_update_does_not_reserve_request_key(pg_client):
    client, business, dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    product = create_product(client, business)
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "corrected-stock-count"}

    rejected = client.patch(path, json={}, headers=headers)
    assert rejected.status_code == 422, rejected.text
    with psycopg.connect(dsn) as conn:
        assert conn.execute(
            "SELECT count(*) FROM idempotency_keys WHERE key=%s", (headers["Idempotency-Key"],)
        ).fetchone()[0] == 0
    corrected = client.patch(path, json={"currentStock": "8"}, headers=headers)
    assert corrected.status_code == 200, corrected.text
    assert product_stock(client, base, product["id"]) == 8


def test_cached_update_still_requires_owner_role_and_csrf(pg_client):
    client, business, dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    product = create_product(client, business)
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "protected-stock-count"}
    payload = {"currentStock": "8"}
    saved = client.patch(path, json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    csrf = client.headers.pop("X-CSRF-Token")
    no_csrf = client.patch(path, json=payload, headers=headers)
    assert no_csrf.status_code == 403, no_csrf.text
    client.headers["X-CSRF-Token"] = csrf
    with psycopg.connect(dsn) as conn:
        conn.execute("UPDATE users SET role='staff' WHERE business_id=%s", (business,))
    no_owner = client.patch(path, json=payload, headers=headers)
    assert no_owner.status_code == 403, no_owner.text
    assert product_stock(client, base, product["id"]) == 8


def sqlite_retry_product(client, sku="COUNT-1"):
    client.headers.update(sign_in(client))
    base = f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}"
    created = client.post(base + "/products", json={
        "sku": sku, "name": "Synthetic count product", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    })
    assert created.status_code == 201, created.text
    return base, created.json()["data"]


def sqlite_product_stock(client, base, product_id):
    products = client.get(base + "/products").json()["data"]
    return Decimal(next(row["currentStock"] for row in products if row["id"] == product_id))


def test_sqlite_count_retry_preserves_intervening_sale_after_reinitialization(sqlite_client):
    base, product = sqlite_retry_product(sqlite_client)
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "sqlite-count-retry"}
    payload = {"currentStock": "8"}
    saved = sqlite_client.patch(path, json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    sale = sqlite_client.post(base + "/sales", json={
        "productId": product["id"], "saleDate": "2026-01-01", "quantity": "1",
    })
    assert sale.status_code == 201, sale.text
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 7
    before_movements = sqlite_client.get(base + "/inventory-movements").json()["data"]

    # A new process initialization must preserve the saved request and current stock.
    sqlite_demo.initialize()
    replay = sqlite_client.patch(path, json=payload, headers=headers)
    assert replay.status_code == 200, replay.text
    assert replay.json() == saved.json()
    assert Decimal(replay.json()["data"]["currentStock"]) == 8
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 7
    assert sqlite_client.get(base + "/inventory-movements").json()["data"] == before_movements


def test_sqlite_count_retry_rejects_changed_payload(sqlite_client):
    base, product = sqlite_retry_product(sqlite_client)
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "sqlite-count-conflict"}
    saved = sqlite_client.patch(path, json={"currentStock": "8"}, headers=headers)
    assert saved.status_code == 200, saved.text
    before_movements = sqlite_client.get(base + "/inventory-movements").json()["data"]

    conflict = sqlite_client.patch(path, json={"currentStock": "9"}, headers=headers)
    assert conflict.status_code == 409, conflict.text
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 8
    assert sqlite_client.get(base + "/inventory-movements").json()["data"] == before_movements


def test_sqlite_update_request_key_is_scoped_to_product(sqlite_client):
    base, first = sqlite_retry_product(sqlite_client)
    _base, second = sqlite_retry_product(sqlite_client, "COUNT-2")
    headers = {"Idempotency-Key": "sqlite-shared-key"}
    saved = []
    for product, stock in [(first, "8"), (second, "4")]:
        response = sqlite_client.patch(
            base + f"/products/{product['id']}", json={"currentStock": stock}, headers=headers,
        )
        assert response.status_code == 200, response.text
        saved.append(response.json())
    for (product, stock), expected in zip([(first, "8"), (second, "4")], saved, strict=True):
        replay = sqlite_client.patch(
            base + f"/products/{product['id']}", json={"currentStock": stock}, headers=headers,
        )
        assert replay.status_code == 200, replay.text
        assert replay.json() == expected


def test_sqlite_updates_without_key_and_corrected_rejected_requests_work(sqlite_client):
    base, product = sqlite_retry_product(sqlite_client)
    path = base + f"/products/{product['id']}"
    for stock in ["8", "7", "8"]:
        response = sqlite_client.patch(path, json={"currentStock": stock})
        assert response.status_code == 200, response.text
        assert sqlite_product_stock(sqlite_client, base, product["id"]) == Decimal(stock)
    headers = {"Idempotency-Key": "sqlite-corrected-count"}
    rejected = sqlite_client.patch(path, json={}, headers=headers)
    assert rejected.status_code == 422, rejected.text
    corrected = sqlite_client.patch(path, json={"currentStock": "6"}, headers=headers)
    assert corrected.status_code == 200, corrected.text
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 6


def test_sqlite_cached_update_still_requires_csrf_and_owner(sqlite_client):
    base, product = sqlite_retry_product(sqlite_client)
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "sqlite-protected-count"}
    payload = {"currentStock": "8"}
    saved = sqlite_client.patch(path, json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    csrf = sqlite_client.headers.pop("X-CSRF-Token")
    no_csrf = sqlite_client.patch(path, json=payload, headers=headers)
    assert no_csrf.status_code == 403, no_csrf.text
    sqlite_client.headers["X-CSRF-Token"] = csrf
    with sqlite_demo.connect() as conn:
        conn.execute(
            "UPDATE users SET role='staff' WHERE business_id=?", (sqlite_demo.DEMO_BUSINESS_ID,),
        )
    no_owner = sqlite_client.patch(path, json=payload, headers=headers)
    assert no_owner.status_code == 403, no_owner.text
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 8


def test_sqlite_update_keys_are_scoped_to_user_and_preserve_business_checks(sqlite_client):
    base, product = sqlite_retry_product(sqlite_client)
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "sqlite-user-scoped-count"}
    first = sqlite_client.patch(path, json={"currentStock": "8"}, headers=headers)
    assert first.status_code == 200, first.text
    with sqlite_demo.connect() as conn:
        conn.execute(
            """INSERT INTO users(id,business_id,email,display_name,role,password_hash)
               SELECT ?,business_id,'second@example.com','Second owner','owner',password_hash
               FROM users WHERE id=?""",
            (str(uuid4()), sqlite_demo.DEMO_OWNER_ID),
        )
    signed_in = sqlite_client.post("/api/v1/auth/sign-in", json={
        "businessId": sqlite_demo.DEMO_BUSINESS_ID, "email": "second@example.com",
        "password": sqlite_demo.DEMO_PASSWORD,
    })
    assert signed_in.status_code == 200, signed_in.text
    sqlite_client.headers["X-CSRF-Token"] = sqlite_client.cookies["stockcast_csrf"]
    second = sqlite_client.patch(path, json={"currentStock": "6"}, headers=headers)
    assert second.status_code == 200, second.text
    sqlite_client.headers.update(sign_in(sqlite_client))
    replay = sqlite_client.patch(path, json={"currentStock": "8"}, headers=headers)
    assert replay.status_code == 200, replay.text
    assert replay.json() == first.json()
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 6
    another_business = str(uuid4())
    denied = sqlite_client.patch(
        f"/api/v1/businesses/{another_business}/products/{product['id']}",
        json={"currentStock": "8"}, headers=headers,
    )
    assert denied.status_code == 403, denied.text
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 6


def test_sqlite_failed_multifield_update_rolls_back_stock_and_request_key(sqlite_client):
    base, product = sqlite_retry_product(sqlite_client)
    sqlite_retry_product(sqlite_client, "COUNT-2")
    path = base + f"/products/{product['id']}"
    headers = {"Idempotency-Key": "sqlite-atomic-count"}
    # current_stock is written before sku; the conflicting SKU must undo both.
    with pytest.raises(sqlite3.IntegrityError):
        sqlite_client.patch(path, json={"currentStock": "8", "sku": "COUNT-2"}, headers=headers)
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 20
    with sqlite_demo.connect() as conn:
        assert conn.execute(
            "SELECT count(*) FROM idempotency_keys WHERE key=?", (headers["Idempotency-Key"],)
        ).fetchone()[0] == 0
    corrected = sqlite_client.patch(
        path, json={"currentStock": "8", "sku": "COUNT-1"}, headers=headers,
    )
    assert corrected.status_code == 200, corrected.text
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 8


def product_creation_payload(sku="CREATE-RETRY"):
    return {
        "sku": sku, "name": "Synthetic creation retry", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    }


def test_create_retry_returns_saved_product_without_resetting_current_stock(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    headers = {"Idempotency-Key": "created-product-retry"}
    payload = product_creation_payload()
    saved = client.post(base + "/products", json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    product = saved.json()["data"]
    sale = client.post(base + "/sales", json={
        "productId": product["id"], "saleDate": "2026-01-01", "quantity": "5",
    })
    assert sale.status_code == 201, sale.text
    assert product_stock(client, base, product["id"]) == 15
    before_movements = client.get(base + "/inventory-movements").json()["data"]

    replay = client.post(base + "/products", json=payload, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.json() == saved.json()
    assert Decimal(replay.json()["data"]["currentStock"]) == 20
    assert product_stock(client, base, product["id"]) == 15
    products = client.get(base + "/products").json()["data"]
    assert [row["id"] for row in products] == [product["id"]]
    assert client.get(base + "/inventory-movements").json()["data"] == before_movements
    opening = [row for row in before_movements if row["movementType"] == "opening_balance"]
    assert len(opening) == 1
    assert Decimal(opening[0]["quantityDelta"]) == 20


def test_create_retry_rejects_changed_payload_without_second_product(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    headers = {"Idempotency-Key": "created-product-conflict"}
    payload = product_creation_payload()
    saved = client.post(base + "/products", json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    before_products = client.get(base + "/products").json()["data"]
    before_movements = client.get(base + "/inventory-movements").json()["data"]
    conflict = client.post(
        base + "/products", json={**payload, "sku": "DIFFERENT-SKU"}, headers=headers,
    )
    assert conflict.status_code == 409, conflict.text
    assert client.get(base + "/products").json()["data"] == before_products
    assert client.get(base + "/inventory-movements").json()["data"] == before_movements


def test_sqlite_create_retry_preserves_product_stock_and_one_opening_balance(sqlite_client):
    sqlite_client.headers.update(sign_in(sqlite_client))
    base = f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}"
    headers = {"Idempotency-Key": "sqlite-created-product-retry"}
    payload = product_creation_payload()
    saved = sqlite_client.post(base + "/products", json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    product = saved.json()["data"]
    sale = sqlite_client.post(base + "/sales", json={
        "productId": product["id"], "saleDate": "2026-01-01", "quantity": "5",
    })
    assert sale.status_code == 201, sale.text
    before_movements = sqlite_client.get(base + "/inventory-movements").json()["data"]
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 15

    sqlite_demo.initialize()
    replay = sqlite_client.post(base + "/products", json=payload, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.json() == saved.json()
    assert Decimal(replay.json()["data"]["currentStock"]) == 20
    assert sqlite_product_stock(sqlite_client, base, product["id"]) == 15
    products = sqlite_client.get(base + "/products").json()["data"]
    assert [row["id"] for row in products] == [product["id"]]
    assert sqlite_client.get(base + "/inventory-movements").json()["data"] == before_movements
    opening = [row for row in before_movements if row["movementType"] == "opening_balance"]
    assert len(opening) == 1
    assert Decimal(opening[0]["quantityDelta"]) == 20


def test_sqlite_create_retry_rejects_changed_payload_without_second_product(sqlite_client):
    sqlite_client.headers.update(sign_in(sqlite_client))
    base = f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}"
    headers = {"Idempotency-Key": "sqlite-created-product-conflict"}
    payload = product_creation_payload()
    saved = sqlite_client.post(base + "/products", json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    before_products = sqlite_client.get(base + "/products").json()["data"]
    before_movements = sqlite_client.get(base + "/inventory-movements").json()["data"]
    conflict = sqlite_client.post(
        base + "/products", json={**payload, "sku": "DIFFERENT-SKU"}, headers=headers,
    )
    assert conflict.status_code == 409, conflict.text
    assert sqlite_client.get(base + "/products").json()["data"] == before_products
    assert sqlite_client.get(base + "/inventory-movements").json()["data"] == before_movements


def test_sqlite_create_without_request_key_remains_supported(sqlite_client):
    sqlite_client.headers.update(sign_in(sqlite_client))
    base = f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}"
    created = []
    for sku in ["NO-KEY-1", "NO-KEY-2"]:
        response = sqlite_client.post(base + "/products", json=product_creation_payload(sku))
        assert response.status_code == 201, response.text
        created.append(response.json()["data"]["id"])
    products = sqlite_client.get(base + "/products").json()["data"]
    assert {row["id"] for row in products} == set(created)
    movements = sqlite_client.get(base + "/inventory-movements").json()["data"]
    assert len(movements) == 2
    assert all(row["movementType"] == "opening_balance" for row in movements)
