"""Official XGBoost with recursive evaluation from a fixed chronological cutoff."""

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from math import sqrt
from typing import Sequence

import numpy as np
from xgboost import XGBRegressor
from xgboost import __version__ as xgboost_version


@dataclass(frozen=True)
class Observation:
    day: date
    quantity: float


@dataclass(frozen=True)
class SplitBoundaries:
    train_end: date
    validation_end: date
    final_test_end: date


@dataclass(frozen=True)
class Metrics:
    mae: float
    rmse: float
    observations: int


def chronological_partitions(rows: Sequence[Observation], bounds: SplitBoundaries):
    ordered = sorted(rows, key=lambda row: row.day)
    train = [row for row in ordered if row.day <= bounds.train_end]
    validation = [row for row in ordered if bounds.train_end < row.day <= bounds.validation_end]
    final_test = [
        row for row in ordered if bounds.validation_end < row.day <= bounds.final_test_end
    ]
    if not train or not validation or not final_test:
        raise ValueError(
            "Training, validation, and final-test periods must all contain observations"
        )
    return train, validation, final_test


def evaluate(actual: Sequence[float], predicted: Sequence[float]) -> Metrics:
    if len(actual) != len(predicted) or not actual:
        raise ValueError("Metrics require matching, non-empty observations")
    errors = [a - p for a, p in zip(actual, predicted, strict=True)]
    return Metrics(
        sum(abs(error) for error in errors) / len(errors),
        sqrt(sum(error**2 for error in errors) / len(errors)),
        len(errors),
    )


def moving_average(history: Sequence[float], horizon: int, window: int) -> list[float]:
    if window < 1 or horizon < 0:
        raise ValueError("Window must be positive and horizon nonnegative")
    values, predictions = list(history), []
    for _ in range(horizon):
        prediction = max(0.0, float(np.mean(values[-window:]))) if values else 0.0
        predictions.append(prediction)
        values.append(prediction)
    return predictions


def _features(history: Sequence[float], day: date) -> list[float]:
    return [
        history[-1],
        history[-7],
        history[-14],
        float(np.mean(history[-7:])),
        float(np.mean(history[-30:])),
        day.weekday(),
        day.month,
    ]


def _supervised(rows: Sequence[Observation]):
    values = [row.quantity for row in rows]
    features = [_features(values[:index], rows[index].day) for index in range(30, len(rows))]
    return np.asarray(features), np.asarray(values[30:])


def _fit(rows: Sequence[Observation], params: dict, seed: int) -> XGBRegressor:
    features, targets = _supervised(rows)
    if not len(targets):
        raise ValueError("Training requires more than 30 daily observations")
    model = XGBRegressor(
        objective="reg:squarederror",
        random_state=seed,
        n_jobs=1,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.5,
        **params,
    )
    model.fit(features, targets)
    return model


def recursive_xgboost(model, history: Sequence[float], days: Sequence[date]) -> list[float]:
    values, predictions = list(history), []
    for day in days:
        prediction = max(0.0, float(model.predict(np.asarray([_features(values, day)]))[0]))
        values.append(prediction)
        predictions.append(prediction)
    return predictions


def train_verified_xgboost(
    rows: Sequence[Observation],
    bounds: SplitBoundaries,
    *,
    seed: int = 42,
    window: int = 7,
    horizon: int = 14,
):
    """Select on validation, evaluate untouched test, then refit for future operations."""
    train, validation, final_test = chronological_partitions(rows, bounds)
    train_values = [row.quantity for row in train]
    validation_actual = [row.quantity for row in validation]
    validation_days = [row.day for row in validation]
    candidates = [
        {"max_depth": 3, "learning_rate": 0.05, "n_estimators": 150},
        {"max_depth": 4, "learning_rate": 0.05, "n_estimators": 200},
        {"max_depth": 3, "learning_rate": 0.1, "n_estimators": 120},
    ]
    selected = selected_metric = selected_predictions = None
    for params in candidates:
        model = _fit(train, params, seed)
        predictions = recursive_xgboost(model, train_values, validation_days)
        metric = evaluate(validation_actual, predictions)
        if selected_metric is None or metric.mae < selected_metric.mae:
            selected, selected_metric, selected_predictions = params, metric, predictions
    ma_validation = moving_average(train_values, len(validation), window)
    ma_metric = evaluate(validation_actual, ma_validation)
    inverse_xgb, inverse_ma = 1 / max(selected_metric.mae, 1e-9), 1 / max(ma_metric.mae, 1e-9)
    weight = inverse_xgb / (inverse_xgb + inverse_ma)
    ensemble_validation = [
        weight * x + (1 - weight) * m
        for x, m in zip(selected_predictions, ma_validation, strict=True)
    ]
    validation_metrics = {
        "movingAverage": asdict(ma_metric),
        "xgboost": asdict(selected_metric),
        "ensemble": asdict(evaluate(validation_actual, ensemble_validation)),
    }
    operating_method = min(validation_metrics, key=lambda method: validation_metrics[method]["mae"])

    # Both methods predict the entire test from the same train+validation cutoff.
    fit_rows = [*train, *validation]
    fit_values = [row.quantity for row in fit_rows]
    evaluation_model = _fit(fit_rows, selected, seed)
    test_actual = [row.quantity for row in final_test]
    xgb_test = recursive_xgboost(evaluation_model, fit_values, [row.day for row in final_test])
    ma_test = moving_average(fit_values, len(final_test), window)
    ensemble_test = [weight * x + (1 - weight) * m for x, m in zip(xgb_test, ma_test, strict=True)]
    test_predictions = {"xgboost": xgb_test, "movingAverage": ma_test, "ensemble": ensemble_test}

    # This operational refit cannot alter the frozen selection or test results.
    all_rows = [*fit_rows, *final_test]
    operational_model = _fit(all_rows, selected, seed)
    future_days = [bounds.final_test_end + timedelta(days=index + 1) for index in range(horizon)]
    history = [row.quantity for row in all_rows]
    future_xgb = recursive_xgboost(operational_model, history, future_days)
    future_ma = moving_average(history, horizon, window)
    return {
        "implementation": "xgboost.XGBRegressor",
        "xgboostVersion": xgboost_version,
        "objective": "reg:squarederror",
        "seed": seed,
        "parameters": selected,
        "xgbWeight": weight,
        "operatingMethod": operating_method,
        "validation": validation_metrics,
        "finalTest": {
            method: asdict(evaluate(test_actual, predictions))
            for method, predictions in test_predictions.items()
        },
        "model": operational_model,
        "testDays": [str(row.day) for row in final_test],
        "testActual": test_actual,
        "testPredictions": test_predictions,
        "futurePredictions": {
            "xgboost": future_xgb,
            "movingAverage": future_ma,
            "ensemble": [
                weight * x + (1 - weight) * m for x, m in zip(future_xgb, future_ma, strict=True)
            ],
        },
    }
