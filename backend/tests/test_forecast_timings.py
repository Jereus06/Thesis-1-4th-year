"""Measured phase scopes include every fit without inventing unavailable phases."""

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app import forecasting, worker
from app.forecasting import Observation, SplitBoundaries


class Clock:
    def __init__(self):
        self.seconds = 0.0

    def now(self):
        return self.seconds

    def advance(self, seconds):
        self.seconds += seconds


@pytest.fixture()
def clock(monkeypatch):
    clock = Clock()
    measured_time = SimpleNamespace(perf_counter=clock.now, time=lambda: 1000.0)
    monkeypatch.setattr(forecasting, "time", measured_time)
    monkeypatch.setattr(worker, "time", measured_time)
    return clock


@pytest.mark.parametrize(
    "validation_days, fits, validation_seconds, evaluation_seconds",
    [(28, 13, 53, 18), (14, 12, 41, 14)],
)
def test_model_timers_include_all_fits_calibration_metrics_and_future_predictions(
    monkeypatch, clock, validation_days, fits, validation_seconds, evaluation_seconds
):
    start = date(2025, 1, 1)
    rows = [
        Observation(start + timedelta(days=index), 12 + index % 7)
        for index in range(100 + validation_days + 14)
    ]
    bounds = SplitBoundaries(
        start + timedelta(days=99),
        start + timedelta(days=99 + validation_days),
        rows[-1].day,
    )
    fit_calls = []

    def fit(rows, params, seed, eval_rows=None):
        clock.advance(5)
        fit_calls.append((len(rows), len(eval_rows or [])))
        return SimpleNamespace(best_iteration=6)

    def predict(model, history, days):
        clock.advance(1)
        return [float(history[-1])] * len(days)

    real_average, real_evaluate = forecasting.moving_average, forecasting.evaluate
    real_quantile, real_intervals = forecasting.np.quantile, forecasting._intervals

    def average(*args):
        clock.advance(3)
        return real_average(*args)

    def evaluate(*args):
        clock.advance(2)
        return real_evaluate(*args)

    def quantile(*args):
        clock.advance(4)
        return real_quantile(*args)

    def intervals(*args):
        clock.advance(2)
        return real_intervals(*args)

    monkeypatch.setattr(forecasting, "_fit", fit)
    monkeypatch.setattr(forecasting, "recursive_xgboost", predict)
    monkeypatch.setattr(forecasting, "moving_average", average)
    monkeypatch.setattr(forecasting, "evaluate", evaluate)
    monkeypatch.setattr(forecasting.np, "quantile", quantile)
    monkeypatch.setattr(forecasting, "_intervals", intervals)
    result = forecasting.train_verified_xgboost(rows, bounds, horizon=7)
    timing = result["timing"]
    assert len(fit_calls) == fits
    assert fit_calls[-2:] == [(100 + validation_days, 0), (len(rows), 0)]
    if validation_days == 28:
        assert fit_calls[-3] == (118, 0)  # Separate calibration refit is training.
    assert timing["trainingMs"] == fits * 5000
    assert timing["validationMs"] == validation_seconds * 1000
    assert timing["evaluationMs"] == evaluation_seconds * 1000
    assert timing["preparationMs"] == 0  # This phase ran; the controlled clock did not advance.
    assert timing["totalModelingMs"] == sum(
        timing[key] for key in ("trainingMs", "validationMs", "evaluationMs", "preparationMs")
    )
    assert all(metric["observations"] == 14 for metric in result["finalTest"].values())
    assert len(result["futurePredictions"]["xgboost"]) == 7


class MeasuredConnection:
    def __init__(self, clock):
        self.clock = clock
        self.statements = []
        self.timing = None
        self.transaction_count = 0

    @contextmanager
    def transaction(self):
        self.transaction_count += 1
        self.clock.advance(2)
        yield
        self.clock.advance(7)  # Deliberately slow commit must be included for result persistence.

    def execute(self, statement, parameters):
        self.clock.advance(3)
        self.statements.append(statement)
        if "status='completed'" in statement:
            self.timing = parameters[0].obj


