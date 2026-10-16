"""Synthetic preparation benchmark; run with the backend's Python dependencies.

    python scripts/benchmark-forecast-dashboard.py

This uses no database or HTTP transport. The baseline reconstructs the previous
repeated sales/quality/prediction scans while retaining current output semantics.
It does not represent client records, model accuracy, or end-to-end API latency.
"""

import inspect
import json
from pathlib import Path
import statistics
import sys
import time
from datetime import date, timedelta
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "backend/tests")]

from app.dashboard import dashboard  # noqa: E402
from test_dashboard import FakeRepository  # noqa: E402


def repeated_scan_baseline():
    source = inspect.getsource(dashboard)
    first = source.index("    sales_by_product =")
    last = source.index("    evidence_dates =", first)
    source = source[:first] + """    _first_usable, last_usable = usable_history_bounds(
        sales, quality_payload, product_ids, through=today,
    )
    end = last_usable or today
""" + source[last:]
    replacements = {
        "    last_usable = None\n": "",
        "        rows = sales_by_product[pid]\n        product_quality = storewide_quality + quality_by_product[pid]\n": """        rows = [
            {"product_id": pid, "sale_date": row["sale_date"], "quantity": row["quantity"]}
            for row in sales if str(row["product_id"]) == pid
        ]
""",
        "prepare_product_series(rows, product_quality,": "prepare_product_series(rows, quality_payload,",
        "rows, product_quality, [pid]": "rows, quality_payload, [pid]",
        "        if last_product_day is not None:\n            last_usable = max(last_usable, last_product_day) if last_usable else last_product_day\n": "",
        "        future = future_by_product[pid]\n": """        future = [point for point in predictions
                  if point["productId"] == pid and point["datasetSplit"] == "future"]
""",
        '"asOf": str(last_usable or today)': '"asOf": str(end)',
    }
    for current, previous in replacements.items():
        if current not in source:
            raise RuntimeError("Dashboard changed; review the reconstructed benchmark baseline.")
        source = source.replace(current, previous)
    namespace = dict(dashboard.__globals__)
    exec(compile(source, "<reconstructed-dashboard-baseline>", "exec"), namespace)
    return namespace["dashboard"]


def main():
    repository = FakeRepository(today=date(2026, 10, 15), completed=False, sales=[])
    repository.products = [
        dict(repository.products[0], id=f"p-{index}", unit="piece") for index in range(100)
    ]
    start = repository.today - timedelta(days=364)
    repository.sales = [
        {"product_id": product["id"], "sale_date": start + timedelta(days=offset), "quantity": Decimal("5")}
        for product in repository.products for offset in range(365)
    ]
    repository.quality = [
        {"product_id": None, "classification_date": start + timedelta(days=3),
         "classification": "business_closed", "note": "Synthetic closure"},
        {"product_id": "p-0", "classification_date": repository.today,
         "classification": "incomplete", "note": "Synthetic review"},
    ]
    results, timing = {}, {}
    for label, function in [("reconstructedBefore", repeated_scan_baseline()), ("after", dashboard)]:
        samples = []
        for _ in range(5):
            began = time.perf_counter()
            results[label] = function(repository, "synthetic-business")
            samples.append((time.perf_counter() - began) * 1000)
        timing[label] = {"milliseconds": samples, "medianMs": statistics.median(samples)}
    assert results["reconstructedBefore"] == results["after"], "Benchmark response changed"
    print(json.dumps({
        "provenance": "Synthetic in-memory repository; reconstructed prior scanning; excludes PostgreSQL and HTTP.",
        "products": len(repository.products), "dailySalesRows": len(repository.sales),
        "timing": timing, "identicalResponses": True,
        "dashboardPayloadBytes": len(json.dumps(results["after"]).encode()),
        "statusPayloadBytes": len(json.dumps({"revision": "0" * 64}).encode()),
    }, indent=2))


if __name__ == "__main__":
    main()
