"""Daily forecast slots, durable retry guards, and isolated database scheduling."""

from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.scheduling import daily_schedule_slot, schedule_attempt
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


NOW = datetime(2026, 10, 5, 16, 20, tzinfo=UTC)
SLOT = date(2026, 10, 6)


@pytest.mark.parametrize(
    ("instant", "timezone", "local_time", "slot", "cutoff"),
    [
        ("2026-10-05T16:14:59+00:00", "Asia/Manila", "00:15", "2026-10-05", "2026-10-04"),
        ("2026-10-05T16:15:00+00:00", "Asia/Manila", "00:15", "2026-10-06", "2026-10-05"),
        ("2026-10-06T15:59:59+00:00", "Asia/Manila", "00:15", "2026-10-06", "2026-10-05"),
        ("2026-10-05T16:20:00+00:00", "UTC", "00:15", "2026-10-05", "2026-10-04"),
        ("2026-10-05T16:20:00+00:00", "Pacific/Honolulu", "00:15", "2026-10-05", "2026-10-04"),
        ("2026-01-01T00:14:00+00:00", "UTC", "00:15", "2025-12-31", "2025-12-30"),
        ("2026-10-05T11:44:59+00:00", "Asia/Kathmandu", "17:30", "2026-10-04", "2026-10-03"),
        ("2026-10-05T11:45:00+00:00", "Asia/Kathmandu", "17:30", "2026-10-05", "2026-10-04"),
        ("2026-03-08T05:15:00+00:00", "America/New_York", "00:15", "2026-03-08", "2026-03-07"),
        ("2026-03-09T04:15:00+00:00", "America/New_York", "00:15", "2026-03-09", "2026-03-08"),
        ("2026-11-01T05:30:00+00:00", "America/New_York", "01:30", "2026-11-01", "2026-10-31"),
        ("2026-11-01T06:30:00+00:00", "America/New_York", "01:30", "2026-11-01", "2026-10-31"),
    ],
)
def test_due_slot_uses_business_wall_clock_and_only_completed_days(
    instant, timezone, local_time, slot, cutoff,
):
    assert daily_schedule_slot(datetime.fromisoformat(instant), timezone, local_time) == (
        date.fromisoformat(slot), date.fromisoformat(cutoff),
    )


def scheduled_run(status, *, slot=SLOT, attempt=1, completed_at=None, **extra):
    return {
        "status": status,
        "configuration": {
            "requestedFrom": "daily_schedule", "scheduledFor": slot.isoformat(),
            "scheduleAttempt": attempt,
        },
        "completed_at": completed_at,
        **extra,
    }


def test_new_slot_is_due_once_even_after_worker_restart_or_long_downtime():
    assert schedule_attempt([], SLOT, NOW) == 1
    completed = scheduled_run("completed")
    assert schedule_attempt([completed], SLOT, NOW + timedelta(hours=12)) is None
    assert schedule_attempt([completed], SLOT + timedelta(days=4), NOW + timedelta(days=4)) == 1


@pytest.mark.parametrize("status", ["queued", "running"])
@pytest.mark.parametrize("source", ["web", "daily_schedule"])
def test_active_work_blocks_daily_queue_regardless_of_source_or_slot(status, source):
    active = {
        "status": status,
        "configuration": {"requestedFrom": source, "scheduledFor": "2026-10-01"},
    }
    assert schedule_attempt([active], SLOT, NOW) is None


def test_manual_completed_and_failed_runs_do_not_satisfy_the_daily_slot():
    previous = [
        {"status": "completed", "configuration": {"requestedFrom": "web"}},
        {"status": "failed", "configuration": {"requestedFrom": "web"}, "completed_at": NOW},
        scheduled_run("completed", slot=SLOT - timedelta(days=1)),
        scheduled_run("failed", slot=SLOT - timedelta(days=1), completed_at=NOW),
    ]
    assert schedule_attempt(previous, SLOT, NOW) == 1