def frozen_run(empty=False):
    start = date(2025, 1, 1)
    return {
        "id": "00000000-0000-4000-8000-000000000051",
        "business_id": "00000000-0000-4000-8000-000000000052",
        "training_start": start,
        "training_end": start,
        "validation_end": start + timedelta(days=1),
        "final_test_end": start + timedelta(days=2),
        "forecast_horizon_days": 2,
        "created_at": datetime(2025, 1, 1, tzinfo=timezone.utc),
        "started_at": datetime(2025, 1, 1, 0, 0, 4, tzinfo=timezone.utc),
        "configuration": {},
        "data_snapshot": {
            "dailySales": [],
            "products": ["product"],
            "settings": {
                "minimum_history_weeks": 8, "minimum_nonzero_days": 100,
                "top_n_products": 8, "moving_average_window": 7, "cv_folds": 3,
            },
            "preparedProducts": {"product": {
                "targets": [] if empty else [
                    {"day": str(start + timedelta(days=index)), "quantity": 12 + index}
                    for index in range(3)
                ],
                "unknownDates": [], "excludedDates": [], "warnings": [],
            }},
        },
    }


@pytest.mark.parametrize("mode", ["ml", "baseline", "empty"])
def test_worker_persists_measured_phases_including_artifacts_and_result_commit(
    mode, monkeypatch, clock, tmp_path
):
    run = frozen_run(empty=mode == "empty")
    conn = MeasuredConnection(clock)
    monkeypatch.setattr(worker, "get_settings", lambda: SimpleNamespace(artifact_dir=tmp_path))
    monkeypatch.setattr(
        worker, "select_training_scope",
        lambda *_: {"product": (mode == "ml", 1, 1, None if mode == "ml" else "Short history")},
    )

    def train(*args, **kwargs):
        clock.advance(23)

        def save_model(path):
            clock.advance(13)

        metric = {"mae": 1.0, "rmse": 1.0, "observations": 1}
        return {
            "parameters": {}, "xgbWeight": 0.5, "operatingMethod": "xgboost",
            "requestedFolds": 3, "effectiveFolds": 3, "selectionFallback": None,
            "earlyStoppingUsed": True, "bestIteration": 6, "interval": {"available": False},
            "timing": {"preparationMs": 0, "trainingMs": 5000, "validationMs": 7000,
                       "evaluationMs": 11000, "totalModelingMs": 23000},
            "model": SimpleNamespace(save_model=save_model),
            "validation": {"xgboost": metric}, "finalTest": {"xgboost": metric},
            "testPredictions": {"xgboost": [13]},
            "futurePredictions": {"xgboost": [13, 13]},
            "futureLower": None, "futureUpper": None,
        }

    real_average, real_evaluate = worker.moving_average, worker.evaluate

    def average(*args):
        clock.advance(3)
        return real_average(*args)

    def evaluate(*args):
        clock.advance(2)
        return real_evaluate(*args)

    monkeypatch.setattr(worker, "train_verified_xgboost", train)
    monkeypatch.setattr(worker, "moving_average", average)
    monkeypatch.setattr(worker, "evaluate", evaluate)
    worker.process_run(conn, run)
    timing = conn.timing
    assert conn.transaction_count == 2
    assert timing["queueWaitMs"] == 4000
    assert timing["preparationMs"] == 0
    assert timing["timingVersion"] == "disjoint_phases_v1"
    assert "publication transaction are excluded" in timing["timingScope"]
    if mode == "ml":
        assert timing["trainingMs"] == 5000
        assert timing["validationEvaluationMs"] == 18000
        assert timing["totalModelingMs"] == 23000
        assert timing["persistenceMs"] == 40000  # 6 SQL calls + artifact + begin + commit.
        assert timing["totalProcessingMs"] == 63000
    elif mode == "baseline":
        assert timing["trainingMs"] is timing["validationMs"] is None
        assert timing["validationEvaluationMs"] == timing["evaluationMs"] == 8000
        assert timing["totalModelingMs"] == 8000
        assert timing["persistenceMs"] == 24000  # 5 SQL calls + begin + commit.
        assert timing["totalProcessingMs"] == 32000
    else:
        assert all(timing[key] is None for key in (
            "trainingMs", "validationMs", "evaluationMs", "validationEvaluationMs", "totalModelingMs"
        ))
        assert timing["persistenceMs"] == timing["totalProcessingMs"] == 12000
        assert not any("INSERT INTO" in statement for statement in conn.statements)
    # Completion publication has a separately excluded begin, SQL update and commit.
    assert clock.seconds * 1000 == timing["totalProcessingMs"] + 12000
