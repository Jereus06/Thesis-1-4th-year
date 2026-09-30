"""Chronological Moving Average/XGBoost evaluation.

This module uses the official ``xgboost`` Python package. It never uses final-test observations for
parameter selection, ensemble weighting, or interval calibration. Callers must persist the returned
configuration and results before presenting them as evidence.
"""

from dataclasses import asdict, dataclass
from datetime import date
from math import sqrt
from typing import Sequence

import numpy as np
from xgboost import XGBRegressor, __version__ as xgboost_version


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
    values = list(history)
    predictions: list[float] = []
    for _ in range(horizon):
        prediction = max(0.0, float(np.mean(values[-window:])))
        predictions.append(prediction)
        values.append(prediction)
    return predictions


def train_verified_xgboost(rows: Sequence[Observation], bounds: SplitBoundaries, *, seed: int = 42):
    """Select a conservative XGBoost configuration on validation and evaluate test once.

    Features use only lagged quantities and calendar values. Products that do not have enough
    lagged observations must be routed to the named Moving Average fallback by the caller.
    """
    train, validation, final_test = chronological_partitions(rows, bounds)
    all_rows = sorted(rows, key=lambda row: row.day)
    features, targets, days = _supervised(all_rows)
    train_mask = [day <= bounds.train_end for day in days]
    validation_mask = [bounds.train_end < day <= bounds.validation_end for day in days]
    test_mask = [bounds.validation_end < day <= bounds.final_test_end for day in days]
    x_train, y_train = features[train_mask], targets[train_mask]
    x_validation, y_validation = features[validation_mask], targets[validation_mask]
    x_test, y_test = features[test_mask], targets[test_mask]
    if min(len(y_train), len(y_validation), len(y_test)) == 0:
        raise ValueError("Not enough lagged observations in every chronological split")

    candidates = [
        {"max_depth": 3, "learning_rate": 0.05, "n_estimators": 150},
        {"max_depth": 4, "learning_rate": 0.05, "n_estimators": 200},
        {"max_depth": 3, "learning_rate": 0.1, "n_estimators": 120},
    ]
    selected = None
    selected_validation = None
    for params in candidates:
        model = XGBRegressor(
            objective="reg:squarederror",
            random_state=seed,
            n_jobs=1,
            subsample=0.9,
            colsample_bytree=0.9,
            reg_lambda=1.5,
            **params,
        )
        model.fit(x_train, y_train)
        predictions = np.clip(model.predict(x_validation), 0, None)
        metric = evaluate(y_validation.tolist(), predictions.tolist())
        if selected_validation is None or metric.mae < selected_validation.mae:
            selected, selected_validation = params, metric

    ma_validation = moving_average(y_train.tolist(), len(y_validation), min(7, len(y_train)))
    ma_metric = evaluate(y_validation.tolist(), ma_validation)
    inverse_xgb = 1 / max(selected_validation.mae, 1e-9)
    inverse_ma = 1 / max(ma_metric.mae, 1e-9)
    xgb_weight = inverse_xgb / (inverse_xgb + inverse_ma)

    # Configuration and weights are now frozen. Refit without using final-test targets.
    x_fit = np.concatenate([x_train, x_validation])
    y_fit = np.concatenate([y_train, y_validation])
    final_model = XGBRegressor(
        objective="reg:squarederror",
        random_state=seed,
        n_jobs=1,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.5,
        **selected,
    )
    final_model.fit(x_fit, y_fit)
    xgb_test = np.clip(final_model.predict(x_test), 0, None)
    ma_test = np.asarray(moving_average(y_fit.tolist(), len(y_test), min(7, len(y_fit))))
    ensemble_test = xgb_weight * xgb_test + (1 - xgb_weight) * ma_test
    return {
        "implementation": "xgboost.XGBRegressor",
        "xgboostVersion": xgboost_version,
        "objective": "reg:squarederror",
        "seed": seed,
        "parameters": selected,
        "xgbWeight": xgb_weight,
        "validation": {"xgboost": asdict(selected_validation), "movingAverage": asdict(ma_metric)},
        "finalTest": {
            "xgboost": asdict(evaluate(y_test.tolist(), xgb_test.tolist())),
            "movingAverage": asdict(evaluate(y_test.tolist(), ma_test.tolist())),
            "ensemble": asdict(evaluate(y_test.tolist(), ensemble_test.tolist())),
        },
        "model": final_model,
        "testDays": [str(day) for day, include in zip(days, test_mask, strict=True) if include],
        "testActual": y_test.tolist(),
        "testPredictions": {
            "xgboost": xgb_test.tolist(),
            "movingAverage": ma_test.tolist(),
            "ensemble": ensemble_test.tolist(),
        },
    }


def _supervised(rows: Sequence[Observation]):
    quantities = np.asarray([row.quantity for row in rows], dtype=float)
    result, targets, days = [], [], []
    for index in range(30, len(rows)):
        day = rows[index].day
        result.append(
            [
                quantities[index - 1],
                quantities[index - 7],
                quantities[index - 14],
                quantities[index - 7 : index].mean(),
                quantities[index - 30 : index].mean(),
                day.weekday(),
                day.month,
            ]
        )
        targets.append(quantities[index])
        days.append(day)
    return np.asarray(result), np.asarray(targets), np.asarray(days)
