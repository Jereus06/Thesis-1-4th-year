from pathlib import Path
from decimal import Decimal
import sqlite3

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient

from app import sqlite_demo


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(sqlite_demo, "DB_PATH", tmp_path / "demo.sqlite3")
    with TestClient(sqlite_demo.app) as value:
        yield value


def sign_in(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={
            "businessId": sqlite_demo.DEMO_BUSINESS_ID,
            "email": sqlite_demo.DEMO_EMAIL,
            "password": sqlite_demo.DEMO_PASSWORD,
        },
    )
    assert response.status_code == 200
    return {"X-CSRF-Token": client.cookies["stockcast_csrf"]}


def test_login_csrf_atomic_stock_and_persistence(client: TestClient):
    headers = sign_in(client)
    payload = {
        "sku": "DEMO-1",
        "name": "Demo Rice",
        "category": "Demo",
        "unit": "kg",
        "currentStock": "10.500",
        "leadTimeDays": 2,
        "safetyStock": "1.000",
        "unitCost": "50.2500",
    }
    assert (
        client.post(
            f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}/products", json=payload
        ).status_code
        == 403
    )
    created = client.post(
        f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}/products", json=payload, headers=headers
    )
    assert created.status_code == 201
    product_id = created.json()["data"]["id"]

    sale = client.post(
        f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}/sales",
        json={"productId": product_id, "saleDate": "2026-09-30", "quantity": "2.250"},
        headers=headers,
    )
    assert sale.status_code == 201
    rejected = client.post(
        f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}/sales",
        json={"productId": product_id, "saleDate": "2026-09-30", "quantity": "99"},
        headers=headers,
    )
    assert rejected.status_code == 409
    receipt = client.post(
        f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}/inventory-movements",
        json={
            "productId": product_id,
            "movementDate": "2026-09-30",
            "movementType": "receipt",
            "quantityDelta": "1.125",
        },
        headers=headers,
    )
    assert receipt.status_code == 201
    assert receipt.json()["data"]["balanceAfter"] == "9.375"
    assert (
        len(
            client.get(
                f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}/inventory-movements"
            ).json()["data"]
        )
        == 3
    )

    # A new connection (the equivalent of a process restart) reads the same file.
    with sqlite_demo.connect() as conn:
        assert (
            conn.execute("SELECT current_stock FROM products WHERE id=?", (product_id,)).fetchone()[
                0
            ]
            == "9.375"
        )


def test_business_isolation(client: TestClient):
    sign_in(client)
    response = client.get("/api/v1/businesses/00000000-0000-4000-8000-000000000099/products")
    assert response.status_code == 403


def test_recorded_sale_deletion_restores_stock_preserves_audit_and_retries(client: TestClient):
    headers = sign_in(client)
    base = f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}"
    product = client.post(base + "/products", headers=headers, json={
        "sku": "VOID-1", "name": "Demo oil", "category": "Demo", "unit": "litre",
        "currentStock": "10.500", "leadTimeDays": 2, "safetyStock": "1", "unitCost": "20",
    }).json()["data"]
    sale = client.post(base + "/sales", headers=headers, json={
        "productId": product["id"], "saleDate": "2026-01-01", "quantity": "2.125",
    }).json()["data"]
    receipt = client.post(base + "/inventory-movements", headers=headers, json={
        "productId": product["id"], "movementDate": "2026-01-02",
        "movementType": "receipt", "quantityDelta": "1.250",
    })
    assert receipt.status_code == 201
    assert client.patch(base + f"/products/{product['id']}", headers=headers, json={"isActive": False}).status_code == 200
    movements = client.get(base + "/inventory-movements").json()["data"]
    path = base + f"/sales/{sale['id']}"
    assert client.delete(path).status_code == 403
    assert client.delete(path.replace(sqlite_demo.DEMO_BUSINESS_ID, "other"), headers=headers).status_code == 403
    assert client.delete(path, headers=headers).json() == {"data": {"deletedRows": 1}}
    assert client.delete(path, headers=headers).json() == {"data": {"deletedRows": 0}}
    assert client.get(base + "/sales").json()["data"] == []
    assert Decimal(client.get(base + "/products").json()["data"][0]["currentStock"]) == Decimal("11.750")
    audits = client.get(base + "/inventory-movements").json()["data"]
    assert len(audits) == len(movements) + 1
    assert all(row in audits for row in movements)
    correction = next(row for row in audits if row["note"] == f"Recorded sale deleted: {sale['id']}")
    assert correction["quantityDelta"] == "2.125"
    assert correction["balanceAfter"] == "11.750"
    assert correction["movementType"] == "adjustment"
    with sqlite_demo.connect() as conn:
        assert conn.execute("SELECT voided_at FROM sales WHERE id=?", (sale["id"],)).fetchone()[0]
        conn.execute("UPDATE users SET role='staff' WHERE id=?", (sqlite_demo.DEMO_OWNER_ID,))
    assert client.delete(path, headers=headers).status_code == 403


def test_existing_sqlite_demo_upgrades_sales_without_resetting_records(tmp_path, monkeypatch):
    path = tmp_path / "old-demo.sqlite3"
    monkeypatch.setattr(sqlite_demo, "DB_PATH", path)
    with sqlite3.connect(path) as conn:
        conn.execute("""CREATE TABLE sales(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,
            product_id TEXT NOT NULL,sale_date TEXT NOT NULL,quantity TEXT NOT NULL,
            source TEXT NOT NULL,data_origin TEXT NOT NULL,recorded_by TEXT NOT NULL)""")
        conn.execute("INSERT INTO sales VALUES('saved','store','product','2026-01-01','2','manual','demo','owner')")
    sqlite_demo.initialize()
    sqlite_demo.initialize()
    with sqlite_demo.connect() as conn:
        retained = conn.execute("SELECT * FROM sales WHERE id='saved'").fetchone()
        assert retained["quantity"] == "2"
        assert retained["voided_at"] is None
