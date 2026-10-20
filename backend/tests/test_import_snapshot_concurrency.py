"""A prestarted import must invalidate a snapshot captured before it saves."""

from datetime import datetime, timedelta
from threading import Event, Thread
import time

import psycopg
from psycopg.rows import dict_row

from app.dashboard import dashboard, dashboard_status
from app.repository import Repository
from app.schemas import ForecastRunCreate, SalesImportCreate
from app.security import Principal
from app.worker import claim_run, process_run
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


def test_prestarted_blocked_import_invalidates_completed_frozen_forecast(pg_client):
    client, business, dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    today = datetime.fromisoformat(
        client.get(base + "/forecast-dashboard").json()["data"]["businessDay"]
    ).date()
    start = today - timedelta(days=99)
    seed = client.post(base + "/data-imports", json={"rows": [
        {"sku": product["sku"], "saleDate": str(start + timedelta(days=offset)),
         "quantity": "10", "sourceRecordKey": f"seed-{offset}"}
        for offset in range(100)
    ]})
    assert seed.status_code == 201, seed.text
    assert seed.json()["data"]["acceptedRows"] == 100
    with psycopg.connect(dsn) as conn:
        user_id = conn.execute("SELECT id FROM users WHERE business_id=%s", (business,)).fetchone()[0]
    principal = Principal(str(user_id), business, "owner@example.com", "Synthetic owner", "owner")
    snapshot_conn = psycopg.connect(dsn, row_factory=dict_row)
    import_conn = psycopg.connect(dsn, row_factory=dict_row)
    observer = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)
    acquired, proceed = Event(), Event()
    outcome = {}

    class PausedImportConnection:
        def transaction(self):
            return import_conn.transaction()

        def execute(self, query, params=None):
            result = import_conn.execute(query, params)
            if "FROM businesses WHERE id=%s FOR NO KEY UPDATE" in query:
                acquired.set()
                if not proceed.wait(30):
                    raise RuntimeError("Timed out waiting to release the synthetic import")
            return result

    def import_later():
        try:
            outcome["saved"] = Repository(PausedImportConnection()).create_sales_import(
                principal, SalesImportCreate.model_validate({"rows": [{
                    "sku": product["sku"], "saleDate": str(today), "quantity": "100",
                    "sourceRecordKey": "late-import",
                }]}),
            )
            import_conn.commit()
        except BaseException as error:
            outcome["error"] = error
            import_conn.rollback()

    thread = Thread(target=import_later, daemon=True)
    try:
        snapshot_conn.execute(
            "SELECT id FROM businesses WHERE id=%s FOR NO KEY UPDATE", (business,),
        )
        transaction_started = import_conn.execute("SELECT now() AS started").fetchone()["started"]
        thread.start()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            wait = observer.execute(
                "SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=%s",
                (import_conn.info.backend_pid,),
            ).fetchone()
            if wait and wait["wait_event_type"] == "Lock":
                break
            time.sleep(0.01)
        else:
            raise AssertionError("Import did not block behind the snapshot's business row lock")
        assert wait["wait_event"] == "transactionid"
        run = Repository(snapshot_conn).create_forecast_run(principal, ForecastRunCreate.model_validate({
            "trainingStart": str(start), "trainingEnd": str(today - timedelta(days=40)),
            "validationStart": str(today - timedelta(days=39)),
            "validationEnd": str(today - timedelta(days=30)),
            "finalTestStart": str(today - timedelta(days=29)), "finalTestEnd": str(today),
            "forecastHorizonDays": 30,
        }))
        captured = datetime.fromisoformat(run["dataSnapshot"]["capturedAt"])
        snapshot_conn.commit()
        assert acquired.wait(10), "Import did not acquire the released business lock"
        # Complete the actual worker from its frozen100-sale snapshot while the
        # import owns the business lock but has not inserted the new sale yet.
        with psycopg.connect(dsn, row_factory=dict_row) as worker_conn:
            claimed = claim_run(worker_conn)
            assert claimed is not None
            process_run(worker_conn, claimed)
        with psycopg.connect(dsn, row_factory=dict_row) as read:
            repository = Repository(read)
            before = dashboard(repository, business)
            revision_before = dashboard_status(repository, business)["revision"]
        proceed.set()
        thread.join(timeout=10)
        assert not thread.is_alive(), "Import did not finish"
        assert "error" not in outcome, repr(outcome.get("error"))
        assert outcome["saved"]["acceptedRows"] == 1
        committed = observer.execute("SELECT clock_timestamp() AS stamp").fetchone()["stamp"]
        with psycopg.connect(dsn, row_factory=dict_row) as read:
            repository = Repository(read)
            after = dashboard(repository, business)
            revision_after = dashboard_status(repository, business)["revision"]
            imported_at = read.execute(
                "SELECT created_at FROM sales WHERE business_id=%s AND source_record_key='late-import'",
                (business,),
            ).fetchone()["created_at"]
            current_count = read.execute(
                "SELECT count(*) AS count FROM sales WHERE business_id=%s AND voided_at IS NULL",
                (business,),
            ).fetchone()["count"]
        assert transaction_started < captured < committed
        assert current_count == 101
        assert run["dataSnapshot"]["salesCount"] == 100
        assert before["run"]["dataSnapshot"] == after["run"]["dataSnapshot"] == run["dataSnapshot"]
        assert before["stale"] is False
        assert before["recommendations"][0]["forecastConfidence"]["level"] == "high"
        assert revision_after != revision_before
        assert after["stale"] is True, (
            f"Import committed after capture but remained current: tx={transaction_started}, "
            f"capture={captured}, created_at={imported_at}, committed={committed}"
        )
        assert captured < imported_at <= committed
        assert not after["run"]["configuration"].get("salesHistoryChanged")
        assert after["recommendations"][0]["forecastEvidence"]["status"] == "needs_refresh"
        confidence = after["recommendations"][0]["forecastConfidence"]
        assert confidence["level"] is None
        assert "Refresh" in confidence["reason"]
        for result in [before, after]:
            evidence = result["recommendations"][0]["forecastEvidence"]
            assert evidence["testObservations"] == 30
            assert float(evidence["mae"]) == 0
    finally:
        proceed.set()
        snapshot_conn.rollback()
        if thread.ident is not None:
            thread.join(timeout=10)
        for conn in [snapshot_conn, import_conn, observer]:
            conn.close()
