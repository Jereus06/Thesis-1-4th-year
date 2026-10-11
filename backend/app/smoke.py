"""Exercise a fresh Docker test installation. Run only against disposable test records."""

import os
import sys
import time
from datetime import date, timedelta
from decimal import Decimal

import httpx

from .config import get_settings


def main():
    settings = get_settings()
    if settings.owner_data_origin != "demo":
        raise RuntimeError("Smoke checks create synthetic records and require demo provenance")
    base = f"/api/v1/businesses/{settings.owner_business_id}"
    with httpx.Client(base_url=os.getenv("STOCKCAST_URL", "http://web"), timeout=30) as client:
        assert client.get("/").status_code == 200
        assert client.get("/forecasts").status_code == 200
        assert client.get("/api/v1/health").json()["database"] == "connected"
        assert client.get(base + "/products").status_code == 401
        signed_in = client.post(
            "/api/v1/auth/sign-in",
            json={
                "businessId": str(settings.owner_business_id),
                "email": str(settings.owner_email),
                "password": settings.owner_password,
            },
        )
        assert signed_in.status_code == 200, signed_in.text
        client.headers["X-CSRF-Token"] = client.cookies["stockcast_csrf"]
        products = client.get(base + "/products").json()["data"]
        if "--check-persistence" in sys.argv:
            product = next(item for item in products if item["sku"] == "SMOKE-PERSIST")
            assert float(product["currentStock"]) == 30
            assert len(client.get(base + "/sales?limit=200").json()["data"]) >= 171
            assert (
                client.get(base + "/forecast-dashboard").json()["data"]["run"]["status"]
                == "completed"
            )
            print("Restart persistence passed.")
            return
        product = {
            "sku": "SMOKE-PERSIST",
            "name": "Smoke Test Product",
            "category": "Synthetic test",
            "unit": "pc",
            "currentStock": "20",
            "leadTimeDays": 2,
            "safetyStock": "2",
            "unitCost": "10",
        }

        def post(path, payload, key=None):
            response = client.post(
                base + path, json=payload, headers={"Idempotency-Key": key} if key else {}
            )
            assert response.status_code in {200, 201, 202}, response.text
            return response.json()["data"]

        created = post("/products", product, "smoke-product")
        assert post("/products", product, "smoke-product")["id"] == created["id"]
        sale = {"productId": created["id"], "saleDate": str(date.today()), "quantity": "2"}
        first = post("/sales", sale, "smoke-sale")
        assert post("/sales", sale, "smoke-sale")["id"] == first["id"]
        assert client.post(base + "/sales", json={**sale, "quantity": "99999"}).status_code == 409
        post(
            "/inventory-movements",
            {
                "productId": created["id"],
                "movementDate": str(date.today()),
                "movementType": "receipt",
                "quantityDelta": "3",
            },
            "smoke-receipt",
        )
        assert (
            post(
                "/inventory-imports",
                {"rows": [{**product, "currentStock": "30"}]},
                "smoke-stock-count",
            )["updated"]
            == 1
        )
        rows = [
            {
                "sku": product["sku"],
                "saleDate": str(date.today() - timedelta(days=169 - i)),
                "quantity": str(8 + i % 7),
            }
            for i in range(170)
        ]
        assert post("/data-imports", {"source": "csv", "rows": rows})["acceptedRows"] == 170
        assert float(client.get(base + "/products").json()["data"][0]["currentStock"]) == 30
        for kind in ("sales", "inventory-movements"):
            export = client.get(base + f"/exports/{kind}.csv")
            assert export.status_code == 200 and "SMOKE-PERSIST" in export.text
        run = post("/forecast-refresh", None)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            status = client.get(base + f"/forecast-runs/{run['id']}").json()["data"]
            if status["status"] in {"completed", "failed"}:
                assert status["status"] == "completed", status["failureMessage"]
                break
            time.sleep(1)
        else:
            raise AssertionError("Forecast worker timed out")
        dashboard = client.get(base + "/forecast-dashboard").json()["data"]
        future = [row for row in dashboard["predictions"] if row["datasetSplit"] == "future"]
        assert {row["method"] for row in future} == {"xgboost", "moving_average", "ensemble"}
        metrics = [row for row in dashboard["metrics"] if row["datasetSplit"] == "final_test"]
        assert len(metrics) == 3 and len({row["observationCount"] for row in metrics}) == 1
        summary = dashboard["summaries"][created["id"]]
        assert summary["eligible"] and summary["nonzeroDays"] >= 100
        assert (settings.artifact_dir / summary["artifact"]).is_file()
        recommendation = dashboard["recommendations"][0]
        daily = Decimal(recommendation["daily_demand"])
        assert Decimal(recommendation["reorder_point"]) == daily * 2 + 2
        assert client.post("/api/v1/auth/sign-out").status_code == 200
        assert client.get(base + "/products").status_code == 401
    print("Web/API/PostgreSQL/worker workflow passed.")


if __name__ == "__main__":
    main()
