"""Normal Refresh preserves training gates and separate pre-test calibration."""

from datetime import date, timedelta

import pytest

from app.repository import refresh_split_plan
from app.schemas import ForecastRunCreate


DEFAULTS = {"minimumHistoryWeeks": 8, "minimumNonzeroDays": 100, "cvFolds": 3}


def boundaries(history_days, settings=DEFAULTS):
    start = date(2025, 1, 1)
    end = start + timedelta(days=history_days - 1)
    plan = refresh_split_plan(history_days, settings)
    validation_end = end - timedelta(days=plan["finalTestCalendarDays"])
    training_end = validation_end - timedelta(days=plan["validationCalendarDays"])
    return plan, ForecastRunCreate(
        training_start=start,
        training_end=training_end,
        validation_start=training_end + timedelta(days=1),
        validation_end=validation_end,
        final_test_start=validation_end + timedelta(days=1),
        final_test_end=end,
        forecast_horizon_days=7,
    )


@pytest.mark.parametrize(
    ("history_days", "training", "validation", "final_test", "calibration"),
    [
        (3, 1, 1, 1, 0),
        (10, 6, 2, 2, 0),
        (70, 42, 14, 14, 0),
        (128, 100, 14, 14, 0),
        (133, 105, 14, 14, 0),
        (134, 100, 20, 14, 10),
        (140, 100, 26, 14, 10),
        (142, 100, 28, 14, 10),
        (200, 158, 28, 14, 10),
    ],
)
def test_default_refresh_keeps_disjoint_periods_and_training_eligibility(
    history_days, training, validation, final_test, calibration
):
    plan, run = boundaries(history_days)
    assert plan["trainingCalendarDays"] == (run.training_end - run.training_start).days + 1 == training
    assert plan["validationCalendarDays"] == (run.validation_end - run.validation_start).days + 1 == validation
    assert plan["finalTestCalendarDays"] == (run.final_test_end - run.final_test_start).days + 1 == final_test
    assert training + validation + final_test == history_days
    assert plan["trainingReserveCalendarDays"] == 100
    assert plan["validationCalibrationCalendarDays"] == calibration
    assert plan["validationSelectionCalendarDays"] == validation - calibration
    if calibration:
        assert training >= 100
        assert plan["validationSelectionCalendarDays"] >= 10


@pytest.mark.parametrize(
    ("changes", "reserve"),
    [
        ({"minimumHistoryWeeks": 20}, 140),
        ({"minimumNonzeroDays": 160}, 160),
        ({"cvFolds": 7}, 143),
        ({"minimumHistoryWeeks": 1, "minimumNonzeroDays": 1}, 87),
    ],
)
def test_interval_split_respects_configured_training_and_cv_requirements(changes, reserve):
    settings = {**DEFAULTS, **changes}
    plan, _run = boundaries(reserve + 34, settings)
    assert plan["trainingReserveCalendarDays"] == plan["trainingCalendarDays"] == reserve
    assert plan["validationCalendarDays"] == 20
    assert plan["finalTestCalendarDays"] == 14
    compact, _run = boundaries(reserve + 33, settings)
    assert compact["trainingCalendarDays"] >= reserve
    assert compact["validationCalendarDays"] == 14
    assert compact["validationCalibrationCalendarDays"] == 0


@pytest.mark.parametrize("history_days", [0, 1, 2])
def test_too_short_history_cannot_make_three_chronological_periods(history_days):
    with pytest.raises(ValueError, match="at least three calendar days"):
        refresh_split_plan(history_days, DEFAULTS)


def test_normal_long_split_uses_official_early_stopping_before_reserved_calibration(monkeypatch):
    pytest.importorskip("xgboost")
    from app import forecasting
    from app.forecasting import Observation, SplitBoundaries

    plan, run = boundaries(142)
    rows = [Observation(run.training_start + timedelta(days=index), 12 + index % 7)
            for index in range(142)]
    recorded_eval_days = []
    real_fit = forecasting._fit

    def record_fit(fit_rows, params, seed, eval_rows=None):
        if eval_rows:
            recorded_eval_days.append([item.day for item in eval_rows])
        return real_fit(fit_rows, params, seed, eval_rows)

    monkeypatch.setattr(forecasting, "_fit", record_fit)
    result = forecasting.train_verified_xgboost(
        rows, SplitBoundaries(run.training_end, run.validation_end, run.final_test_end), horizon=7,
    )
    interval = result["interval"]
    assert result["requestedFolds"] == result["effectiveFolds"] == 3
    assert result["earlyStoppingUsed"] is True
    assert interval["available"] is True
    assert interval["unavailableReason"] is None
    assert interval["selectionObservations"] == plan["validationSelectionCalendarDays"] == 18
    assert interval["calibrationObservations"] == plan["validationCalibrationCalendarDays"] == 10
    calibration_start = date.fromisoformat(interval["calibrationStart"])
    assert len(recorded_eval_days) == 1
    assert len(recorded_eval_days[0]) == 18
    assert max(recorded_eval_days[0]) < calibration_start <= run.validation_end < run.final_test_start
    assert {metric["observations"] for metric in result["finalTest"].values()} == {14}
    assert len(result["futureLower"]) == len(result["futureUpper"]) == 7


def test_normal_short_validation_reports_unavailable_intervals_without_borrowing_test_data():
    pytest.importorskip("xgboost")
    from app.forecasting import Observation, SplitBoundaries, train_verified_xgboost

    _plan, run = boundaries(128)
    rows = [Observation(run.training_start + timedelta(days=index), 12 + index % 7)
            for index in range(128)]
    result = train_verified_xgboost(
        rows, SplitBoundaries(run.training_end, run.validation_end, run.final_test_end), horizon=7,
    )
    interval = result["interval"]
    assert result["requestedFolds"] == result["effectiveFolds"] == 3
    assert interval["available"] is False
    assert "14 usable validation observations" in interval["unavailableReason"]
    assert interval["selectionObservations"] == 14
    assert interval["calibrationObservations"] == 0
    assert interval["lowerResidual"] is interval["upperResidual"] is None
    assert result["futureLower"] is result["futureUpper"] is None
    assert {metric["observations"] for metric in result["finalTest"].values()} == {14}
