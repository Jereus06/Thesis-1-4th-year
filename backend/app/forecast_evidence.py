"""Describe saved forecast evidence without inventing confidence probabilities."""

from datetime import date
from decimal import Decimal, InvalidOperation


METHODS = ("moving_average", "xgboost", "ensemble")
CONFIDENCE_POLICY = "past_test_wape_v1"
MIN_CONFIDENCE_TEST_DAYS = 14


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
    test_errors = {}
    for item in metrics:
        key = (item["productId"], item["method"], item["datasetSplit"])
        metric_rows.setdefault(key, []).append(item)
    for point in predictions:
        if point["datasetSplit"] != "final_test":
            continue
        key = (point["productId"], point["method"])
        actuals = test_actuals.setdefault(key, {})
        errors = test_errors.setdefault(key, {})
        if actuals is None:
            continue
        day = point["predictionDate"]
        actual = _quantity(point["actualQuantity"])
        predicted = _quantity(point["predictedQuantity"])
        if day in actuals or actual is None or predicted is None:
            test_actuals[key] = None
            test_errors[key] = None
        else:
            actuals[day] = actual
            errors[day] = abs(predicted - actual)
    return metric_rows, test_actuals, test_errors


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


def forecast_confidence(*, product_id, method, evidence, evidence_index):
    """Disclosed app rating of past error; never a probability or model selector."""
    value = {
        "level": None, "reason": "", "testObservations": evidence["testObservations"],
        "relativeError": None, "policy": CONFIDENCE_POLICY,
    }
    state = evidence["status"]
    if state in {"needs_refresh", "expired", "unavailable"}:
        value["reason"] = {
            "needs_refresh": "Records changed. Refresh forecasts before using a confidence rating.",
            "expired": "The forecast period ended. Refresh forecasts for a current rating.",
            "unavailable": "There is no current sales estimate to rate.",
        }[state]
        return value
    value["level"] = "low"
    if state != "tested":
        value["reason"] = "No usable saved past test yet. Treat this estimate with care."
        return value
    tested_method = "moving_average" if method in {"fallback", "movingAverage"} else method
    actuals = evidence_index[1][(product_id, tested_method)]
    errors = evidence_index[2][(product_id, tested_method)]
    total = sum(actuals.values(), Decimal(0))
    ratio = sum(errors.values(), Decimal(0)) / total if total else None
    value["relativeError"] = str(ratio) if ratio is not None else None
    count = len(actuals)
    if count < MIN_CONFIDENCE_TEST_DAYS:
        value["reason"] = f"Only {count} past test days are available; at least 14 are needed for a stronger rating."
        return value
    try:
        dates = sorted(date.fromisoformat(day) for day in actuals)
        consecutive = (dates[-1] - dates[0]).days + 1 == count
    except ValueError:
        consecutive = False
    if not consecutive:
        value["reason"] = "The past test has gaps. At least 14 consecutive tested days are needed for a stronger rating."
    elif ratio is None:
        value["reason"] = "The past test contains no sales, so a relative-error rating is not available."
    elif ratio <= Decimal("0.20"):
        value["level"] = "high"
        value["reason"] = f"Low past error across {count} consecutive tested days."
    elif ratio <= Decimal("0.50"):
        value["level"] = "medium"
        value["reason"] = f"Moderate past error across {count} consecutive tested days."
    else:
        value["reason"] = f"Large past error across {count} consecutive tested days. Review the estimate before buying stock."
    return value


def training_scope(run):
    """Recover the actual ML selection from frozen inputs, never live sales."""
    if not run:
        return None
    snapshot = run["data_snapshot"]
    limit = snapshot.get("settings", {}).get("top_n_products")
    start, end = run.get("training_start"), run.get("training_end")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or not start or not end:
        return None
    selected = [
        pid for pid, summary in run["configuration"].get("products", {}).items()
        if summary.get("eligible") is True
    ]
    prepared = snapshot.get("preparedProducts", {})
    rows = []
    for pid in selected:
        targets = prepared.get(pid, {}).get("targets")
        if targets is None:
            return None
        quantities = []
        for point in targets:
            if str(start) <= point["day"] <= str(end):
                quantity = _quantity(point["quantity"])
                if quantity is None:
                    return None
                quantities.append(quantity)
        # Match the worker's float volume ordering, including its product-ID tie break.
        rows.append((pid, sum(map(float, quantities)), sum(quantities, Decimal(0))))
    rows.sort(key=lambda row: (-row[1], row[0]))
    if len(rows) > limit:
        return None
    return {
        "limit": limit, "trainingStart": str(start), "trainingEnd": str(end),
        "ranking": "training_sales_volume_v1",
        "products": [
            {"productId": pid, "rank": index + 1, "trainingQuantity": str(quantity)}
            for index, (pid, _volume, quantity) in enumerate(rows)
        ],
    }
