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
from .forecasting import (
    Observation,
    SplitBoundaries,
    evaluate,
    moving_average,
    train_verified_xgboost,
)

logger = logging.getLogger(__name__)


def daily_observations(rows: list[dict[str, Any]], start: date, end: date) -> list[Observation]:
    totals = {row["sale_date"]: float(row["quantity"]) for row in rows}
    return [
        Observation(start + timedelta(days=index), totals.get(start + timedelta(days=index), 0.0))
        for index in range((end - start).days + 1)
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


def training_eligibility(observations, run, settings, rank):
    training = [item for item in observations if item.day <= run["training_end"]]
    nonzero, days = sum(item.quantity > 0 for item in training), len(training)
    eligible = (
        days >= max(31, settings["minimum_history_weeks"] * 7)
        and nonzero >= settings["minimum_nonzero_days"]
        and rank < settings["top_n_products"]
    )
    reason = (
        None
        if eligible
        else (
            f"Training history: {days} days, {nonzero} nonzero days, rank {rank + 1}; "
            f"requires {settings['minimum_history_weeks']} weeks, "
            f"{settings['minimum_nonzero_days']} nonzero days and top {settings['top_n_products']}."
        )
    )
    return eligible, days, nonzero, reason


def process_run(conn: Connection, run: dict[str, Any]) -> None:
    snapshot = run["data_snapshot"]
    if not all(key in snapshot for key in ("dailySales", "settings", "products")):
        raise ValueError(
            "This older queued run has no immutable input snapshot; refresh to create one"
        )
    settings, series = snapshot["settings"], {}
    for product_id in snapshot["products"]:
        rows = [
            {"sale_date": date.fromisoformat(item["date"]), "quantity": item["quantity"]}
            for item in snapshot["dailySales"]
            if item["productId"] == product_id
        ]
        series[product_id] = daily_observations(rows, run["training_start"], run["final_test_end"])
    # Product ranking and the nonzero-day gate use training only.
    products = sorted(
        series,
        key=lambda pid: (
            -sum(item.quantity for item in series[pid] if item.day <= run["training_end"]),
            pid,
        ),
    )
    bounds = SplitBoundaries(run["training_end"], run["validation_end"], run["final_test_end"])
    configuration = dict(run["configuration"])
    configuration.update(
        {
            "runtime": "xgboost.XGBRegressor",
            "xgboostVersion": xgboost_version,
            "selectionSplit": "validation",
            "evaluationSplit": "final_test",
            "evaluationProtocol": "recursive_fixed_cutoff",
            "missingDayPolicy": "zero_sales",
            "operationalRefitEnd": str(run["final_test_end"]),
            "products": {},
        }
    )
    artifacts = get_settings().artifact_dir / str(run["id"])
    artifacts.mkdir(parents=True, exist_ok=True)
    with conn.transaction():
        for rank, product_id in enumerate(products):
            observations = series[product_id]
            eligible, days, nonzero, reason = training_eligibility(
                observations, run, settings, rank
            )
            test = [item for item in observations if item.day > run["validation_end"]]
            summary = {
                "historyDays": days,
                "nonzeroDays": nonzero,
                "eligible": eligible,
                "fallbackReason": reason,
                "operatingMethod": "fallback",
            }
            if eligible:
                result = train_verified_xgboost(
                    observations,
                    bounds,
                    window=settings["moving_average_window"],
                    horizon=run["forecast_horizon_days"],
                )
                summary.update(
                    {
                        "parameters": result["parameters"],
                        "xgbWeight": result["xgbWeight"],
                        "operatingMethod": result["operatingMethod"],
                        "artifact": f"{run['id']}/{product_id}.json",
                    }
                )
                result["model"].save_model(artifacts / f"{product_id}.json")
                for split, metrics in (
                    ("validation", result["validation"]),
                    ("final_test", result["finalTest"]),
                ):
                    for method, metric in metrics.items():
                        _persist_metric_values(
                            conn, run, product_id, _method(method), metric, split
                        )
                for method, predictions in result["testPredictions"].items():
                    _persist_predictions(conn, run, product_id, test, _method(method), predictions)
                future_predictions = result["futurePredictions"]
            else:
                history = [
                    item.quantity for item in observations if item.day <= run["validation_end"]
                ]
                ma = moving_average(history, len(test), settings["moving_average_window"])
                _persist_predictions(conn, run, product_id, test, "moving_average", ma)
                metric = evaluate([item.quantity for item in test], ma)
                _persist_metric_values(
                    conn,
                    run,
                    product_id,
                    "moving_average",
                    {"mae": metric.mae, "rmse": metric.rmse, "observations": metric.observations},
                )
                future_predictions = {
                    "fallback": moving_average(
                        [item.quantity for item in observations],
                        run["forecast_horizon_days"],
                        settings["moving_average_window"],
                    )
                }
            for method, predictions in future_predictions.items():
                for index, prediction in enumerate(predictions, start=1):
                    conn.execute(
                        """INSERT INTO forecast_predictions
                        (business_id,forecast_run_id,product_id,prediction_date,method,dataset_split,
                         predicted_quantity,fallback_reason) VALUES(%s,%s,%s,%s,%s,'future',%s,%s)""",
                        (
                            run["business_id"],
                            run["id"],
                            product_id,
                            run["final_test_end"] + timedelta(days=index),
                            _method(method),
                            Decimal(str(prediction)),
                            reason,
                        ),
                    )
            configuration["products"][product_id] = summary
        conn.execute(
            """UPDATE forecast_runs SET status='completed',algorithm_version=%s,configuration=%s,
               completed_at=now(),xgboost_verified=false WHERE id=%s""",
            (xgboost_version, Jsonb(configuration), run["id"]),
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
            # The prediction transaction rolls back; commit the failed state independently.
            with conn.transaction():
                conn.execute(
                    """UPDATE forecast_runs SET status='failed',failure_message=%s,
                                completed_at=now() WHERE id=%s""",
                    (str(error)[:2000], run["id"]),
                )
            shutil.rmtree(get_settings().artifact_dir / str(run["id"]), ignore_errors=True)
            logger.exception("Forecast run %s failed", run["id"])
        finally:
            conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", (str(run["id"]),))
        return True


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    while True:
        try:
            if run_once():
                continue
        except psycopg.Error:
            logger.exception("Database unavailable; worker will retry")
        time.sleep(settings.forecast_poll_seconds)


if __name__ == "__main__":
    main()
