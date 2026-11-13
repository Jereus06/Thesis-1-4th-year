"""Real CPU XGBoost through worker persistence; synthetic records, no database."""

from datetime import date, timedelta
from math import sqrt

import pytest

pytest.importorskip("xgboost")

from test_worker_fallback import fallback_run, process


@pytest.mark.parametrize("seasonal", [False, True])
def test_worker_saves_thirty_matching_test_and_future_days(monkeypatch, tmp_path, seasonal):
    start = date(2025, 1, 1)
    rows = [
        (str(start + timedelta(days=i)), 12 + (i % 7 if seasonal else 0))
        for i in range(178)
    ]
    run = fallback_run({"qualified": rows, "historyless": []})
    run.update(
        training_end=start + timedelta(days=119),
        validation_end=start + timedelta(days=147),
        final_test_end=start + timedelta(days=177),
        forecast_horizon_days=30,
    )
    run["data_snapshot"]["settings"].update(moving_average_window=7, cv_folds=2)
    saved = process(monkeypatch, tmp_path, run)
    summary = saved.configuration["products"]["qualified"]
    assert summary["eligible"] is True
    assert summary["historyDays"] == summary["nonzeroDays"] == 120
    assert summary["interval"]["calibrationObservations"] >= 10
    assert (tmp_path / run["id"] / "qualified.json").is_file()
    methods = {"moving_average", "xgboost", "ensemble"}
    test_rows, future_rows = {}, {}
    for method in methods:
        test_rows[method] = [
            row for split, row in saved.predictions
            if split == "final_test" and row[2] == "qualified" and row[4] == method
        ]
        future_rows[method] = [
            row for split, row in saved.predictions
            if split == "future" and row[2] == "qualified" and row[4] == method
        ]
        assert len(test_rows[method]) == len(future_rows[method]) == 30
        assert [r[3] for r in test_rows[method]] == [
            run["validation_end"] + timedelta(days=i + 1) for i in range(30)
        ]
        assert [r[3] for r in future_rows[method]] == [
            run["final_test_end"] + timedelta(days=i + 1) for i in range(30)
        ]
        assert all(float(r[5]) >= 0 for r in future_rows[method])
        metric = next(
            m for m in saved.metrics if m[2] == "qualified" and m[3] == method and m[4] == "final_test"
        )
        errors = [float(r[6]) - float(r[5]) for r in test_rows[method]]
        assert metric[7] == 30
        assert float(metric[5]) == pytest.approx(sum(abs(e) for e in errors) / 30)
        assert float(metric[6]) == pytest.approx(sqrt(sum(e * e for e in errors) / 30))
    assert len({tuple((r[3], r[6]) for r in rows) for rows in test_rows.values()}) == 1
    weight = summary["xgbWeight"]
    for i in range(30):
        assert float(future_rows["ensemble"][i][5]) == pytest.approx(
            weight * float(future_rows["xgboost"][i][5])
            + (1 - weight) * float(future_rows["moving_average"][i][5])
        )
    validation = {m[3]: float(m[5]) for m in saved.metrics if m[4] == "validation"}
    operating = summary["operatingMethod"]
    assert validation["moving_average" if operating == "movingAverage" else operating] == min(validation.values())
    assert not any(r[2] == "historyless" for _, r in saved.predictions)
    if not seasonal:
        assert validation["moving_average"] == 0
        assert all(float(r[5]) == 12 for r in future_rows["moving_average"])
