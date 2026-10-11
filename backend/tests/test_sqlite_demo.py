from pathlib import Path

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
