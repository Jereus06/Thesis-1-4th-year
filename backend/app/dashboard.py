"""Read-only saved forecasts and conservative pre-refresh baselines."""

from datetime import date, timedelta
from decimal import Decimal

from .data_quality import (
    FALLBACK_POLICY_VERSION,
    POLICY_VERSION,
    contiguous_tail,
    prepare_product_series,
    usable_history_bounds,
)
from .forecasting import moving_average
from .inventory import calculate_reorder


def dashboard(repository, business_id, *, forecast_schedule=None):
    conn = repository.conn
    settings = repository.get_settings(business_id)
    today = repository.business_day(business_id)
    today_text = str(today)
    latest = repository.list_forecast_runs(business_id, 1, 0)
    completed = conn.execute(
        """SELECT * FROM forecast_runs WHERE business_id=%s AND status='completed'
        ORDER BY completed_at DESC,id DESC LIMIT 1""",
        (business_id,),
    ).fetchone()
    run = repository._forecast_run(completed) if completed else None
    forecast_through = (
        completed["final_test_end"] + timedelta(days=completed["forecast_horizon_days"])
        if completed
        else None
    )
    predictions = (
        [
            repository._prediction(row)
            for row in conn.execute(
                "SELECT * FROM forecast_predictions WHERE forecast_run_id=%s ORDER BY prediction_date,method",
                (completed["id"],),
            ).fetchall()
        ]
        if completed
        else []
    )
    metrics = repository.list_metrics(business_id, completed["id"]) if completed else []
    sales = conn.execute(
        """SELECT product_id,sale_date,sum(quantity) AS quantity FROM sales
        WHERE business_id=%s GROUP BY product_id,sale_date ORDER BY sale_date""",
        (business_id,),
    ).fetchall()
    quality = conn.execute(
        """SELECT product_id,classification_date,classification,note
        FROM sales_day_quality WHERE business_id=%s ORDER BY classification_date""",
        (business_id,),
    ).fetchall()
    summaries = dict(completed["configuration"].get("products", {})) if completed else {}
    legacy_baselines = set()
    if completed and completed["configuration"].get("fallbackPolicy") != FALLBACK_POLICY_VERSION:
        legacy_baselines = {
            pid for pid, summary in summaries.items()
            if summary.get("operatingMethod") == "fallback"
        }
        # Keep historical rows intact, but do not serve baselines computed with
        # compressed calendars/global origins. Use the conservative preview until
        # Refresh produces a run with the current policy and new test evidence.
        predictions = [point for point in predictions if point["productId"] not in legacy_baselines]
        metrics = [metric for metric in metrics if metric["productId"] not in legacy_baselines]
        summaries = {pid: summary for pid, summary in summaries.items() if pid not in legacy_baselines}
    products = [product for product in repository.list_products(business_id) if product["isActive"]]
    stale = False
    if completed:
        captured = completed["data_snapshot"].get("capturedAt", completed["created_at"])
        changed = conn.execute(
            """SELECT EXISTS(SELECT 1 FROM sales WHERE business_id=%s AND created_at>%s)
               OR EXISTS(SELECT 1 FROM business_settings WHERE business_id=%s AND updated_at>%s)
               OR EXISTS(SELECT 1 FROM products WHERE business_id=%s AND updated_at>%s)
               OR EXISTS(SELECT 1 FROM sales_day_quality WHERE business_id=%s AND updated_at>%s)
               OR EXISTS(SELECT 1 FROM sales_day_quality_audit WHERE business_id=%s AND changed_at>%s)
               AS changed""",
            (
                business_id,
                captured,
                business_id,
                captured,
                business_id,
                captured,
                business_id,
                captured,
                business_id,
                captured,
            ),
        ).fetchone()["changed"]
        stale = bool(legacy_baselines) or changed or {p["id"] for p in products} != set(
            completed["data_snapshot"].get("products", [])
        )

    recommendations = []
    quality_payload = [
        {
            "productId": str(row["product_id"]) if row["product_id"] else None,
            "date": str(row["classification_date"]),
            "classification": row["classification"],
            "note": row["note"],
        }
        for row in quality
    ]
    product_ids = {product["id"] for product in products}
    _first_usable, last_usable = usable_history_bounds(
        sales, quality_payload, product_ids, through=today,
    )
    end = last_usable or today
    evidence_dates = {
        row["sale_date"] for row in sales
        if str(row["product_id"]) in product_ids and row["sale_date"] <= today
    }
    evidence_dates.update(
        date.fromisoformat(item["date"]) for item in quality_payload
        if item["date"] <= today_text
        and (item["productId"] is None or item["productId"] in product_ids)
    )
    start = min(evidence_dates, default=today)
    for product in products:
        pid = product["id"]
        rows = [
            {"product_id": pid, "sale_date": row["sale_date"], "quantity": row["quantity"]}
            for row in sales
            if str(row["product_id"]) == pid
        ]
        # Diagnostics include trailing unknown/excluded days without turning them
        # into targets or moving the product's actual forecast cutoff to today.
        prepared = prepare_product_series(rows, quality_payload, pid, start, today)
        first_product_day, last_product_day = usable_history_bounds(
            rows, quality_payload, [pid], through=today, start=start,
        )
        if pid not in summaries:
            summaries[pid] = {
                "historyDays": len(prepared.days),
                "nonzeroDays": sum(d.quantity > 0 for d in prepared.days),
                "eligible": False,
                "operatingMethod": "fallback",
                "qualityWarnings": [w.message for w in prepared.warnings],
                "unknownDays": len(prepared.unknown_dates),
                "excludedDays": len(prepared.excluded_dates),
                "preparationPolicyVersion": POLICY_VERSION,
                "firstUsableDate": str(first_product_day) if first_product_day else None,
                "lastUsableDate": str(last_product_day) if last_product_day else None,
                "fallbackReason": "Refresh forecasts to evaluate this product"
                if prepared.days
                else "No usable sales history; review missing dates and classifications",
            }
            if pid in legacy_baselines:
                summaries[pid]["fallbackReason"] = (
                    "Saved baseline uses an older calendar policy; refresh forecasts. "
                    "Current preview uses this product's contiguous usable history."
                )
        future = [
            point
            for point in predictions
            if point["productId"] == pid and point["datasetSplit"] == "future"
        ]
        history = contiguous_tail(prepared.targets, last_product_day) if last_product_day else []
        if not future and history:
            window = settings["movingAverageWindow"]
            quantities = [item.quantity for item in history[-window:]]
            values = moving_average(quantities, settings["forecastHorizonDays"], window)
            future = [
                {
                    "productId": pid,
                    "predictionDate": str(last_product_day + timedelta(days=i + 1)),
                    "method": "fallback",
                    "datasetSplit": "future",
                    "predictedQuantity": str(value),
                    "actualQuantity": None,
                    "lowerBound": None,
                    "upperBound": None,
                    "fallbackReason": summaries[pid]["fallbackReason"],
                }
                for i, value in enumerate(values)
            ]
            predictions.extend(future)
            if not completed:
                product_through = last_product_day + timedelta(days=settings["forecastHorizonDays"])
                forecast_through = max(forecast_through, product_through) if forecast_through else product_through
        product_forecast_through = max(
            (point["predictionDate"] for point in future), default=None
        )
        forecast_expired = (
            product_forecast_through is not None and product_forecast_through < today_text
        )
        # Keep saved dates fixed: old predictions never become a newly dated baseline.
        future = [point for point in future if point["predictionDate"] >= today_text]
        method = summaries[pid].get("operatingMethod", "fallback")
        method = "moving_average" if method == "movingAverage" else method
        selected = [
            Decimal(point["predictedQuantity"]) for point in future if point["method"] == method
        ]
        if not selected:
            selected = [
                Decimal(point["predictedQuantity"])
                for point in future
                if point["method"] in {"fallback", "moving_average"}
            ]
            method = "fallback"
        demand_available = bool(selected)
        if demand_available:
            daily = sum(selected, Decimal(0)) / len(selected)
            calculation = calculate_reorder(
                current_stock=Decimal(product["currentStock"]),
                recent_quantity=daily,
                lookback_days=1,
                lead_time_days=product["leadTimeDays"],
                safety_stock=Decimal(product["safetyStock"]),
                target_cover_days=settings["targetCoverDays"],
            )
            serialized = {
                key: str(value) if isinstance(value, Decimal) else value
                for key, value in calculation.items()
            }
        else:
            serialized = {
                "daily_demand": None,
                "demand_during_lead_time": None,
                "reorder_point": None,
                "target_stock": None,
                "suggested_quantity": "0",
                "days_of_cover": None,
                "status": "stockout" if Decimal(product["currentStock"]) == 0 else "healthy",
            }
        recommendations.append(
            {
                "productId": pid,
                "method": method,
                "confidenceLevel": "low",
                "demandAvailable": demand_available,
                "forecastExpired": forecast_expired,
                "unavailableReason": (
                    None
                    if demand_available
                    else f"Forecast expired after {product_forecast_through}; refresh forecasts."
                    if forecast_expired
                    else summaries[pid].get("fallbackReason")
                    or "No usable current predictions; review sales history and refresh forecasts."
                ),
                **serialized,
            }
        )
    result = {
        "run": run,
        "stale": stale,
        "expired": forecast_through is not None and forecast_through < today,
        "forecastThrough": str(forecast_through) if forecast_through else None,
        "businessDay": today_text,
        "businessTimezone": settings["timezone"],
        "latestRun": latest[0] if latest else None,
        "predictions": [
            point
            for point in predictions
            if point["datasetSplit"] != "future" or point["predictionDate"] >= today_text
        ],
        "metrics": metrics,
        "summaries": summaries,
        "recommendations": recommendations,
        "asOf": str(end),
        "message": "Python forecasts use explicit day classifications; unavailable demand is not replaced with zero.",
    }
    if forecast_schedule is not None:
        result["forecastSchedule"] = {**forecast_schedule, "timezone": settings["timezone"]}
    return result