@pytest.mark.parametrize(
    ("elapsed", "expected"),
    [(timedelta(minutes=29, seconds=59), None), (timedelta(minutes=30), 2), (timedelta(hours=2), 2)],
)
def test_failure_retry_waits_thirty_database_clock_minutes(elapsed, expected):
    failed = scheduled_run("failed", completed_at=NOW)
    assert schedule_attempt([failed], SLOT, NOW + elapsed) == expected


def test_retry_delay_uses_latest_failure_completion_not_input_order():
    failures = [
        scheduled_run("failed", attempt=2, completed_at=NOW),
        scheduled_run("failed", completed_at=NOW - timedelta(hours=1)),
    ]
    assert schedule_attempt(failures, SLOT, NOW + timedelta(minutes=29)) is None
    assert schedule_attempt(failures, SLOT, NOW + timedelta(minutes=30)) == 3


@pytest.mark.parametrize("timestamp_field", ["started_at", "created_at"])
def test_retry_has_conservative_timestamp_fallback(timestamp_field):
    failed = scheduled_run("failed", **{timestamp_field: NOW})
    assert schedule_attempt([failed], SLOT, NOW + timedelta(minutes=29)) is None
    assert schedule_attempt([failed], SLOT, NOW + timedelta(minutes=30)) == 2


def test_failed_run_without_timestamp_cannot_trigger_an_unbounded_retry_loop():
    assert schedule_attempt([scheduled_run("failed")], SLOT, NOW) is None


def test_three_failed_attempts_exhaust_only_that_slot():
    failures = [
        scheduled_run("failed", attempt=attempt, completed_at=NOW - timedelta(hours=attempt))
        for attempt in range(1, 4)
    ]
    assert schedule_attempt(failures, SLOT, NOW) is None
    assert schedule_attempt(failures, SLOT + timedelta(days=1), NOW + timedelta(days=1)) == 1


def test_recorded_attempt_number_preserves_retry_cap_when_older_rows_are_missing():
    assert schedule_attempt([
        scheduled_run("failed", attempt=3, completed_at=NOW - timedelta(hours=1)),
    ], SLOT, NOW) is None


def test_completed_schedule_blocks_retry_even_if_a_later_failure_is_present():
    rows = [scheduled_run("failed", completed_at=NOW - timedelta(hours=1)), scheduled_run("completed")]
    assert schedule_attempt(rows, SLOT, NOW) is None


class QueryResult:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def fetchall(self):
        return list(self.rows)

    def fetchone(self):
        return self.rows[0] if self.rows else None


class ScheduleConnection:
    """A strict database contract double; it does not emulate real PostgreSQL locks."""

    def __init__(self, businesses, runs=None):
        self.businesses = dict(businesses)
        self.runs = {business: list(rows) for business, rows in (runs or {}).items()}
        self.locked_business = None
        self.in_transaction = False
        self.committed = []
        self.rolled_back = []
        self.settings_locked = False
        self.deactivated_after_selection = set()
        self.missing_after_selection = set()

    @contextmanager
    def transaction(self):
        assert not self.in_transaction
        self.in_transaction = True
        try:
            yield
        except BaseException:
            self.rolled_back.append(self.locked_business)
            raise
        else:
            self.committed.append(self.locked_business)
        finally:
            self.in_transaction = False
            self.locked_business = None
            self.settings_locked = False

    def execute(self, query, params=()):
        query = " ".join(query.split())
        if "SELECT s.business_id FROM business_settings s" in query:
            assert not self.in_transaction
            assert "JOIN businesses b ON b.id=s.business_id" in query
            assert "WHERE b.is_active" in query
            return QueryResult({"business_id": business} for business in sorted(self.businesses))
        assert self.in_transaction, "Every business schedule read/write shares a transaction"
        if "FOR NO KEY UPDATE" in query:
            assert params[0] in self.businesses
            self.locked_business = params[0]
            assert "SELECT id,is_active" in query
            if params[0] in self.missing_after_selection:
                return QueryResult()
            return QueryResult([{
                "id": params[0], "is_active": params[0] not in self.deactivated_after_selection,
            }])
        assert self.locked_business == params[0], "All reads stay inside the locked tenant"
        if "SELECT timezone FROM business_settings" in query:
            assert "FOR SHARE" in query, "Do not change timezone after computing the slot"
            self.settings_locked = True
            return QueryResult([{"timezone": self.businesses[params[0]]}])
        if "FROM forecast_runs" in query:
            assert self.settings_locked
            assert "status IN ('queued','running')" in query
            assert "configuration->>'requestedFrom'='daily_schedule'" in query
            return QueryResult([
                run for run in self.runs.get(params[0], [])
                if run["status"] in {"queued", "running"}
                or (run.get("configuration", {}).get("requestedFrom") == "daily_schedule"
                    and run["configuration"].get("scheduledFor") == params[1])
            ])
        raise AssertionError(f"Unexpected scheduler query: {query}")


