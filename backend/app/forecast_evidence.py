"""Describe saved forecast evidence without inventing confidence probabilities."""

from decimal import Decimal, InvalidOperation


METHODS = ("moving_average", "xgboost", "ensemble")


def _quantity(value):
    try:
        number = Decimal(str(value))
        return number if number.is_finite() and number >= 0 else None
    except InvalidOperation:
        return None


def index_forecast_evidence(metrics, predictions):
    """One pass over saved rows; dashboard reads never train or score a model."""
    metric_rows = {}
    test_actuals = {}
    for item in metrics:
        key = (item["productId"], item["method"], item["datasetSplit"])
        metric_rows.setdefault(key, []).append(item)
    for point in predictions:
        if point["datasetSplit"] != "final_test":
            continue
        key = (point["productId"], point["method"])
        actuals = test_actuals.setdefault(key, {})
        if actuals is None:
            continue
        day = point["predictionDate"]
        actual = _quantity(point["actualQuantity"])
        if day in actuals or actual is None or _quantity(point["predictedQuantity"]) is None:
            test_actuals[key] = None
        else:
            actuals[day] = actual
    return metric_rows, test_actuals


def _metric(index, product_id, method, split):
    matches = index[0].get((product_id, method, split), [])
    if len(matches) != 1:
        return None
    item = matches[0]
    count = item["observationCount"]
    if isinstance(count, bool) or not isinstance(count, int) or count <= 0:
        return None
    if any(_quantity(item[field]) is None for field in ("mae", "rmse")):
        return None
    return item


def verified_test_metric(index, product_id, method):
    # Fallback predictions are Moving Average, not a separate tested model.
    method = "moving_average" if method in {"fallback", "movingAverage"} else method
    metric = _metric(index, product_id, method, "final_test")
    actuals = index[1].get((product_id, method))
    if metric is None or actuals is None or len(actuals) != metric["observationCount"]:
        return None
    return metric


def forecast_evidence(
    *, product_id, method, metrics, predictions, demand_available, expired, stale,
    saved_forecast=True, evidence_index=None,
):
    # A newly generated preview must not inherit an older model's test results.
    index = evidence_index if evidence_index is not None else index_forecast_evidence(metrics, predictions)
    metric = verified_test_metric(index, product_id, method) if saved_forecast else None
    status = (
        "expired" if expired else "unavailable" if not demand_available
        else "needs_refresh" if stale else "tested" if metric
        else "basic" if method in {"fallback", "moving_average", "movingAverage"}
        else "untested"
    )
    return {
        "status": status,
        "testObservations": metric["observationCount"] if metric else 0,
        "mae": metric["mae"] if metric else None,
        "rmse": metric["rmse"] if metric else None,
    }


def model_comparison(metrics, predictions, summaries, product_ids, *, evidence_index=None):
    """Pool only methods evaluated on matching products and observations."""
    ml_ids = sorted(pid for pid in product_ids if summaries.get(pid, {}).get("eligible"))
    methods = METHODS if ml_ids else ("moving_average",)
    candidates = ml_ids or sorted(product_ids)
    index = evidence_index if evidence_index is not None else index_forecast_evidence(metrics, predictions)

    def comparison(split):
        included = []
        rows = {method: [] for method in methods}
        for pid in candidates:
            group = {method: _metric(index, pid, method, split) for method in methods}
            if any(item is None for item in group.values()):
                continue
            if len({item["observationCount"] for item in group.values()}) != 1:
                continue
            if split == "final_test":
                actuals = [index[1].get((pid, method)) for method in methods]
                count = group[methods[0]]["observationCount"]
                if any(item is None or len(item) != count or item != actuals[0] for item in actuals):
                    continue
            included.append(pid)
            for method in methods:
                rows[method].append(group[method])
        count = sum(item["observationCount"] for item in rows[methods[0]])
        scores = {}
        if count:
            for method, items in rows.items():
                mae = sum(Decimal(item["mae"]) * item["observationCount"] for item in items) / count
                mse = sum(Decimal(item["rmse"]) ** 2 * item["observationCount"] for item in items) / count
                scores[method] = {"mae": str(mae), "rmse": str(mse.sqrt())}
        return {"productIds": included, "observationCount": count, "scores": scores}

    return {"validation": comparison("validation"), "finalTest": comparison("final_test")}
