"""Synthetic confidence boundaries and frozen training selections, not client findings."""

from datetime import date, timedelta
from decimal import Decimal
import unittest

from app.forecast_evidence import (
    forecast_confidence, forecast_evidence, index_forecast_evidence, training_scope,
)


def rating(*, actual="100", predicted="110", count=14, gap=False, **states):
    points = [{
        "productId": "p", "method": "moving_average", "datasetSplit": "final_test",
        "predictionDate": str(date(2026, 1, 1) + timedelta(days=i + (1 if gap and i == count - 1 else 0))),
        "actualQuantity": actual, "predictedQuantity": predicted,
    } for i in range(count)]
    metric = {
        "productId": "p", "method": "moving_average", "datasetSplit": "final_test",
        "observationCount": count, "mae": str(abs(Decimal(predicted) - Decimal(actual))),
        "rmse": str(abs(Decimal(predicted) - Decimal(actual))),
    }
    index = index_forecast_evidence([metric], points)
    evidence = forecast_evidence(
        product_id="p", method="fallback", metrics=[metric], predictions=points,
        demand_available=states.get("demand_available", True),
        expired=states.get("expired", False), stale=states.get("stale", False),
        saved_forecast=states.get("saved_forecast", True), evidence_index=index,
    )
    return forecast_confidence(product_id="p", method="fallback", evidence=evidence, evidence_index=index)


class ForecastConfidenceTests(unittest.TestCase):
    def test_high_medium_low_follow_past_errors_instead_of_history_size(self):
        for predicted, level in [("110", "high"), ("130", "medium"), ("200", "low")]:
            with self.subTest(predicted=predicted):
                value = rating(predicted=predicted)
                self.assertEqual(value["level"], level)
                self.assertEqual(value["testObservations"], 14)
                self.assertEqual(value["policy"], "past_test_wape_v1")

    def test_error_boundaries_are_explicit_and_inclusive(self):
        for predicted, level in [
            ("120", "high"), ("120.0001", "medium"),
            ("150", "medium"), ("150.0001", "low"),
        ]:
            with self.subTest(predicted=predicted):
                self.assertEqual(rating(predicted=predicted)["level"], level)

    def test_low_sales_volume_can_have_high_confidence(self):
        value = rating(actual="2", predicted="2.2")
        self.assertEqual(value["level"], "high")
        self.assertEqual(Decimal(value["relativeError"]), Decimal("0.1"))

    def test_short_or_gapped_tests_never_get_strong_ratings(self):
        self.assertEqual(rating(count=13, predicted="100")["level"], "low")
        self.assertEqual(rating(gap=True, predicted="100")["level"], "low")
        self.assertEqual(rating(count=14, predicted="100")["level"], "high")

    def test_zero_actual_sales_do_not_produce_perfect_confidence(self):
        value = rating(actual="0", predicted="0")
        self.assertEqual(value["level"], "low")
        self.assertIsNone(value["relativeError"])
        self.assertIn("no sales", value["reason"])

    def test_negative_and_positive_errors_cannot_cancel(self):
        points = [{
            "productId": "p", "method": "xgboost", "datasetSplit": "final_test",
            "predictionDate": str(date(2026, 1, 1) + timedelta(days=i)),
            "actualQuantity": "100", "predictedQuantity": "0" if i % 2 else "200",
        } for i in range(14)]
        metric = {"productId": "p", "method": "xgboost", "datasetSplit": "final_test",
                  "mae": "100", "rmse": "100", "observationCount": 14}
        index = index_forecast_evidence([metric], points)
        evidence = {"status": "tested", "testObservations": 14, "mae": "100", "rmse": "100"}
        value = forecast_confidence(product_id="p", method="xgboost", evidence=evidence, evidence_index=index)
        self.assertEqual(value["level"], "low")
        self.assertEqual(Decimal(value["relativeError"]), 1)

    def test_current_advice_gates_withhold_old_confidence(self):
        for state in [{"stale": True}, {"expired": True}, {"demand_available": False}]:
            with self.subTest(state=state):
                value = rating(**state)
                self.assertIsNone(value["level"])
                self.assertIsNone(value["relativeError"])
                self.assertEqual(value["testObservations"], 14)

    def test_a_new_preview_cannot_inherit_an_old_high_rating(self):
        value = rating(saved_forecast=False)
        self.assertEqual(value["level"], "low")
        self.assertIsNone(value["relativeError"])
        self.assertEqual(value["testObservations"], 0)


def frozen_run():
    return {
        "training_start": date(2026, 1, 1), "training_end": date(2026, 1, 2),
        "configuration": {"products": {
            "a": {"eligible": True}, "b": {"eligible": True},
            "huge-ineligible": {"eligible": False},
        }},
        "data_snapshot": {
            "settings": {"top_n_products": 5},
            "preparedProducts": {
                "a": {"targets": [{"day": "2026-01-01", "quantity": "10"}]},
                "b": {"targets": [
                    {"day": "2026-01-02", "quantity": "20"},
                    {"day": "2026-01-03", "quantity": "999999"},
                ]},
                "huge-ineligible": {"targets": [{"day": "2026-01-01", "quantity": "9999999"}]},
            },
        },
    }


class TrainingScopeTests(unittest.TestCase):
    def test_only_chosen_products_and_training_dates_enter_the_list(self):
        run = frozen_run()
        value = training_scope(run)
        self.assertEqual(value["limit"], 5)
        self.assertEqual(value["products"], [
            {"productId": "b", "rank": 1, "trainingQuantity": "20"},
            {"productId": "a", "rank": 2, "trainingQuantity": "10"},
        ])
        self.assertEqual(len(run["data_snapshot"]["preparedProducts"]["b"]["targets"]), 2)

    def test_ties_follow_worker_product_id_order(self):
        run = frozen_run()
        run["data_snapshot"]["preparedProducts"]["a"]["targets"][0]["quantity"] = "20"
        self.assertEqual([p["productId"] for p in training_scope(run)["products"]], ["a", "b"])

    def test_empty_selection_is_distinct_from_unavailable_metadata(self):
        run = frozen_run()
        for summary in run["configuration"]["products"].values():
            summary["eligible"] = False
        self.assertEqual(training_scope(run)["products"], [])
        self.assertIsNone(training_scope(None))
        self.assertIsNone(training_scope({**run, "training_start": None}))

    def test_unrecoverable_legacy_metadata_does_not_invent_ranks(self):
        run = frozen_run()
        del run["data_snapshot"]["preparedProducts"]["b"]
        self.assertIsNone(training_scope(run))

    def test_saved_limit_is_validated_and_never_silently_expanded(self):
        for limit in [0, True, "5", 1]:
            with self.subTest(limit=limit):
                run = frozen_run()
                run["data_snapshot"]["settings"]["top_n_products"] = limit
                self.assertIsNone(training_scope(run))


if __name__ == "__main__":
    unittest.main()