def schedule_repository(connection, monkeypatch, failures=None):
    from fastapi import HTTPException

    from app.repository import Repository

    repository = Repository(connection)
    captured = []

    def refresh(business, requested_by, **arguments):
        assert connection.in_transaction
        assert connection.locked_business == business
        assert connection.settings_locked
        assert requested_by is None, "Automatic jobs must not impersonate a user"
        failure = (failures or {}).get(business)
        if isinstance(failure, int):
            raise HTTPException(failure, "Synthetic invalid business history")
        if failure is not None:
            raise failure
        captured.append((business, requested_by, arguments))
        connection.runs.setdefault(business, []).append({
            "status": "queued", "configuration": dict(arguments["configuration"]),
        })

    monkeypatch.setattr(repository, "_refresh_forecast", refresh)
    return repository, captured


def test_repository_serializes_each_tenant_and_captures_correct_local_slot(monkeypatch):
    connection = ScheduleConnection({"store-a": "Asia/Manila", "store-b": "Pacific/Honolulu"})
    repository, captured = schedule_repository(connection, monkeypatch)
    assert repository.schedule_daily_forecasts(NOW, "00:15") == 2
    assert [business for business, _, _ in captured] == ["store-a", "store-b"]
    first, second = [arguments for _, _, arguments in captured]
    assert first["business_day"] == SLOT
    assert first["history_through"] == SLOT - timedelta(days=1)
    assert first["configuration"] == {
        "requestedFrom": "daily_schedule", "scheduledFor": str(SLOT),
        "scheduledTime": "00:15", "scheduledTimezone": "Asia/Manila",
        "historyThrough": str(SLOT - timedelta(days=1)), "scheduleAttempt": 1,
    }
    assert second["business_day"] == SLOT - timedelta(days=1)
    assert second["history_through"] == SLOT - timedelta(days=2)
    assert second["configuration"]["scheduledFor"] == str(SLOT - timedelta(days=1))
    assert connection.committed == ["store-a", "store-b"]
    assert repository.schedule_daily_forecasts(NOW + timedelta(minutes=5), "00:15") == 0
    assert len(captured) == 2


def test_repository_active_and_completed_guards_do_not_block_another_tenant(monkeypatch):
    connection = ScheduleConnection(
        {"store-a": "Asia/Manila", "store-b": "Asia/Manila", "store-c": "Asia/Manila"},
        {
            "store-a": [{"status": "running", "configuration": {"requestedFrom": "web"}}],
            "store-b": [scheduled_run("completed")],
        },
    )
    repository, captured = schedule_repository(connection, monkeypatch)
    assert repository.schedule_daily_forecasts(NOW, "00:15") == 1
    assert [business for business, _, _ in captured] == ["store-c"]


@pytest.mark.parametrize("changed_state", ["deactivated", "removed"])
def test_business_deactivated_or_removed_before_lock_is_not_prepared(monkeypatch, changed_state):
    connection = ScheduleConnection({"store-a": "Asia/Manila", "store-b": "Asia/Manila"})
    if changed_state == "deactivated":
        connection.deactivated_after_selection.add("store-a")
    else:
        connection.missing_after_selection.add("store-a")
    repository, captured = schedule_repository(connection, monkeypatch)
    assert repository.schedule_daily_forecasts(NOW, "00:15") == 1
    assert [business for business, _, _ in captured] == ["store-b"]
    assert "store-a" not in connection.runs


