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
