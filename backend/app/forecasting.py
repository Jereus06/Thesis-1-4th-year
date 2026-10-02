"""Official XGBoost with chronological selection and fixed-origin recursive evaluation."""

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from math import sqrt
import time
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
    parts = (
        [r for r in ordered if r.day <= bounds.train_end],
        [r for r in ordered if bounds.train_end < r.day <= bounds.validation_end],
        [r for r in ordered if bounds.validation_end < r.day <= bounds.final_test_end],
    )
    if any(not part for part in parts):
        raise ValueError(
            "Training, validation, and final-test periods must all contain observations"
        )
    return parts


def evaluate(actual: Sequence[float], predicted: Sequence[float]) -> Metrics:
    if len(actual) != len(predicted) or not actual:
        raise ValueError("Metrics require matching, non-empty observations")
    errors = [a - p for a, p in zip(actual, predicted, strict=True)]
    return Metrics(
        sum(abs(e) for e in errors) / len(errors),
        sqrt(sum(e * e for e in errors) / len(errors)),
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
    values = [r.quantity for r in rows]
    return np.asarray(
        [_features(values[:i], rows[i].day) for i in range(30, len(rows))]
    ), np.asarray(values[30:])


def _model(params, seed, *, early_stopping_rounds=None):
    return XGBRegressor(
        objective="reg:squarederror",
        random_state=seed,
        n_jobs=1,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.5,
        early_stopping_rounds=early_stopping_rounds,
        **params,
    )


def _fit(rows, params, seed, eval_rows=None):
    x, y = _supervised(rows)
    if not len(y):
        raise ValueError("Training requires more than 30 daily observations")
    use_early_stopping = bool(eval_rows) and len(rows) >= 30
    model = _model(params, seed, early_stopping_rounds=15 if use_early_stopping else None)
    kwargs = {}
    if use_early_stopping:
        history = [r.quantity for r in rows]
        ex = []
        ey = []
        for item in eval_rows:
            ex.append(_features(history, item.day))
            ey.append(item.quantity)
            history.append(item.quantity)
        kwargs = {"eval_set": [(np.asarray(ex), np.asarray(ey))], "verbose": False}
    model.fit(x, y, **kwargs)
    return model


def recursive_xgboost(model, history, days):
    values, predictions = list(history), []
    for day in days:
        prediction = max(0.0, float(model.predict(np.asarray([_features(values, day)]))[0]))
        values.append(prediction)
        predictions.append(prediction)
    return predictions


def _folds(rows, count=3, horizon=14):
    minimum = 45
    if len(rows) < minimum + count * horizon:
        return []
    start = len(rows) - count * horizon
    return [
        (rows[: start + i * horizon], rows[start + i * horizon : start + (i + 1) * horizon])
        for i in range(count)
    ]


def _intervals(predictions, lower_residual, upper_residual):
    return (
        [max(0.0, p + lower_residual) for p in predictions],
        [max(0.0, p + upper_residual) for p in predictions],
    )


def train_verified_xgboost(
    rows: Sequence[Observation], bounds: SplitBoundaries, *, seed=42, window=7, horizon=14
):
    """Select entirely before final test, then evaluate from one fixed pre-test origin."""
    evaluation_started = time.perf_counter()
    train, validation, final_test = chronological_partitions(rows, bounds)
    training_started = time.perf_counter()
    candidates = [
        {"max_depth": 3, "learning_rate": 0.05, "n_estimators": 300},
        {"max_depth": 4, "learning_rate": 0.05, "n_estimators": 300},
        {"max_depth": 3, "learning_rate": 0.1, "n_estimators": 240},
    ]
    folds = _folds(train)
    scored = []
    for params in candidates:
        fold_metrics = []
        for fit, check in folds:
            model = _fit(fit, params, seed)
            predicted = recursive_xgboost(model, [r.quantity for r in fit], [r.day for r in check])
            fold_metrics.append(evaluate([r.quantity for r in check], predicted).mae)
        if fold_metrics:
            scored.append((sum(fold_metrics) / len(fold_metrics), params))
    selection_fallback = None
    if scored:
        selected = min(scored, key=lambda item: item[0])[1]
    else:
        selected = candidates[0]
        selection_fallback = "Three training-only chronological folds were not feasible; conservative parameters were used."

    # Reserve later pre-test validation observations for calibration after selection is frozen.
    if len(validation) >= 20:
        calibration = validation[-max(10, len(validation) // 3) :]
        method_validation = validation[: -len(calibration)]
    else:
        method_validation, calibration = validation, []
    selection_model = _fit(train, selected, seed, method_validation)
    best_iteration = getattr(selection_model, "best_iteration", None)
    selected = dict(selected)
    if best_iteration is not None:
        selected["n_estimators"] = int(best_iteration) + 1
    training_ms = (time.perf_counter() - training_started) * 1000
    validation_started = time.perf_counter()
    train_values = [r.quantity for r in train]
    xgb_validation = recursive_xgboost(
        selection_model, train_values, [r.day for r in method_validation]
    )
    ma_validation = moving_average(train_values, len(method_validation), window)
    actual_validation = [r.quantity for r in method_validation]
    xgb_metric, ma_metric = (
        evaluate(actual_validation, xgb_validation),
        evaluate(actual_validation, ma_validation),
    )
    inverse_xgb, inverse_ma = 1 / max(xgb_metric.mae, 1e-9), 1 / max(ma_metric.mae, 1e-9)
    weight = inverse_xgb / (inverse_xgb + inverse_ma)
    ensemble_validation = [
        weight * x + (1 - weight) * m for x, m in zip(xgb_validation, ma_validation, strict=True)
    ]
    validation_predictions = {
        "movingAverage": ma_validation,
        "xgboost": xgb_validation,
        "ensemble": ensemble_validation,
    }
    validation_metrics = {
        name: asdict(evaluate(actual_validation, pred))
        for name, pred in validation_predictions.items()
    }
    operating_method = min(validation_metrics, key=lambda name: validation_metrics[name]["mae"])
    validation_ms = (time.perf_counter() - validation_started) * 1000

    interval_available = len(calibration) >= 10
    q10 = q90 = None
    if interval_available:
        calibration_fit = [*train, *method_validation]
        calibration_model = _fit(calibration_fit, selected, seed)
        calibration_xgb = recursive_xgboost(
            calibration_model, [r.quantity for r in calibration_fit], [r.day for r in calibration]
        )
        calibration_ma = moving_average(
            [r.quantity for r in calibration_fit], len(calibration), window
        )
        calibration_predictions = {
            "xgboost": calibration_xgb,
            "movingAverage": calibration_ma,
            "ensemble": [
                weight * x + (1 - weight) * m
                for x, m in zip(calibration_xgb, calibration_ma, strict=True)
            ],
        }
        residuals = np.asarray([r.quantity for r in calibration]) - np.asarray(
            calibration_predictions[operating_method]
        )
        q10, q90 = float(np.quantile(residuals, 0.1)), float(np.quantile(residuals, 0.9))

    final_evaluation_started = time.perf_counter()
    fit_rows = [*train, *validation]
    fit_values = [r.quantity for r in fit_rows]
    evaluation_model = _fit(fit_rows, selected, seed)
    test_days = [r.day for r in final_test]
    test_actual = [r.quantity for r in final_test]
    xgb_test = recursive_xgboost(evaluation_model, fit_values, test_days)
    ma_test = moving_average(fit_values, len(final_test), window)
    ensemble_test = [weight * x + (1 - weight) * m for x, m in zip(xgb_test, ma_test, strict=True)]
    test_predictions = {"xgboost": xgb_test, "movingAverage": ma_test, "ensemble": ensemble_test}
    selected_test = test_predictions[
        "movingAverage" if operating_method == "movingAverage" else operating_method
    ]
    coverage = None
    if interval_available:
        test_lower, test_upper = _intervals(selected_test, q10, q90)
        coverage = sum(
            lo <= actual <= hi
            for actual, lo, hi in zip(test_actual, test_lower, test_upper, strict=True)
        ) / len(test_actual)

    all_rows = [*fit_rows, *final_test]
    operational_model = _fit(all_rows, selected, seed)
    future_days = [bounds.final_test_end + timedelta(days=i + 1) for i in range(horizon)]
    history = [r.quantity for r in all_rows]
    future_xgb = recursive_xgboost(operational_model, history, future_days)
    future_ma = moving_average(history, horizon, window)
    future_ensemble = [
        weight * x + (1 - weight) * m for x, m in zip(future_xgb, future_ma, strict=True)
    ]
    future = {"xgboost": future_xgb, "movingAverage": future_ma, "ensemble": future_ensemble}
    future_selected = future[
        "movingAverage" if operating_method == "movingAverage" else operating_method
    ]
    lower, upper = _intervals(future_selected, q10, q90) if interval_available else (None, None)
    evaluation_ms = (time.perf_counter() - final_evaluation_started) * 1000
    total_modeling_ms = (time.perf_counter() - evaluation_started) * 1000
    return {
        "implementation": "xgboost.XGBRegressor",
        "xgboostVersion": xgboost_version,
        "objective": "reg:squarederror",
        "seed": seed,
        "parameters": selected,
        "timing": {
            "trainingMs": training_ms,
            "validationMs": validation_ms,
            "evaluationMs": evaluation_ms,
            "totalModelingMs": total_modeling_ms,
        },
        "effectiveFolds": len(folds),
        "selectionFallback": selection_fallback,
        "earlyStoppingUsed": best_iteration is not None,
        "bestIteration": best_iteration,
        "xgbWeight": weight,
        "operatingMethod": operating_method,
        "validation": validation_metrics,
        "finalTest": {
            name: asdict(evaluate(test_actual, pred)) for name, pred in test_predictions.items()
        },
        "interval": {
            "available": interval_available,
            "selectionObservations": len(method_validation),
            "calibrationObservations": len(calibration),
            "calibrationStart": str(calibration[0].day) if calibration else None,
            "calibrationEnd": str(calibration[-1].day) if calibration else None,
            "calibrationSplit": "late_validation_reserved_after_selection",
            "lowerResidual": q10,
            "upperResidual": q90,
            "finalTestCoverage": coverage,
        },
        "model": operational_model,
        "testDays": [str(r.day) for r in final_test],
        "testActual": test_actual,
        "testPredictions": test_predictions,
        "futurePredictions": future,
        "futureLower": lower,
        "futureUpper": upper,
    }
