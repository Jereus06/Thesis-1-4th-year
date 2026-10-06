"""Durable PostgreSQL forecast worker using the official CPU XGBoost runtime."""

from __future__ import annotations

import logging
import shutil
import time
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from xgboost import __version__ as xgboost_version

from .config import get_settings
from .data_quality import FALLBACK_POLICY_VERSION, POLICY_VERSION, contiguous_tail, prepare_product_series
from .forecasting import (
    Observation,
    PhaseTimings,
    SplitBoundaries,
    evaluate,
    moving_average,
    train_verified_xgboost,
)
from .repository import Repository

logger = logging.getLogger(__name__)


def daily_observations(
    rows: list[dict[str, Any]], start: date, end: date, quality=(), product_id=None
) -> list[Observation]:
    """Apply the reviewed policy without filling absent or excluded dates with zeros."""
    prepared = prepare_product_series(rows, quality, product_id, start, end)
    return [
        Observation(item.day, item.quantity)
        for item in prepared.targets
    ]


def claim_run(conn: Connection) -> dict[str, Any] | None:
    with conn.transaction():
        # Session advisory locks disappear when a worker disconnects or crashes.
        for running in conn.execute(
            "SELECT id FROM forecast_runs WHERE status='running' FOR UPDATE SKIP LOCKED"
        ).fetchall():
            acquired = conn.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s,0)) AS locked",
                (str(running["id"]),),
            ).fetchone()["locked"]
            if acquired:
                _discard_run_results(conn, running["id"])
                _discard_run_artifacts(running["id"])
                conn.execute(
                    """UPDATE forecast_runs SET status='failed',completed_at=now(),
                                failure_message='Worker interrupted; refresh to retry' WHERE id=%s""",
                    (running["id"],),
                )
                conn.execute(
                    "SELECT pg_advisory_unlock(hashtextextended(%s,0))", (str(running["id"]),)
                )
        row = conn.execute(
            """SELECT * FROM forecast_runs WHERE status='queued' ORDER BY created_at,id
               FOR UPDATE SKIP LOCKED LIMIT 1"""
        ).fetchone()
        if not row:
            return None
        locked = conn.execute(
            "SELECT pg_try_advisory_lock(hashtextextended(%s,0)) AS locked", (str(row["id"]),)
        ).fetchone()["locked"]
        if not locked:
            return None
        return conn.execute(
            """UPDATE forecast_runs SET status='running',started_at=now(),failure_message=NULL
               WHERE id=%s RETURNING *""",
            (row["id"],),
        ).fetchone()


def training_eligibility(observations, run, settings):
    training_start = run.get(
        "training_start",
        min(
            (item.day for item in observations if item.day <= run["training_end"]),
            default=run["training_end"],
        ),
    )
    training = [
        item for item in observations if training_start <= item.day <= run["training_end"]
    ]
    nonzero, days = sum(item.quantity > 0 for item in training), len(training)
    calendar_days = (run["training_end"] - training_start).days + 1
    complete = days == calendar_days
    eligible = (
        complete
        and days >= max(31, settings["minimum_history_weeks"] * 7)
        and nonzero >= settings["minimum_nonzero_days"]
    )
    reason = (
        None
        if eligible
        else (
            f"Training history: {days}/{calendar_days} classified calendar days, "
            f"{nonzero} nonzero days; requires a complete daily sequence, "
            f"at least {max(31, settings['minimum_history_weeks'] * 7)} training days "
            f"and {settings['minimum_nonzero_days']} nonzero days."
        )
    )
    return eligible, days, nonzero, reason