@pytest.mark.parametrize("failure", [409, 422, ValueError("Synthetic bad business configuration")])
def test_invalid_or_racing_business_rolls_back_then_other_tenants_continue(monkeypatch, failure):
    connection = ScheduleConnection({"store-a": "Asia/Manila", "store-b": "Asia/Manila"})
    repository, captured = schedule_repository(connection, monkeypatch, {"store-a": failure})
    assert repository.schedule_daily_forecasts(NOW, "00:15") == 1
    assert connection.rolled_back == ["store-a"]
    assert connection.committed == ["store-b"]
    assert [business for business, _, _ in captured] == ["store-b"]


def test_disabled_worker_scheduler_opens_no_database_connection(monkeypatch):
    from app import worker

    monkeypatch.setattr(worker, "get_settings", lambda: SimpleNamespace(forecast_daily_enabled=False))
    monkeypatch.setattr(worker.psycopg, "connect", lambda *_a, **_kw: pytest.fail("Unexpected DB access"))
    assert worker.schedule_once() == 0


def test_worker_scheduler_uses_database_clock_and_configured_local_time(monkeypatch):
    from app import worker

    class DatabaseClock:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, query):
            assert query == "SELECT clock_timestamp() AS scheduler_now"
            return QueryResult([{"scheduler_now": NOW}])

    connection = DatabaseClock()
    captured = []
    monkeypatch.setattr(worker, "get_settings", lambda: SimpleNamespace(
        forecast_daily_enabled=True, forecast_daily_time="17:30", database_url="postgresql://synthetic",
    ))

    def connect(url, **kwargs):
        assert url == "postgresql://synthetic"
        assert kwargs["autocommit"] is True
        return connection

    class SchedulerRepository:
        def __init__(self, actual):
            assert actual is connection

        def schedule_daily_forecasts(self, now, local_time):
            captured.append((now, local_time))
            return 2

    monkeypatch.setattr(worker.psycopg, "connect", connect)
    monkeypatch.setattr(worker, "Repository", SchedulerRepository)
    assert worker.schedule_once() == 2
    assert captured == [(NOW, "17:30")]


def test_worker_checks_daily_schedule_even_while_queue_remains_busy(monkeypatch):
    from app import worker

    class StopWorker(Exception):
        pass

    clock = {"seconds": 0}
    polls = []
    processed = []
    monkeypatch.setattr(worker, "get_settings", lambda: SimpleNamespace(
        forecast_daily_enabled=True, forecast_schedule_poll_seconds=60, forecast_poll_seconds=5,
    ))
    monkeypatch.setattr(worker.time, "monotonic", lambda: clock["seconds"])
    monkeypatch.setattr(worker.time, "sleep", lambda *_: pytest.fail("A busy queue should keep draining"))
    monkeypatch.setattr(worker, "schedule_once", lambda: polls.append(clock["seconds"]))

    def run():
        processed.append(clock["seconds"])
        if len(processed) == 4:
            raise StopWorker
        clock["seconds"] += 35
        return True

    monkeypatch.setattr(worker, "run_once", run)
    with pytest.raises(StopWorker):
        worker.main()
    assert polls == [0, 70]
    assert processed == [0, 35, 70, 105]


def seed_schedule_history(client, business, *, include_current_day=False):
    """Write only to pg_client's temporary schema in the explicit test database."""
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    first_day = SLOT - timedelta(days=10)
    cutoff = SLOT - timedelta(days=1)
    rows = [
        {"sku": product["sku"], "saleDate": str(first_day + timedelta(days=index)), "quantity": "4"}
        for index in range(9)
    ]
    if include_current_day:
        rows.append({"sku": product["sku"], "saleDate": str(SLOT), "quantity": "99"})
    imported = client.post(base + "/data-imports", json={"source": "csv", "rows": rows})
    assert imported.status_code == 201, imported.text
    assert imported.json()["data"]["acceptedRows"] == len(rows)
    reviewed = client.put(base + "/data-quality", json={
        "productId": None, "classificationDate": str(cutoff),
        "classification": "confirmed_zero", "note": "Synthetic completed-day review",
    })
    assert reviewed.status_code == 200, reviewed.text
    return product, base, first_day, cutoff


