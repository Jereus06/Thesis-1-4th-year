"""Regression checks for eligibility-first XGBoost product selection."""

from datetime import date, timedelta

import pytest

pytest.importorskip("xgboost")

from app.forecasting import Observation
from app.worker import select_training_scope


@pytest.fixture()
def run():
    start = date(2025, 1, 1)
    return {
        "training_start": start,
        "training_end": start + timedelta(days=119),
        "validation_end": start + timedelta(days=139),
        "final_test_end": start + timedelta(days=159),
    }


@pytest.fixture()
def settings():
    return {
        "minimum_history_weeks": 8,
        "minimum_nonzero_days": 100,
        "top_n_products": 1,
    }


def daily_series(run, quantity=1):
    return [
        Observation(run["training_start"] + timedelta(days=index), quantity)
        for index in range(160)
    ]


@pytest.mark.parametrize(
    "failure", ["short_history", "too_few_nonzero", "training_gap", "validation_gap", "test_gap"]
)
def test_ineligible_high_volume_product_does_not_consume_a_slot(run, settings, failure):
    high = daily_series(run, 1000)
    if failure == "short_history":
        high = high[50:]
    elif failure == "too_few_nonzero":
        high = [
            Observation(row.day, 0 if 99 <= index < 120 else row.quantity)
            for index, row in enumerate(high)
        ]
    else:
        missing = {"training_gap": 12, "validation_gap": 130, "test_gap": 150}[failure]
        high.pop(missing)

    scope = select_training_scope(
        {"high-volume": high, "eligible": daily_series(run)}, run, settings
    )

    assert sum(row.quantity for row in high if row.day <= run["training_end"]) > 120
    assert not scope["high-volume"][0]
    assert scope["high-volume"][3]
    assert scope["eligible"] == (True, 120, 120, None)


def test_top_n_ranks_eligible_products_by_training_volume_only(run, settings):
    settings = {**settings, "top_n_products": 2}
    series = {
        "lowest-training": daily_series(run, 1),
        "highest-training": daily_series(run, 3),
        "middle-training": daily_series(run, 2),
    }
    original = select_training_scope(series, run, settings)
    series["lowest-training"] = [
        Observation(row.day, row.quantity if row.day <= run["training_end"] else 1_000_000)
        for row in series["lowest-training"]
    ]
    changed = select_training_scope(series, run, settings)

    assert changed == original
    assert {pid for pid, decision in changed.items() if decision[0]} == {
        "highest-training",
        "middle-training",
    }
    assert "Outside top 2 eligible products" in changed["lowest-training"][3]


def test_equal_training_volume_uses_product_id_independent_of_input_order(run, settings):
    series = {"b": daily_series(run), "a": daily_series(run)}
    for candidates in (series, dict(reversed(list(series.items())))):
        scope = select_training_scope(candidates, run, settings)
        assert scope["a"][0]
        assert not scope["b"][0]
        assert "rank 2" in scope["b"][3]


def test_fewer_than_top_n_selects_every_eligible_product(run, settings):
    series = {"a": daily_series(run), "b": daily_series(run, 2)}
    scope = select_training_scope(series, run, {**settings, "top_n_products": 8})
    assert all(decision[0] for decision in scope.values())


def test_minimum_calendar_history_is_an_independent_gate(run, settings):
    scope = select_training_scope(
        {"product": daily_series(run, 1000)},
        run,
        {**settings, "minimum_history_weeks": 18},
    )
    assert scope["product"][:3] == (False, 120, 120)
    assert "126 training days" in scope["product"][3]
