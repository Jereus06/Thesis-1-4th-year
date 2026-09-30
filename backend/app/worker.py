"""Forecast worker for queued PostgreSQL forecast runs.

The worker claims one run at a time, evaluates eligible products with the official Python XGBoost
runtime, persists like-for-like final-test predictions/metrics, and creates moving-average future
predictions. It never labels a run as research-verified; that requires the team's external validation.
"""

from __future__ import annotations

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


def daily_observations(rows: list[dict[str, Any]], start: date, end: date) -> list[Observation]:
    totals = {row["sale_date"]: float(row["quantity"]) for row in rows}
    result = []
    current = start
    while current <= end:
        result.append(Observation(current, totals.get(current, 0.0)))
        current += timedelta(days=1)
    return result


def claim_run(conn: Connection) -> dict[str, Any] | None:
    with conn.transaction():
        row = conn.execute(
            """SELECT * FROM forecast_runs WHERE status='queued' ORDER BY created_at,id
               FOR UPDATE SKIP LOCKED LIMIT 1"""
        ).fetchone()
        if not row:
            return None
        return conn.execute(
            """UPDATE forecast_runs SET status='running',started_at=now(),failure_message=NULL
               WHERE id=%s RETURNING *""",
            (row["id"],),
        ).fetchone()


def process_run(conn: Connection, run: dict[str, Any]) -> None:
    settings = conn.execute(
        "SELECT * FROM business_settings WHERE business_id=%s", (run["business_id"],)
    ).fetchone()
    products = conn.execute(
        """SELECT p.id,coalesce(sum(s.quantity),0) AS total_quantity FROM products p
           LEFT JOIN sales s ON s.business_id=p.business_id AND s.product_id=p.id
           AND s.sale_date BETWEEN %s AND %s
           WHERE p.business_id=%s AND p.is_active GROUP BY p.id
           ORDER BY total_quantity DESC,p.id""",
        (run["training_start"], run["final_test_end"], run["business_id"]),
    ).fetchall()
    bounds = SplitBoundaries(run["training_end"], run["validation_end"], run["final_test_end"])
    configuration = dict(run["configuration"])
    configuration.update(
        {
            "runtime": "xgboost.XGBRegressor",
            "xgboostVersion": xgboost_version,
            "selectionSplit": "validation",
            "evaluationSplit": "final_test",
            "futureMethod": "moving_average",
        }
    )

    with conn.transaction():
        for product_index, product in enumerate(products):
            sales = conn.execute(
                """SELECT sale_date,sum(quantity) AS quantity FROM sales
                   WHERE business_id=%s AND product_id=%s AND sale_date BETWEEN %s AND %s
                   GROUP BY sale_date ORDER BY sale_date""",
                (run["business_id"], product["id"], run["training_start"], run["final_test_end"]),
            ).fetchall()
            observations = daily_observations(sales, run["training_start"], run["final_test_end"])
            nonzero = sum(item.quantity > 0 for item in observations)
            history_days = (run["training_end"] - run["training_start"]).days + 1
            eligible = (
                history_days >= settings["minimum_history_weeks"] * 7
                and nonzero >= settings["minimum_nonzero_days"]
                and len(observations) >= 31
                and product_index < settings["top_n_products"]
            )
            history = [item.quantity for item in observations if item.day <= run["validation_end"]]
            test = [
                item
                for item in observations
                if run["validation_end"] < item.day <= run["final_test_end"]
            ]
            ma_test = moving_average(history, len(test), settings["moving_average_window"])
            _persist_predictions(conn, run, product["id"], test, "moving_average", ma_test)
            _persist_metric(
                conn,
                run,
                product["id"],
                "moving_average",
                evaluate([x.quantity for x in test], ma_test),
            )

            future_method = "moving_average"
            future_reason = None
            if eligible:
                result = train_verified_xgboost(observations, bounds)
                for method, metric in result["validation"].items():
                    _persist_metric_values(
                        conn,
                        run,
                        product["id"],
                        "moving_average" if method == "movingAverage" else method,
                        metric,
                        "validation",
                    )
                for method in ("xgboost", "ensemble"):
                    predictions = result["testPredictions"][method]
                    _persist_predictions(conn, run, product["id"], test, method, predictions)
                    metric = result["finalTest"][method]
                    _persist_metric_values(conn, run, product["id"], method, metric)
            else:
                future_method = "fallback"
                future_reason = (
                    f"Requires {settings['minimum_history_weeks']} calendar weeks and "
                    f"{settings['minimum_nonzero_days']} nonzero days; found {history_days} and {nonzero}."
                )

            complete_history = [item.quantity for item in observations]
            future = moving_average(
                complete_history, run["forecast_horizon_days"], settings["moving_average_window"]
            )
            for index, prediction in enumerate(future, start=1):
                conn.execute(
                    """INSERT INTO forecast_predictions
                    (business_id,forecast_run_id,product_id,prediction_date,method,dataset_split,
                     predicted_quantity,fallback_reason) VALUES(%s,%s,%s,%s,%s,'future',%s,%s)""",
                    (
                        run["business_id"],
                        run["id"],
                        product["id"],
                        run["final_test_end"] + timedelta(days=index),
                        future_method,
                        Decimal(str(prediction)),
                        future_reason,
                    ),
                )

        conn.execute(
            """UPDATE forecast_runs SET status='completed',algorithm_version=%s,configuration=%s,
               completed_at=now(),xgboost_verified=false WHERE id=%s""",
            (xgboost_version, Jsonb(configuration), run["id"]),
        )


def _persist_predictions(conn, run, product_id, observations, method, predictions) -> None:
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


def _persist_metric(conn, run, product_id, method, metric) -> None:
    _persist_metric_values(
        conn,
        run,
        product_id,
        method,
        {"mae": metric.mae, "rmse": metric.rmse, "observations": metric.observations},
    )


def _persist_metric_values(conn, run, product_id, method, metric, split="final_test") -> None:
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
    with psycopg.connect(str(get_settings().database_url), row_factory=dict_row) as conn:
        run = claim_run(conn)
        if not run:
            return False
        try:
            process_run(conn, run)
        except Exception as error:
            conn.rollback()
            conn.execute(
                """UPDATE forecast_runs SET status='failed',failure_message=%s,completed_at=now()
                   WHERE id=%s""",
                (str(error)[:2000], run["id"]),
            )
            raise
        return True


def main() -> None:
    settings = get_settings()
    while True:
        if not run_once():
            time.sleep(settings.forecast_poll_seconds)


if __name__ == "__main__":
    main()
