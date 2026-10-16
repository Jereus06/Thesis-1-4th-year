"""Normal Refresh preserves training gates and separate pre-test calibration."""

from datetime import date, timedelta

import pytest

from app.repository import refresh_split_plan
from app.schemas import ForecastRunCreate


DEFAULTS = {
    "forecastHorizonDays": 14,
    "minimumHistoryWeeks": 8,
    "minimumNonzeroDays": 100,
    "cvFolds": 3,
}


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
        forecast_horizon_days=settings["forecastHorizonDays"],
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
    assert plan["policy"] == "horizon_matched_selection_calibration_v2"
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


@pytest.mark.parametrize("horizon", [7, 14, 21, 30])
@pytest.mark.parametrize("extra_validation_days", [0, 8])
def test_refresh_matches_each_forecast_horizon_with_enough_history(horizon, extra_validation_days):
    settings = {**DEFAULTS, "forecastHorizonDays": horizon}
    validation = 20 + extra_validation_days
    history_days = 100 + validation + horizon
    plan, run = boundaries(history_days, settings)
    assert plan["trainingCalendarDays"] == plan["trainingReserveCalendarDays"] == 100
    assert plan["validationCalendarDays"] == validation
    assert plan["finalTestCalendarDays"] == run.forecast_horizon_days == horizon
    assert run.training_end < run.validation_start <= run.validation_end < run.final_test_start
    assert (run.final_test_end - run.final_test_start).days + 1 == horizon
    assert plan["validationSelectionCalendarDays"] == validation - 10
    assert plan["validationCalibrationCalendarDays"] == 10
    assert sum(plan[key] for key in (
        "trainingCalendarDays", "validationCalendarDays", "finalTestCalendarDays"
    )) == history_days


@pytest.mark.parametrize(
    ("history_days", "training", "validation", "final_test"),
    [
        (3, 1, 1, 1),
        (10, 6, 2, 2),
        (70, 42, 14, 14),
        (128, 100, 14, 14),
        (133, 105, 14, 14),
        (134, 100, 20, 14),
        (140, 100, 20, 20),
        (149, 100, 20, 29),
        (150, 100, 20, 30),
        (157, 100, 27, 30),
        (158, 100, 28, 30),
        (730, 672, 28, 30),
    ],
)
def test_thirty_day_forecast_reduces_final_test_until_history_is_sufficient(
    history_days, training, validation, final_test
):
    plan, run = boundaries(history_days, {**DEFAULTS, "forecastHorizonDays": 30})
    assert plan["trainingCalendarDays"] == training
    assert plan["validationCalendarDays"] == validation
    assert plan["finalTestCalendarDays"] == final_test <= run.forecast_horizon_days
    assert training + validation + final_test == history_days
    assert (run.training_end - run.training_start).days + 1 == training
    assert (run.validation_end - run.validation_start).days + 1 == validation
    assert (run.final_test_end - run.final_test_start).days + 1 == final_test
    assert run.training_end < run.validation_start <= run.validation_end < run.final_test_start
    if validation >= 20:
        assert training >= plan["trainingReserveCalendarDays"]
        assert plan["validationCalibrationCalendarDays"] == 10
        assert plan["validationSelectionCalendarDays"] >= 10
    else:
        assert plan["validationCalibrationCalendarDays"] == 0


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

    longer_settings = {**settings, "forecastHorizonDays": 30}
    full, _run = boundaries(reserve + 50, longer_settings)
    assert full["trainingReserveCalendarDays"] == full["trainingCalendarDays"] == reserve
    assert full["validationCalendarDays"] == 20
    assert full["finalTestCalendarDays"] == 30
    reduced, _run = boundaries(reserve + 40, longer_settings)
    assert reduced["trainingCalendarDays"] == reserve
    assert reduced["validationCalendarDays"] == reduced["finalTestCalendarDays"] == 20
    assert reduced["validationSelectionCalendarDays"] == reduced["validationCalibrationCalendarDays"] == 10


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
        rows, SplitBoundaries(run.training_end, run.validation_end, run.final_test_end),
        horizon=run.forecast_horizon_days,
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
    assert len(result["futureLower"]) == len(result["futureUpper"]) == run.forecast_horizon_days


def test_thirty_day_final_test_does_not_influence_selection_or_interval_calibration():
    pytest.importorskip("xgboost")
    from app.forecasting import Observation, SplitBoundaries, train_verified_xgboost

    plan, run = boundaries(150, {**DEFAULTS, "forecastHorizonDays": 30})
    rows = [Observation(run.training_start + timedelta(days=index), 12 + index % 7)
            for index in range(150)]
    bounds = SplitBoundaries(run.training_end, run.validation_end, run.final_test_end)
    original = train_verified_xgboost(rows, bounds, horizon=run.forecast_horizon_days)
    altered = [Observation(row.day, row.quantity if row.day < run.final_test_start else 1000 + index)
               for index, row in enumerate(rows)]
    changed = train_verified_xgboost(altered, bounds, horizon=run.forecast_horizon_days)

    assert plan["finalTestCalendarDays"] == 30
    assert {metric["observations"] for metric in original["finalTest"].values()} == {30}
    assert {metric["observations"] for metric in changed["finalTest"].values()} == {30}
    for key in ("parameters", "xgbWeight", "operatingMethod", "validation", "testPredictions"):
        assert changed[key] == original[key]
    for key in ("selectionObservations", "calibrationObservations", "calibrationStart",
                "calibrationEnd", "lowerResidual", "upperResidual"):
        assert changed["interval"][key] == original["interval"][key]
    assert original["interval"]["selectionObservations"] == 10
    assert original["interval"]["calibrationObservations"] == 10
    assert original["interval"]["calibrationEnd"] < str(run.final_test_start)


def test_normal_short_validation_reports_unavailable_intervals_without_borrowing_test_data():
    pytest.importorskip("xgboost")
    from app.forecasting import Observation, SplitBoundaries, train_verified_xgboost

    _plan, run = boundaries(128)
    rows = [Observation(run.training_start + timedelta(days=index), 12 + index % 7)
            for index in range(128)]
    result = train_verified_xgboost(
        rows, SplitBoundaries(run.training_end, run.validation_end, run.final_test_end),
        horizon=run.forecast_horizon_days,
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
