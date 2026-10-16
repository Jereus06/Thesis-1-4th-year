"""Synthetic authenticated ASGI/PostgreSQL measurement in a disposable test schema.

Requires STOCKCAST_TEST_DATABASE_URL to name the isolated stockcast_fixes_test DB.
Run with the backend's Python dependencies; no application database is used.
"""

from datetime import timedelta
import json
import os
from pathlib import Path
import platform
import statistics
import sys
from tempfile import TemporaryDirectory
import time
from urllib.parse import urlsplit

import psycopg
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "backend/tests")]

from app.repository import Repository
from test_postgres_integration import pg_client


def main():
    database = os.environ.get("STOCKCAST_TEST_DATABASE_URL", "")
    if urlsplit(database).path != "/stockcast_fixes_test":
        raise RuntimeError("Use the explicit isolated stockcast_fixes_test database")
    with pytest.MonkeyPatch.context() as patch, TemporaryDirectory() as directory:
        patch.setenv("OWNER_DATA_ORIGIN", "demo")
        patch.setenv("OWNER_BUSINESS_NAME", "Synthetic endpoint measurement")
        fixture = pg_client.__wrapped__(patch, Path(directory))
        client, business, dsn = next(fixture)
        try:
            with psycopg.connect(dsn) as conn:
                today = Repository(conn).business_day(business)
                conn.execute(
                    """INSERT INTO products
                       (business_id,sku,name,category,unit,current_stock,lead_time_days,safety_stock,unit_cost)
                       SELECT %s,'SYN-'||n,'Synthetic product '||n,'Synthetic','piece',50,2,2,10
                       FROM generate_series(1,100) AS n""",
                    (business,),
                )
                conn.execute(
                    """INSERT INTO sales(business_id,product_id,sale_date,quantity,source,data_origin)
                       SELECT p.business_id,p.id,%s::date-day_offset,5,'demo','demo'
                       FROM products p CROSS JOIN generate_series(0,364) AS day_offset
                       WHERE p.business_id=%s""",
                    (today, business),
                )
                count = conn.execute("SELECT count(*) AS count FROM sales").fetchone()["count"]
                assert count == 36_500

            base = f"/api/v1/businesses/{business}"
            output = {
                "provenance": "Synthetic demo-origin records in a new temporary PostgreSQL schema; no client data.",
                "transport": "Authenticated FastAPI TestClient, in-process ASGI plus real PostgreSQL; excludes real network and frontend rendering.",
                "python": platform.python_version(),
                "products": 100,
                "dailySalesRows": count,
                "historyStart": str(today - timedelta(days=364)),
                "historyEnd": str(today),
                "savedForecastRuns": 0,
                "warmupRequestsPerEndpoint": 1,
                "timing": {},
            }
            for endpoint in ("forecast-dashboard", "forecast-status"):
                warmup = client.get(base + "/" + endpoint)
                assert warmup.status_code == 200, warmup.text
                samples = []
                payload_bytes = []
                for _ in range(5):
                    started = time.perf_counter()
                    response = client.get(base + "/" + endpoint)
                    samples.append((time.perf_counter() - started) * 1000)
                    assert response.status_code == 200, response.text
                    payload_bytes.append(len(response.content))
                output["timing"][endpoint] = {
                    "milliseconds": samples,
                    "medianMs": statistics.median(samples),
                    "responseBytes": payload_bytes,
                }
            print(json.dumps(output, indent=2), flush=True)
        finally:
            try:
                next(fixture)
            except StopIteration:
                pass


if __name__ == "__main__":
    main()