def test_postgres_daily_run_freezes_completed_days_reviews_and_chronological_split(pg_client):
    import psycopg

    from app import worker
    from app.config import get_settings
    from app.repository import Repository

    client, business, dsn = pg_client
    product, base, first_day, cutoff = seed_schedule_history(
        client, business, include_current_day=True,
    )
    with psycopg.connect(dsn, autocommit=True) as connection:
        repository = Repository(connection)
        assert repository.schedule_daily_forecasts(NOW, "00:15") == 1
        assert repository.schedule_daily_forecasts(NOW + timedelta(minutes=5), "00:15") == 0
        requested_by = connection.execute("SELECT requested_by FROM forecast_runs").fetchone()[
            "requested_by"
        ]
        assert requested_by is None
    runs = client.get(base + "/forecast-runs").json()["data"]
    assert len(runs) == 1
    dashboard_response = client.get(base + "/forecast-dashboard")
    assert dashboard_response.status_code == 200, dashboard_response.text
    assert dashboard_response.json()["data"]["forecastSchedule"] == {
        "enabled": get_settings().forecast_daily_enabled,
        "localTime": get_settings().forecast_daily_time,
        "timezone": "Asia/Manila",
    }
    queued = runs[0]
    assert queued["status"] == "queued"
    assert queued["configuration"]["requestedFrom"] == "daily_schedule"
    assert queued["configuration"]["scheduledFor"] == str(SLOT)
    assert queued["configuration"]["scheduledTime"] == "00:15"
    assert queued["configuration"]["scheduledTimezone"] == "Asia/Manila"
    assert queued["configuration"]["historyThrough"] == str(cutoff)
    assert queued["configuration"]["scheduleAttempt"] == 1
    assert queued["trainingStart"] == str(first_day)
    assert queued["trainingEnd"] < queued["validationStart"] <= queued["validationEnd"]
    assert queued["validationEnd"] < queued["finalTestStart"] <= queued["finalTestEnd"]
    assert queued["finalTestEnd"] == str(cutoff)
    snapshot = queued["dataSnapshot"]
    assert snapshot["businessDayAtCapture"] == str(SLOT)
    assert snapshot["lastUsableDate"] == str(cutoff)
    assert snapshot["salesCount"] == 9
    assert snapshot["products"] == [product["id"]]
    assert snapshot["settings"]["timezone"] == "Asia/Manila"
    assert snapshot["preparationPolicyVersion"]
    assert snapshot["capturedAt"]
    assert len(snapshot["dailySales"]) == 9
    assert all(row["date"] < str(SLOT) for row in snapshot["dailySales"])
    assert snapshot["dataQuality"] == [{
        "productId": None, "date": str(cutoff), "classification": "confirmed_zero",
        "note": "Synthetic completed-day review",
    }]
    assert snapshot["preparedProducts"][product["id"]]["targets"][-1] == {
        "day": str(cutoff), "quantity": 0.0, "provenance": "confirmed_zero",
    }
    # Edits after queuing must not replace that completed-day input snapshot.
    changed = client.put(base + "/data-quality", json={
        "productId": product["id"], "classificationDate": str(cutoff),
        "classification": "incomplete", "note": "Synthetic later correction",
    })
    assert changed.status_code == 200, changed.text
    assert worker.run_once()
    completed = client.get(base + f"/forecast-runs/{queued['id']}").json()["data"]
    assert completed["status"] == "completed", completed["failureMessage"]
    assert completed["dataSnapshot"] == snapshot
    assert completed["configuration"]["preparationSource"] == "frozen_prepared_snapshot"
    predictions = client.get(base + f"/forecast-runs/{queued['id']}/predictions").json()["data"]
    final_zero = next(point for point in predictions if point["predictionDate"] == str(cutoff))
    assert float(final_zero["actualQuantity"]) == 0
    future = [point for point in predictions if point["datasetSplit"] == "future"]
    assert future[0]["predictionDate"] == str(SLOT)
    with psycopg.connect(dsn, autocommit=True) as connection:
        assert Repository(connection).schedule_daily_forecasts(NOW + timedelta(hours=1), "00:15") == 0


