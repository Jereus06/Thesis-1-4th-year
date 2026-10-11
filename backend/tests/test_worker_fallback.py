"""Fallbacks retain product dates and never compress unknown calendar days."""

from contextlib import contextmanager
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app import worker


class SavedResults:
    def __init__(self):
        self.predictions = []
        self.metrics = []
        self.configuration = None

    @contextmanager
    def transaction(self):
        yield

    def execute(self, statement, parameters):
        if "INSERT INTO forecast_predictions" in statement:
            split = "future" if "'future'" in statement else "final_test"
            self.predictions.append((split, parameters))
        elif "INSERT INTO forecast_metrics" in statement:
            self.metrics.append(parameters)
        elif "algorithm_version=%s,configuration=%s" in statement:
            self.configuration = parameters[1].obj


def fallback_run(products, validation_end="2025-01-02", final_test_end="2025-01-05"):
    return {
        "id": "00000000-0000-4000-8000-000000000071",
        "business_id": "00000000-0000-4000-8000-000000000072",
        "training_start": date(2025, 1, 1),
        "training_end": date(2025, 1, 1),
        "validation_end": date.fromisoformat(validation_end),
        "final_test_end": date.fromisoformat(final_test_end),
        "forecast_horizon_days": 2,
        "created_at": datetime(2025, 1, 1, tzinfo=timezone.utc),
        "started_at": datetime(2025, 1, 1, tzinfo=timezone.utc),
        "configuration": {},
        "data_snapshot": {
            "dailySales": [],
            "products": list(products),
            "settings": {
                "minimum_history_weeks": 8, "minimum_nonzero_days": 100,
                "top_n_products": 8, "moving_average_window": 2, "cv_folds": 3,
            },
            "preparedProducts": {
                pid: {"targets": [{"day": day, "quantity": quantity} for day, quantity in rows]}
                for pid, rows in products.items()
            },
        },
    }


def process(monkeypatch, tmp_path, run):
    monkeypatch.setattr(worker, "get_settings", lambda: SimpleNamespace(artifact_dir=tmp_path))
    saved = SavedResults()
    worker.process_run(saved, run)
    return saved


def points(saved, product, split):
    return [(str(row[3]), float(row[5])) for kind, row in saved.predictions
            if kind == split and row[2] == product]


def test_old_product_keeps_its_own_forecast_origin_after_other_product_updates(monkeypatch, tmp_path):
    run = fallback_run({
        "old": [("2025-01-01", 100), ("2025-01-03", 4)],
        "new": [("2025-01-31", 20)],
    }, validation_end="2025-01-30", final_test_end="2025-01-31")
    saved = process(monkeypatch, tmp_path, run)
    assert points(saved, "old", "future") == [("2025-01-04", 4), ("2025-01-05", 4)]
    assert points(saved, "new", "future") == [("2025-02-01", 20), ("2025-02-02", 20)]
    summary = saved.configuration["products"]["old"]
    assert summary["lastUsableDate"] == summary["forecastOriginDate"] == "2025-01-03"


def test_sparse_final_test_scores_actual_calendar_positions_without_filling_targets(monkeypatch, tmp_path):
    saved = process(monkeypatch, tmp_path, fallback_run({"product": [
        ("2025-01-01", 100), ("2025-01-02", 4),
        ("2025-01-03", 60), ("2025-01-05", 8),
    ]}))
    # Jan 4 is an unscored recursive step: 52, 28, 40, rather than two adjacent targets.
    assert points(saved, "product", "final_test") == [("2025-01-03", 52), ("2025-01-05", 40)]
    assert len(saved.metrics) == 1
    assert float(saved.metrics[0][5]) == 20  # (8 + 32) / 2 MAE.
    assert saved.metrics[0][7] == 2
    assert points(saved, "product", "future") == [("2025-01-06", 8), ("2025-01-07", 8)]


@pytest.mark.parametrize("history", [[], [("2025-01-01", 100)]])
def test_final_test_without_usable_cutoff_has_no_manufactured_zero_metrics(monkeypatch, tmp_path, history):
    saved = process(monkeypatch, tmp_path, fallback_run({"product": [
        *history, ("2025-01-05", 8),
    ]}))
    assert points(saved, "product", "final_test") == []
    assert saved.metrics == []
    assert points(saved, "product", "future") == [("2025-01-06", 8), ("2025-01-07", 8)]
    assert "validation cutoff" in saved.configuration["products"]["product"]["baselineEvaluationReason"]


def test_confirmed_zero_remains_usable_in_contiguous_fallback_history(monkeypatch, tmp_path):
    saved = process(monkeypatch, tmp_path, fallback_run({"product": [
        ("2025-01-01", 100), ("2025-01-03", 4), ("2025-01-04", 0),
    ]}))
    assert points(saved, "product", "future") == [("2025-01-05", 2), ("2025-01-06", 1)]


def test_empty_product_has_no_forecasts_or_metrics(monkeypatch, tmp_path):
    saved = process(monkeypatch, tmp_path, fallback_run({"product": []}))
    assert saved.predictions == saved.metrics == []
    assert saved.configuration["products"]["product"]["forecastOriginDate"] is None
