"""Actual saved worker timings and atomic cleanup around result publication."""

from math import isfinite
from types import SimpleNamespace

import psycopg
import pytest
from psycopg.rows import dict_row

from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401
from test_refresh_intervals import (
    normal_refresh_and_process, refresh_client, seed_daily_history,
)  # noqa: F401


@pytest.mark.parametrize("history_days", [134, 18])
def test_actual_worker_saves_disjoint_measured_phases_for_ml_and_baseline(
    refresh_client, history_days
):
    client, business, base, _settings = refresh_client
    product, _start = seed_daily_history(client, business, base, history_days)
    _queued, completed, predictions, _metrics = normal_refresh_and_process(client, base)
    timing = completed["timing"]
    for field in ("preparationMs", "evaluationMs", "validationEvaluationMs", "persistenceMs",
                  "totalModelingMs", "totalProcessingMs"):
        assert isfinite(timing[field]) and timing[field] > 0
    assert timing["queueWaitMs"] >= 0
    assert timing["measuredWith"] == "time.perf_counter"
    assert timing["timingVersion"] == "disjoint_phases_v1"
    assert "result SQL commit" in timing["timingScope"]
    assert "publication transaction are excluded" in timing["timingScope"]
    summary = completed["configuration"]["products"][product["id"]]
    if history_days == 134:
        assert summary["eligible"] and summary["interval"]["available"]
        assert timing["trainingMs"] > 0 and timing["validationMs"] > 0
        model_timing = summary["timing"]
        for phase in ("trainingMs", "validationMs", "evaluationMs", "totalModelingMs"):
            assert timing[phase] == pytest.approx(model_timing[phase], abs=0.0006)
        assert timing["validationEvaluationMs"] == pytest.approx(
            timing["validationMs"] + timing["evaluationMs"], abs=0.0011
        )
    else:
        assert not summary["eligible"]
        assert timing["trainingMs"] is timing["validationMs"] is None
        assert timing["validationEvaluationMs"] == timing["evaluationMs"]
        assert all(point["method"] in ("moving_average", "fallback") for point in predictions)
    measured_phases = (
        timing["preparationMs"] + (timing["trainingMs"] or 0)
        + timing["validationEvaluationMs"] + timing["persistenceMs"]
    )
    assert measured_phases <= timing["totalProcessingMs"] + 0.004


class FailingConnection:
    """Inject a failure at real SQL boundaries while retaining PostgreSQL transactions."""

    def __init__(self, conn, failure, artifact):
        self.conn = conn
        self.failure = failure
        self.artifact = artifact
        self.inserts = 0
        self.observed_committed_results = False

    def __enter__(self):
        self.conn.__enter__()
        return self

    def __exit__(self, *args):
        return self.conn.__exit__(*args)

    def transaction(self):
        return self.conn.transaction()

    def execute(self, statement, parameters=None):
        if isinstance(statement, str):
            if "INSERT INTO forecast_predictions" in statement:
                self.inserts += 1
                if self.failure == "result_insert" and self.inserts == 2:
                    raise RuntimeError("Synthetic result insertion failure")
            if "status='completed'" in statement:
                # The first result transaction already committed successfully.
                count = self.conn.execute("SELECT count(*) AS n FROM forecast_predictions").fetchone()["n"]
                self.observed_committed_results = count > 0
                assert self.observed_committed_results
                assert self.artifact.exists()
                if self.failure == "publication":
                    raise RuntimeError("Synthetic timing publication failure")
        return self.conn.execute(statement, parameters)


@pytest.mark.parametrize("failure", ["result_insert", "publication"])
def test_failed_result_or_timing_publication_discards_all_rows_and_model_artifacts(
    refresh_client, monkeypatch, tmp_path, failure
):
    client, business, base, _settings = refresh_client
    product, _start = seed_daily_history(client, business, base, 134)
    response = client.post(base + "/forecast-refresh")
    assert response.status_code == 202, response.text
    run_id = response.json()["data"]["id"]
    artifact = tmp_path / "models" / run_id / f"{product['id']}.json"
    from app import worker

    real_connect = psycopg.connect
    connections = []

    def connect(*args, **kwargs):
        conn = FailingConnection(real_connect(*args, **kwargs), failure, artifact)
        connections.append(conn)
        return conn

    monkeypatch.setattr(worker, "psycopg", SimpleNamespace(connect=connect))
    assert worker.run_once()
    assert connections[0].inserts >= 2
    assert connections[0].observed_committed_results == (failure == "publication")
    completed = client.get(base + f"/forecast-runs/{run_id}").json()["data"]
    assert completed["status"] == "failed"
    assert completed["timing"] == {}
    assert client.get(base + f"/forecast-runs/{run_id}/predictions").json()["data"] == []
    assert client.get(base + f"/forecast-runs/{run_id}/metrics").json()["data"] == []
    assert not artifact.parent.exists()


def test_worker_recovers_interruption_after_result_commit_without_leaving_results(
    refresh_client, pg_client, tmp_path
):
    client, business, base, _settings = refresh_client
    _same_client, _same_business, dsn = pg_client
    product, _start = seed_daily_history(client, business, base, 134)
    response = client.post(base + "/forecast-refresh")
    assert response.status_code == 202, response.text
    run_id = response.json()["data"]["id"]
    artifact = tmp_path / "models" / run_id / f"{product['id']}.json"
    from app import worker

    with psycopg.connect(dsn, row_factory=dict_row, autocommit=True) as raw:
        run = worker.claim_run(raw)
        assert str(run["id"]) == run_id
        conn = FailingConnection(raw, "publication", artifact)
        with pytest.raises(RuntimeError, match="Synthetic timing publication failure"):
            worker.process_run(conn, run)
        assert conn.observed_committed_results and artifact.exists()
    # Closing the first worker releases its advisory lock, just as a crash would.
    running = client.get(base + f"/forecast-runs/{run_id}").json()["data"]
    assert running["status"] == "running" and running["timing"] == {}
    assert worker.run_once() is False  # Recovery finds no other queued run.
    recovered = client.get(base + f"/forecast-runs/{run_id}").json()["data"]
    assert recovered["status"] == "failed"
    assert "Worker interrupted" in recovered["failureMessage"]
    assert client.get(base + f"/forecast-runs/{run_id}/predictions").json()["data"] == []
    assert client.get(base + f"/forecast-runs/{run_id}/metrics").json()["data"] == []
    assert not artifact.parent.exists()