def test_postgres_manual_pending_run_is_preserved_without_daily_duplicate(pg_client, monkeypatch):
    import psycopg

    from app.repository import Repository
    from test_forecast_history import freeze_clock

    client, business, dsn = pg_client
    freeze_clock(monkeypatch, NOW)
    _product, base, _first_day, _cutoff = seed_schedule_history(client, business)
    manual = client.post(base + "/forecast-refresh")
    assert manual.status_code == 202, manual.text
    with psycopg.connect(dsn, autocommit=True) as connection:
        assert Repository(connection).schedule_daily_forecasts(NOW, "00:15") == 0
    runs = client.get(base + "/forecast-runs").json()["data"]
    assert len(runs) == 1
    assert runs[0]["id"] == manual.json()["data"]["id"]
    assert runs[0]["configuration"]["requestedFrom"] == "web"


def test_postgres_concurrent_schedulers_queue_one_business_slot(pg_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    import psycopg

    from app.repository import Repository

    client, business, dsn = pg_client
    seed_schedule_history(client, business)
    ready = Barrier(2)

    def poll():
        with psycopg.connect(dsn, autocommit=True) as connection:
            repository = Repository(connection)
            ready.wait(timeout=10)
            return repository.schedule_daily_forecasts(NOW, "00:15")

    with ThreadPoolExecutor(max_workers=2) as executors:
        outcomes = list(executors.map(lambda _index: poll(), range(2)))
    assert sorted(outcomes) == [0, 1]
    with psycopg.connect(dsn, autocommit=True) as connection:
        assert connection.execute("SELECT count(*) AS count FROM forecast_runs").fetchone()["count"] == 1


def test_postgres_inactive_business_is_not_scheduled(pg_client):
    import psycopg

    from app.repository import Repository

    client, business, dsn = pg_client
    seed_schedule_history(client, business)
    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute("UPDATE businesses SET is_active=false WHERE id=%s", (business,))
        assert Repository(connection).schedule_daily_forecasts(NOW, "00:15") == 0
        assert connection.execute("SELECT count(*) AS count FROM forecast_runs").fetchone()["count"] == 0


def test_postgres_retry_cap_and_backoff_are_durable_across_repository_instances(pg_client):
    import psycopg

    from app.repository import Repository

    client, business, dsn = pg_client
    seed_schedule_history(client, business)
    with psycopg.connect(dsn, autocommit=True) as connection:
        assert Repository(connection).schedule_daily_forecasts(NOW, "00:15") == 1
    for attempt in range(1, 4):
        with psycopg.connect(dsn, autocommit=True) as connection:
            connection.execute(
                "UPDATE forecast_runs SET status='failed',completed_at=%s WHERE status='queued'",
                (NOW,),
            )
            repository = Repository(connection)
            assert repository.schedule_daily_forecasts(NOW + timedelta(minutes=29), "00:15") == 0
            assert repository.schedule_daily_forecasts(NOW + timedelta(minutes=30), "00:15") == (
                1 if attempt < 3 else 0
            )
    with psycopg.connect(dsn, autocommit=True) as connection:
        rows = connection.execute(
            "SELECT status,configuration FROM forecast_runs ORDER BY configuration->>'scheduleAttempt'",
        ).fetchall()
    assert [row["configuration"]["scheduleAttempt"] for row in rows] == [1, 2, 3]
    assert all(row["status"] == "failed" for row in rows)
