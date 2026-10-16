"""Calibration observations cannot choose the model or ensemble weights."""

from datetime import date, timedelta

from app.forecasting import Observation, SplitBoundaries, train_verified_xgboost


def test_calibration_actuals_cannot_change_model_or_method_selection():
    start = date(2025, 1, 1)
    rows = [Observation(start + timedelta(days=i), 12 + i % 7) for i in range(142)]
    bounds = SplitBoundaries(rows[99].day, rows[127].day, rows[-1].day)
    original = train_verified_xgboost(rows, bounds, horizon=7)
    calibration_start = date.fromisoformat(original["interval"]["calibrationStart"])
    changed = train_verified_xgboost(
        [Observation(row.day, row.quantity + 1000 if calibration_start <= row.day <= bounds.validation_end else row.quantity)
         for row in rows],
        bounds, horizon=7,
    )

    assert original["effectiveFolds"] == changed["effectiveFolds"] == 3
    for field in ("parameters", "bestIteration", "earlyStoppingUsed", "xgbWeight", "operatingMethod", "validation"):
        assert changed[field] == original[field]
    assert original["interval"]["selectionObservations"] == 18
    assert original["interval"]["calibrationObservations"] == 10
    assert changed["interval"]["lowerResidual"] != original["interval"]["lowerResidual"]
    assert changed["interval"]["upperResidual"] != original["interval"]["upperResidual"]