def select_training_scope(series, run, settings):
    """Apply all eligibility gates before limiting training to high-volume products."""
    scope = {}
    expected_days = (run["final_test_end"] - run["training_start"]).days + 1
    for product_id, observations in series.items():
        eligible, days, nonzero, reason = training_eligibility(observations, run, settings)
        if eligible and len(observations) != expected_days:
            eligible = False
            reason = (
                "XGBoost evaluation requires every validation/test calendar date to be "
                "observed or explicitly confirmed zero; excluded or missing dates remain."
            )
        scope[product_id] = eligible, days, nonzero, reason

    ranked = sorted(
        (product_id for product_id in series if scope[product_id][0]),
        key=lambda pid: (
            -sum(
                item.quantity
                for item in series[pid]
                if run["training_start"] <= item.day <= run["training_end"]
            ),
            pid,
        ),
    )
    for rank, product_id in enumerate(ranked):
        if rank >= settings["top_n_products"]:
            _, days, nonzero, _ = scope[product_id]
            scope[product_id] = (
                False,
                days,
                nonzero,
                f"Outside top {settings['top_n_products']} eligible products by "
                f"training-period sales volume (rank {rank + 1}); Moving Average fallback.",
            )
    return scope


def process_run(conn: Connection, run: dict[str, Any]) -> None:
    total_started = time.perf_counter()
    phases = PhaseTimings()
    snapshot = run["data_snapshot"]
    if not all(key in snapshot for key in ("dailySales", "settings", "products")):
        raise ValueError(
            "This older queued run has no immutable input snapshot; refresh to create one"
        )
    preparation_started = time.perf_counter()
    settings, series = snapshot["settings"], {}
    prepared_products = snapshot.get("preparedProducts")
    preparation_source = "frozen_prepared_snapshot"
    policy_version = snapshot.get("preparationPolicyVersion", POLICY_VERSION)
    if prepared_products is None:
        # Older queued runs retain raw immutable inputs. Upgrade preparation from
        # those inputs only; never read classifications or sales from the live store.
        prepared_products = {}
        preparation_source = "prepared_from_legacy_snapshot"
        policy_version = POLICY_VERSION
        for product_id in snapshot["products"]:
            rows = [
                {"sale_date": date.fromisoformat(item["date"]), "quantity": item["quantity"]}
                for item in snapshot["dailySales"]
                if item["productId"] == product_id
            ]
            prepared_products[product_id] = prepare_product_series(
                rows,
                snapshot.get("dataQuality", []),
                product_id,
                run["training_start"],
                run["final_test_end"],
            ).snapshot()
    for product_id in snapshot["products"]:
        if product_id not in prepared_products:
            raise ValueError("Queued run has an incomplete prepared snapshot; refresh to retry")
        series[product_id] = [
            Observation(date.fromisoformat(item["day"]), float(item["quantity"]))
            for item in prepared_products[product_id]["targets"]
        ]
    scope = select_training_scope(series, run, settings)
    bounds = SplitBoundaries(run["training_end"], run["validation_end"], run["final_test_end"])
    configuration = dict(run["configuration"])
    configuration.update(
        {
            "runtime": "xgboost.XGBRegressor",
            "xgboostVersion": xgboost_version,
            "selectionSplit": "validation",
            "evaluationSplit": "final_test",
            "evaluationProtocol": "recursive_fixed_cutoff",
            "cvFolds": settings.get("cv_folds", 3),
            "cvValidationDays": 14,
            "missingDayPolicy": "explicit_classification_required",
            "excludedTargets": "closures, incomplete records, full/partial stockouts, and unclassified absent dates",
            "lagPolicy": "XGBoost requires a complete observed-or-confirmed-zero daily training sequence",
            "preparationSource": preparation_source,
            "preparationPolicyVersion": policy_version,
            "operationalRefitEnd": str(run["final_test_end"]),
            "fallbackPolicy": FALLBACK_POLICY_VERSION,
            "products": {},
        }
    )
    artifacts = get_settings().artifact_dir / str(run["id"])
    phases.add("preparationMs", (time.perf_counter() - preparation_started) * 1000)
    prepared_results = []
    for product_id in series:
        with phases.measure("preparationMs"):
            observations = series[product_id]
            forecast_origin = observations[-1].day if observations else None
            eligible, days, nonzero, reason = scope[product_id]
            test = [item for item in observations if item.day > run["validation_end"]]
            prepared_snapshot = prepared_products[product_id]
            summary = {
                "historyDays": days,
                "nonzeroDays": nonzero,
                "eligible": eligible,
                "fallbackReason": reason,
                "operatingMethod": "fallback",
                "firstUsableDate": str(observations[0].day) if observations else None,
                "lastUsableDate": str(forecast_origin) if forecast_origin else None,
                "forecastOriginDate": str(forecast_origin) if forecast_origin else None,
                "preparationPolicyVersion": policy_version,
                "unknownDays": len(prepared_snapshot.get("unknownDates", [])),
                "excludedDays": len(prepared_snapshot.get("excludedDates", [])),
                "qualityWarnings": [
                    item["message"] for item in prepared_snapshot.get("warnings", [])
                ],
            }
        if eligible:
            result = train_verified_xgboost(
                observations,
                bounds,
                window=settings["moving_average_window"],
                horizon=run["forecast_horizon_days"],
                cv_folds=settings.get("cv_folds", 3),
            )
            with phases.measure("preparationMs"):
                summary.update(
                    {
                        "parameters": result["parameters"],
                        "xgbWeight": result["xgbWeight"],
                        "operatingMethod": result["operatingMethod"],
                        "artifact": f"{run['id']}/{product_id}.json",
                        "requestedFolds": result["requestedFolds"],
                        "effectiveFolds": result["effectiveFolds"],
                        "selectionFallback": result["selectionFallback"],
                        "earlyStoppingUsed": result["earlyStoppingUsed"],
                        "bestIteration": result["bestIteration"],
                        "interval": result["interval"],
                        "timing": result["timing"],
                    }
                )
                for key, value in result["timing"].items():
                    phases.add(key, value)
                metric_groups = (
                    ("validation", result["validation"]),
                    ("final_test", result["finalTest"]),
                )
                test_predictions = result["testPredictions"]
                future_predictions = result["futurePredictions"]
                interval_method = _method(result["operatingMethod"])
                future_lower, future_upper = result["futureLower"], result["futureUpper"]
                model = result["model"]
        else:
            metric_groups = ()
            test_predictions = {}
            future_predictions = {}
            model = None
            interval_method = future_lower = future_upper = None
            if observations:
                baseline_started = time.perf_counter()
                with phases.measure("evaluationMs"):
                    # Daily lags must not bridge an unknown/stockout day by
                    # compressing the remaining observations into adjacent rows.
                    history = contiguous_tail(
                        [item for item in observations if item.day <= run["validation_end"]],
                        run["validation_end"],
                    )
                    if history and test:
                        calendar_predictions = moving_average(
                            [item.quantity for item in history],
                            (run["final_test_end"] - run["validation_end"]).days,
                            settings["moving_average_window"],
                        )
                        # Missing targets remain unscored; elapsed calendar days
                        # still count as recursive forecast steps.
                        ma = [
                            calendar_predictions[(item.day - run["validation_end"]).days - 1]
                            for item in test
                        ]
                        test_predictions = {"moving_average": ma}
                        metric = evaluate([item.quantity for item in test], ma)
                        metric_groups = (("final_test", {"moving_average": {
                            "mae": metric.mae,
                            "rmse": metric.rmse,
                            "observations": metric.observations,
                        }}),)
                    elif test:
                        summary["baselineEvaluationReason"] = (
                            "No contiguous usable history at the validation cutoff; "
                            "final-test predictions and metrics are unavailable."
                        )
                    future_predictions = {
                        "fallback": moving_average(
                            [item.quantity for item in contiguous_tail(observations, forecast_origin)],
                            run["forecast_horizon_days"],
                            settings["moving_average_window"],
                        )
                    }
                phases.add("totalModelingMs", (time.perf_counter() - baseline_started) * 1000)
        with phases.measure("preparationMs"):
            configuration["products"][product_id] = summary
            prepared_results.append((
                product_id, model, test, test_predictions, metric_groups,
                future_predictions, interval_method, future_lower, future_upper, reason,
                forecast_origin,
            ))

    # Model computation is complete before this transaction. Its measured scope
    # includes artifact writes, result SQL, and the result transaction's commit.
    with phases.measure("persistenceMs"):
        artifacts.mkdir(parents=True, exist_ok=True)
        with conn.transaction():
            for (
                product_id, model, test, test_predictions, metric_groups,
                future_predictions, interval_method, future_lower, future_upper, reason,
                forecast_origin,
            ) in prepared_results:
                if model is not None:
                    model.save_model(artifacts / f"{product_id}.json")
                for split, metrics in metric_groups:
                    for method, metric in metrics.items():
                        _persist_metric_values(conn, run, product_id, _method(method), metric, split)
                for method, predictions in test_predictions.items():
                    _persist_predictions(conn, run, product_id, test, _method(method), predictions)
                for method, predictions in future_predictions.items():
                    for index, prediction in enumerate(predictions, start=1):
                        persisted_method = _method(method)
                        lower = (
                            future_lower[index - 1]
                            if future_lower is not None and persisted_method == interval_method
                            else None
                        )
                        upper = (
                            future_upper[index - 1]
                            if future_upper is not None and persisted_method == interval_method
                            else None
                        )
                        conn.execute(
                            """INSERT INTO forecast_predictions
                            (business_id,forecast_run_id,product_id,prediction_date,method,dataset_split,
                             predicted_quantity,lower_bound,upper_bound,fallback_reason)
                             VALUES(%s,%s,%s,%s,%s,'future',%s,%s,%s,%s)""",
                            (
                                run["business_id"], run["id"], product_id,
                                forecast_origin + timedelta(days=index), persisted_method,
                                Decimal(str(prediction)),
                                Decimal(str(lower)) if lower is not None else None,
                                Decimal(str(upper)) if upper is not None else None,
                                reason,
                            ),
                        )
            conn.execute(
                """UPDATE forecast_runs SET algorithm_version=%s,configuration=%s,
                   xgboost_verified=false WHERE id=%s""",
                (xgboost_version, Jsonb(configuration), run["id"]),
            )
    total_ms = (time.perf_counter() - total_started) * 1000
    queue_ms = max(0.0, (run["started_at"] - run["created_at"]).total_seconds() * 1000)
    validation_evaluation = [
        value for key in ("validationMs", "evaluationMs")
        if (value := phases.get(key)) is not None
    ]
    timing = {
        key: round(value, 3) if value is not None else None
        for key in (
            "preparationMs", "trainingMs", "validationMs", "evaluationMs",
            "persistenceMs", "totalModelingMs",
        )
        for value in (phases.get(key),)
    }
    timing.update({
        "validationEvaluationMs": (
            round(sum(validation_evaluation), 3) if validation_evaluation else None
        ),
        "queueWaitMs": round(queue_ms, 3),
        "totalProcessingMs": round(total_ms, 3),
        "measuredWith": "time.perf_counter",
        "timingVersion": "disjoint_phases_v1",
        "timingScope": (
            "Processing starts at process_run and ends after artifact/result SQL commit; "
            "queue wait and the final timing/status publication transaction are excluded. "
            "Training includes every fit; validation includes training-CV and selection "
            "predictions/metrics plus calibration residuals; evaluation includes final-test "
            "metrics/coverage and future predictions. Phase durations do not overlap."
        ),
        "workerCompletedAt": time.time(),
    })
    # The run remains running until both results and their measured evidence exist.
    # Failure or interruption here discards the already committed result rows.
    with conn.transaction():
        conn.execute(
            """UPDATE forecast_runs SET status='completed',timing=%s,
               completed_at=now() WHERE id=%s""",
            (Jsonb(timing), run["id"]),
        )


