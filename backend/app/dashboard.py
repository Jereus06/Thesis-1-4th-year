"""Read-only saved forecasts and conservative pre-refresh baselines."""

from datetime import timedelta
from decimal import Decimal

from .data_quality import POLICY_VERSION, contiguous_tail, prepare_product_series
from .forecasting import moving_average
from .inventory import calculate_reorder


def dashboard(repository, business_id):
    conn = repository.conn
    settings = repository.get_settings(business_id)
    latest = repository.list_forecast_runs(business_id, 1, 0)
    completed = conn.execute(
        """SELECT * FROM forecast_runs WHERE business_id=%s AND status='completed'
        ORDER BY completed_at DESC,id DESC LIMIT 1""",
        (business_id,),
    ).fetchone()
    run = repository._forecast_run(completed) if completed else None
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
    end = max((row["sale_date"] for row in sales), default=repository.business_day(business_id))
    start = min((row["sale_date"] for row in sales), default=end)
    summaries = dict(completed["configuration"].get("products", {})) if completed else {}
    products = [product for product in repository.list_products(business_id) if product["isActive"]]
    stale = False
    if completed:
        captured = completed["data_snapshot"].get("capturedAt", completed["created_at"])
        changed = conn.execute(
            """SELECT EXISTS(SELECT 1 FROM sales WHERE business_id=%s AND created_at>%s)
               OR EXISTS(SELECT 1 FROM business_settings WHERE business_id=%s AND updated_at>%s)
               OR EXISTS(SELECT 1 FROM products WHERE business_id=%s AND updated_at>%s)
               OR EXISTS(SELECT 1 FROM sales_day_quality WHERE business_id=%s AND updated_at>%s)
               AS changed""",
            (
                business_id,
                captured,
                business_id,
                completed["created_at"],
                business_id,
                completed["created_at"],
                business_id,
                completed["created_at"],
            ),
        ).fetchone()["changed"]
        stale = changed or {p["id"] for p in products} != set(
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
    for product in products:
        pid = product["id"]
        rows = [
            {"sale_date": row["sale_date"], "quantity": row["quantity"]}
            for row in sales
            if str(row["product_id"]) == pid
        ]
        prepared = prepare_product_series(rows, quality_payload, pid, start, end)
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
                "fallbackReason": "Refresh forecasts to evaluate this product"
                if prepared.days
                else "No usable sales history; review missing dates and classifications",
            }
        future = [
            point
            for point in predictions
            if point["productId"] == pid and point["datasetSplit"] == "future"
        ]
        if not future and history:
            window = settings["movingAverageWindow"]
            quantities = [
                history.get(end - timedelta(days=window - index - 1), 0.0)
                for index in range(window)
            ]
            values = moving_average(quantities, settings["forecastHorizonDays"], window)
            future = [
                {
                    "productId": pid,
                    "predictionDate": str(end + timedelta(days=i + 1)),
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
                "unavailableReason": None if demand_available else summaries[pid]["fallbackReason"],
                **serialized,
            }
        )
    return {
        "run": run,
        "stale": stale,
        "latestRun": latest[0] if latest else None,
        "predictions": predictions,
        "metrics": metrics,
        "summaries": summaries,
        "recommendations": recommendations,
        "asOf": str(end),
        "message": "Python forecasts use explicit day classifications; unavailable demand is not replaced with zero.",
    }
