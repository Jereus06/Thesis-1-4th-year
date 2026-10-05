"""Configured folds affect real training without crossing chronological boundaries."""

from datetime import date, timedelta

import pytest

pytest.importorskip("xgboost")
from app import forecasting
from app.forecasting import Observation, SplitBoundaries, train_verified_xgboost


def series(training_days=120):
    start = date(2025, 1, 1)
    rows = [
        Observation(start + timedelta(days=i), 12 + i % 7)
        for i in range(training_days + 40)
    ]
    bounds = SplitBoundaries(
        rows[training_days - 1].day,
        rows[training_days + 19].day,
        rows[-1].day,
    )
    return rows, bounds


@pytest.mark.parametrize("configured", [None, 2, 4])
def test_trainer_uses_requested_training_only_folds(configured, monkeypatch):
    rows, bounds = series()
    fits, predictions = [], []
    real_fit = forecasting._fit
    real_predict = forecasting.recursive_xgboost

    def fit(fit_rows, *args, **kwargs):
        fits.append(list(fit_rows))
        return real_fit(fit_rows, *args, **kwargs)

    def predict(model, history, days):
        predictions.append(list(days))
        return real_predict(model, history, days)

    monkeypatch.setattr(forecasting, "_fit", fit)
    monkeypatch.setattr(forecasting, "recursive_xgboost", predict)
    options = {} if configured is None else {"cv_folds": configured}
    result = train_verified_xgboost(rows, bounds, horizon=7, **options)
    requested = 3 if configured is None else configured
    assert result["requestedFolds"] == result["effectiveFolds"] == requested
    assert result["selectionFallback"] is None
    # Each of the three parameter candidates uses the requested CV folds.
    for fit_rows, check_days in zip(fits[:3 * requested], predictions[:3 * requested]):
        assert len(fit_rows) >= 45
        assert len(check_days) == 14
        assert fit_rows[-1].day < check_days[0] <= check_days[-1] <= bounds.train_end
    assert len({tuple(days) for days in predictions[:3 * requested]}) == requested
    assert result["finalTest"]["xgboost"]["observations"] == 20


def test_infeasible_count_records_zero_folds_without_borrowing_later_data():
    rows, bounds = series(training_days=60)
    result = train_verified_xgboost(rows, bounds, cv_folds=4, horizon=7)
    assert result["requestedFolds"] == 4
    assert result["effectiveFolds"] == 0
    assert result["selectionFallback"].startswith("4 training-only chronological folds")
    assert result["finalTest"]["xgboost"]["observations"] == 20


@pytest.mark.parametrize("count", [0, 1, 2.5, True])
def test_trainer_rejects_invalid_fold_counts(count):
    rows, bounds = series()
    with pytest.raises(ValueError, match="integer of at least two"):
        train_verified_xgboost(rows, bounds, cv_folds=count)


def test_final_test_changes_do_not_change_selection_with_feasible_cv():
    rows, bounds = series()
    original = train_verified_xgboost(rows, bounds, cv_folds=2, horizon=7)
    altered = [
        Observation(row.day, row.quantity if row.day <= bounds.validation_end else 1000 + i)
        for i, row in enumerate(rows)
    ]
    changed = train_verified_xgboost(altered, bounds, cv_folds=2, horizon=7)
    assert original["effectiveFolds"] == changed["effectiveFolds"] == 2
    assert changed["parameters"] == original["parameters"]
    assert changed["xgbWeight"] == original["xgbWeight"]
    assert changed["operatingMethod"] == original["operatingMethod"]
    assert changed["testPredictions"] == original["testPredictions"]
