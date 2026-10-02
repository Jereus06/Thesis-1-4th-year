"""Read-only forecast/restock view. Every calculation runs in Python, including the baseline."""

from datetime import timedelta
from decimal import Decimal

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
    predictions, metrics = [], []
    if completed:
        predictions = [
            repository._prediction(row)
            for row in conn.execute(
                "SELECT * FROM forecast_predictions WHERE forecast_run_id=%s ORDER BY prediction_date,method",
                (completed["id"],),
            ).fetchall()
        ]
        metrics = repository.list_metrics(business_id, completed["id"])
    sales = conn.execute(
        """SELECT product_id,sale_date,sum(quantity) AS quantity FROM sales
           WHERE business_id=%s GROUP BY product_id,sale_date ORDER BY sale_date""",
        (business_id,),
    ).fetchall()
    end = max((row["sale_date"] for row in sales), default=repository.business_day(business_id))
    start = min((row["sale_date"] for row in sales), default=end)
    summaries = dict(completed["configuration"].get("products", {})) if completed else {}
    recommendations = []
    products = [product for product in repository.list_products(business_id) if product["isActive"]]
    stale = False
    if completed:
        changed = conn.execute(
            """SELECT EXISTS(SELECT 1 FROM sales WHERE business_id=%s AND created_at>%s)
               OR EXISTS(SELECT 1 FROM business_settings WHERE business_id=%s AND updated_at>%s)
               OR EXISTS(SELECT 1 FROM products WHERE business_id=%s AND updated_at>%s)
               OR EXISTS(SELECT 1 FROM sales_day_quality WHERE business_id=%s AND updated_at>%s)
               AS changed""",
            (
                business_id,
                completed["data_snapshot"].get("capturedAt", completed["created_at"]),
                business_id,
                completed["created_at"],
                business_id,
                completed["created_at"],
                business_id,
                completed["created_at"],
            ),
        ).fetchone()["changed"]
        stale = changed or {product["id"] for product in products} != set(
            completed["data_snapshot"].get("products", [])
        )
    for product in products:
        pid = product["id"]
        history = {
            row["sale_date"]: float(row["quantity"])
            for row in sales
            if str(row["product_id"]) == pid
        }
        if pid not in summaries:
            summaries[pid] = {
                "historyDays": (end - start).days + 1 if history else 0,
                "nonzeroDays": len(history),
                "eligible": False,
                "operatingMethod": "fallback",
                "fallbackReason": "Refresh forecasts to evaluate this product"
                if history
                else "No sales history; record or import sales",
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
                    "predictionDate": str(end + timedelta(days=index + 1)),
                    "method": "fallback",
                    "datasetSplit": "future",
                    "predictedQuantity": str(value),
                    "actualQuantity": None,
                    "lowerBound": None,
                    "upperBound": None,
                    "fallbackReason": summaries[pid]["fallbackReason"],
                }
                for index, value in enumerate(values)
            ]
            predictions.extend(future)
        method = summaries[pid]["operatingMethod"]
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
        daily = sum(selected, Decimal(0)) / len(selected) if selected else Decimal(0)
        calculation = calculate_reorder(
            current_stock=Decimal(product["currentStock"]),
            recent_quantity=daily,
            lookback_days=1,
            lead_time_days=product["leadTimeDays"],
            safety_stock=Decimal(product["safetyStock"]),
            target_cover_days=settings["targetCoverDays"],
        )
        recommendations.append(
            {
                "productId": pid,
                "method": method,
                "confidenceLevel": "low",
                **{
                    key: str(value) if isinstance(value, Decimal) else value
                    for key, value in calculation.items()
                },
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
        "message": "Python forecasts; model selection uses validation. Research accuracy is not yet certified.",
    }