def _method(method):
    return "moving_average" if method == "movingAverage" else method


def _persist_predictions(conn, run, product_id, observations, method, predictions):
    for observation, prediction in zip(observations, predictions, strict=True):
        conn.execute(
            """INSERT INTO forecast_predictions
            (business_id,forecast_run_id,product_id,prediction_date,method,dataset_split,
             predicted_quantity,actual_quantity) VALUES(%s,%s,%s,%s,%s,'final_test',%s,%s)""",
            (
                run["business_id"],
                run["id"],
                product_id,
                observation.day,
                method,
                Decimal(str(prediction)),
                Decimal(str(observation.quantity)),
            ),
        )


def _persist_metric_values(conn, run, product_id, method, metric, split="final_test"):
    conn.execute(
        """INSERT INTO forecast_metrics
        (business_id,forecast_run_id,product_id,method,dataset_split,mae,rmse,observation_count)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            run["business_id"],
            run["id"],
            product_id,
            method,
            split,
            Decimal(str(metric["mae"])),
            Decimal(str(metric["rmse"])),
            metric["observations"],
        ),
    )


def _discard_run_results(conn, run_id):
    """Remove results committed before a failed/interrupted timing publication."""
    conn.execute("DELETE FROM forecast_predictions WHERE forecast_run_id=%s", (run_id,))
    conn.execute("DELETE FROM forecast_metrics WHERE forecast_run_id=%s", (run_id,))


def _discard_run_artifacts(run_id):
    artifact_root = get_settings().artifact_dir.resolve()
    run_artifacts = (artifact_root / str(run_id)).resolve()
    if run_artifacts.parent != artifact_root:
        raise ValueError("Run artifact directory must be directly inside the artifact root")
    shutil.rmtree(run_artifacts, ignore_errors=True)


def run_once() -> bool:
    with psycopg.connect(
        str(get_settings().database_url), row_factory=dict_row, autocommit=True
    ) as conn:
        run = claim_run(conn)
        if not run:
            return False
        try:
            process_run(conn, run)
        except Exception as error:
            # Result insertion rolls back on failure. If the later publication
            # failed, remove its already committed results before marking failed.
            with conn.transaction():
                _discard_run_results(conn, run["id"])
                conn.execute(
                    """UPDATE forecast_runs SET status='failed',failure_message=%s,
                                completed_at=now() WHERE id=%s""",
                    (str(error)[:2000], run["id"]),
                )
            _discard_run_artifacts(run["id"])
            logger.exception("Forecast run %s failed", run["id"])
        finally:
            conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", (str(run["id"]),))
        return True


def schedule_once() -> int:
    settings = get_settings()
    if not settings.forecast_daily_enabled:
        return 0
    with psycopg.connect(
        str(settings.database_url), row_factory=dict_row, autocommit=True
    ) as conn:
        now = conn.execute("SELECT clock_timestamp() AS scheduler_now").fetchone()["scheduler_now"]
        return Repository(conn).schedule_daily_forecasts(now, settings.forecast_daily_time)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    schedule_deadline = time.monotonic()
    while True:
        try:
            if settings.forecast_daily_enabled and time.monotonic() >= schedule_deadline:
                # Check even while queued jobs keep run_once busy. Downtime is caught up
                # with one current due slot, instead of replaying every missed day.
                schedule_deadline = time.monotonic() + settings.forecast_schedule_poll_seconds
                schedule_once()
            if run_once():
                continue
        except psycopg.Error:
            logger.exception("Database unavailable; worker will retry")
        if settings.forecast_daily_enabled:
            until_schedule = max(0.0, schedule_deadline - time.monotonic())
            time.sleep(min(settings.forecast_poll_seconds, until_schedule))
        else:
            time.sleep(settings.forecast_poll_seconds)


if __name__ == "__main__":
    main()
