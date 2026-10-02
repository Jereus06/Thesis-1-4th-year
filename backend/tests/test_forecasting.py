from datetime import date, timedelta
from math import sin

import pytest

pytest.importorskip("xgboost")

from app.forecasting import Observation, SplitBoundaries, train_verified_xgboost


def test_xgboost_training_uses_identical_final_test_observations():
    start = date(2025, 1, 1)
    rows = [
        Observation(start + timedelta(days=index), max(0, 12 + index % 7 + sin(index / 3)))
        for index in range(100)
    ]
    result = train_verified_xgboost(
        rows,
        SplitBoundaries(
            train_end=start + timedelta(days=59),
            validation_end=start + timedelta(days=79),
            final_test_end=start + timedelta(days=99),
        ),
        seed=7,
    )

    assert result["implementation"] == "xgboost.XGBRegressor"
    assert result["objective"] == "reg:squarederror"
    assert result["seed"] == 7
    assert result["finalTest"]["xgboost"]["observations"] == 20
    assert result["finalTest"]["movingAverage"]["observations"] == 20
    assert result["finalTest"]["ensemble"]["observations"] == 20
    assert len(result["testDays"]) == len(result["testActual"]) == 20


def test_final_test_actuals_cannot_change_selection_or_test_predictions():
    start = date(2025, 1, 1)
    rows = [Observation(start + timedelta(days=i), 12 + i % 7) for i in range(100)]
    bounds = SplitBoundaries(
        start + timedelta(days=59), start + timedelta(days=79), start + timedelta(days=99)
    )
    original = train_verified_xgboost(rows, bounds, horizon=7)
    changed = train_verified_xgboost(
        [Observation(row.day, row.quantity if i < 80 else 1000 + i) for i, row in enumerate(rows)],
        bounds,
        horizon=7,
    )
    assert changed["parameters"] == original["parameters"]
    assert changed["xgbWeight"] == original["xgbWeight"]
    assert changed["operatingMethod"] == original["operatingMethod"]
    assert changed["testPredictions"] == original["testPredictions"]
    assert len(original["futurePredictions"]["xgboost"]) == 7


def test_nonzero_eligibility_excludes_validation_and_final_test():
    from app.worker import training_eligibility

    start = date(2025, 1, 1)
    rows = [Observation(start + timedelta(days=i), 1 if i >= 60 else 0) for i in range(160)]
    eligible, days, nonzero, _ = training_eligibility(
        rows,
        {"training_end": start + timedelta(days=59)},
        {"minimum_history_weeks": 8, "minimum_nonzero_days": 100, "top_n_products": 8},
        0,
    )
    assert not eligible
    assert (days, nonzero) == (60, 0)


def test_absent_dates_are_not_automatically_zero_sales():
    from app.worker import daily_observations

    start = date(2025, 1, 1)
    rows = [{"sale_date": start, "quantity": "4"}]
    result = daily_observations(
        rows,
        start,
        start + timedelta(days=2),
        [
            {"date": "2025-01-02", "classification": "confirmed_zero"},
            {"date": "2025-01-03", "classification": "business_closed"},
        ],
    )
    assert [(row.day, row.quantity) for row in result] == [
        (start, 4.0),
        (start + timedelta(days=1), 0.0),
    ]


def test_incomplete_calendar_sequence_is_not_xgboost_eligible():
    from app.worker import training_eligibility

    start = date(2025, 1, 1)
    rows = [Observation(start + timedelta(days=i), 1) for i in range(120) if i != 12]
    eligible, days, nonzero, reason = training_eligibility(
        rows,
        {"training_start": start, "training_end": start + timedelta(days=119)},
        {"minimum_history_weeks": 8, "minimum_nonzero_days": 100, "top_n_products": 8},
        0,
    )
    assert not eligible
    assert (days, nonzero) == (119, 119)
    assert "119/120 classified calendar days" in reason
