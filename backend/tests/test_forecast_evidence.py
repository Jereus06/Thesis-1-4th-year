"""Synthetic saved evidence, separate from client accuracy findings."""

from decimal import Decimal

import pytest

from app.forecast_evidence import METHODS, forecast_evidence, model_comparison


def metric(method="moving_average", *, pid="p1", count=2, split="final_test", mae="1", rmse="2"):
    return {
        "productId": pid, "method": method, "datasetSplit": split,
        "mae": mae, "rmse": rmse, "observationCount": count,
    }


def points(method="moving_average", *, pid="p1", count=2):
    return [{
        "productId": pid, "method": method, "datasetSplit": "final_test",
        "predictionDate": f"2026-10-{index + 1:02d}",
        "predictedQuantity": "3", "actualQuantity": "4",
    } for index in range(count)]


def evidence(**patch):
    options = {
        "product_id": "p1", "method": "fallback", "metrics": [metric()],
        "predictions": points(), "demand_available": True, "expired": False, "stale": False,
    }
    return forecast_evidence(**(options | patch))


@pytest.mark.parametrize("method", ["fallback", *METHODS])
def test_labels_use_selected_methods_saved_test_not_a_fixed_confidence(method):
    tested = "moving_average" if method == "fallback" else method
    value = evidence(method=method, metrics=[metric(tested)], predictions=points(tested))
    assert value == {"status": "tested", "testObservations": 2, "mae": "1", "rmse": "2"}
    assert "confidence" not in value


@pytest.mark.parametrize(("patch", "status"), [
    ({"metrics": []}, "basic"),
    ({"saved_forecast": False}, "basic"),
    ({"method": "xgboost", "metrics": []}, "untested"),
    ({"stale": True}, "needs_refresh"),
    ({"demand_available": False, "stale": True}, "unavailable"),
    ({"demand_available": False, "expired": True, "stale": True}, "expired"),
])
def test_evidence_states_prioritize_current_advice_and_do_not_relabel_old_results(patch, status):
    value = evidence(**patch)
    assert value["status"] == status
    if patch.get("saved_forecast") is False or patch.get("metrics") == []:
        assert value["mae"] is None and value["testObservations"] == 0
    else:
        assert value["testObservations"] == 2


@pytest.mark.parametrize("bad", ["NaN", "Infinity", "-1", None, ""])
def test_invalid_error_values_never_become_tested_labels(bad):
    value = evidence(metrics=[metric(mae=bad)])
    assert value["status"] == "basic" and value["mae"] is None


@pytest.mark.parametrize("bad", [0, -1, 2.5, True, "2"])
def test_invalid_metric_denominators_are_unavailable(bad):
    assert evidence(metrics=[metric(count=bad)])["status"] == "basic"


def test_duplicate_missing_and_wrong_method_test_rows_are_not_usable_evidence():
    for predictions in [points(count=1), [points()[0], points()[0]], points("xgboost")]:
        assert evidence(predictions=predictions)["status"] == "basic"
    invalid = points()
    invalid[0]["actualQuantity"] = None
    assert evidence(predictions=invalid)["status"] == "basic"
    assert evidence(metrics=[metric(), metric()])["status"] == "basic"


def test_comparison_weights_errors_on_identical_products_and_dates():
    metrics = [metric(method) for method in METHODS]
    predictions = [point for method in METHODS for point in points(method)]
    metrics += [metric(method, pid="p2", count=1, mae="7", rmse="4") for method in METHODS]
    predictions += [point for method in METHODS for point in points(method, pid="p2", count=1)]
    metrics += [metric(method, split="validation", mae="10", rmse="11") for method in METHODS]
    value = model_comparison(
        metrics, predictions, {"p1": {"eligible": True}, "p2": {"eligible": True}},
        {"p1", "p2"}, product_units={"p1": "piece", "p2": "piece"},
    )
    final = value["finalTest"]
    assert final["productIds"] == ["p1", "p2"] and final["observationCount"] == 3
    for score in final["scores"].values():
        assert Decimal(score["mae"]) == 3
        assert float(score["rmse"]) == pytest.approx(8 ** 0.5)
    assert value["validation"]["productIds"] == ["p1"]
    assert value["validation"]["scores"]["xgboost"]["mae"] == "10"


@pytest.mark.parametrize("problem", ["missing_method", "different_count", "different_dates", "different_actual", "duplicate_date"])
def test_incomparable_model_results_are_withheld(problem):
    metrics = [metric(method) for method in METHODS]
    predictions = [point for method in METHODS for point in points(method)]
    if problem == "missing_method":
        metrics.pop()
    elif problem == "different_count":
        metrics[1]["observationCount"] = 1
    elif problem == "different_dates":
        predictions[-1]["predictionDate"] = "2026-10-03"
    elif problem == "different_actual":
        predictions[-1]["actualQuantity"] = "99"
    else:
        predictions[-1]["predictionDate"] = predictions[-2]["predictionDate"]
    value = model_comparison(
        metrics, predictions, {"p1": {"eligible": True}}, {"p1"},
        product_units={"p1": "piece"},
    )
    assert value["finalTest"] == {"productIds": [], "observationCount": 0, "scores": {}}


def test_fallbacks_have_their_own_scores_and_inactive_products_cannot_enter_a_comparison():
    metrics = [metric(), metric(pid="archived", mae="99")]
    predictions = points() + points(pid="archived")
    value = model_comparison(
        metrics, predictions, {}, {"p1"}, product_units={"p1": "piece", "archived": "litre"},
    )["finalTest"]
    assert value["productIds"] == ["p1"]
    assert set(value["scores"]) == {"moving_average"}
    assert value["scores"]["moving_average"]["mae"] == "1"


@pytest.mark.parametrize("ml", [False, True])
@pytest.mark.parametrize("second_unit,pooled", [("litre", False), ("", False), (" Piece ", True)])
def test_overall_scores_require_matching_units_and_preserve_product_scores(ml, second_unit, pooled):
    methods = METHODS if ml else ("moving_average",)
    metrics = [
        metric(method, pid=pid, count=1, split=split, mae=error, rmse=error)
        for pid, error in (("p1", "1"), ("p2", "100"))
        for method in methods for split in ("validation", "final_test")
    ]
    predictions = [
        point for pid in ("p1", "p2") for method in methods
        for point in points(method, pid=pid, count=1)
    ]
    value = model_comparison(
        metrics, predictions, {pid: {"eligible": ml} for pid in ("p1", "p2")},
        {"p1", "p2"}, product_units={"p1": "piece", "p2": second_unit},
    )
    for split in value.values():
        assert split["productIds"] == ["p1", "p2"]
        assert split["observationCount"] == 2
        if pooled:
            assert Decimal(split["scores"][methods[0]]["mae"]) == Decimal("50.5")
        else:
            assert split["scores"] == {}
    assert evidence(
        product_id="p2", method=methods[0], metrics=metrics, predictions=predictions,
    )["mae"] == "100"


def test_an_unmatched_product_with_another_unit_does_not_block_comparable_scores():
    metrics = [metric(method) for method in METHODS] + [metric(pid="p2", mae="100")]
    predictions = [point for method in METHODS for point in points(method)] + points(pid="p2")
    value = model_comparison(
        metrics, predictions, {pid: {"eligible": True} for pid in ("p1", "p2")},
        {"p1", "p2"}, product_units={"p1": "piece", "p2": "litre"},
    )["finalTest"]
    assert value["productIds"] == ["p1"]
    assert value["scores"]["moving_average"]["mae"] == "1"
