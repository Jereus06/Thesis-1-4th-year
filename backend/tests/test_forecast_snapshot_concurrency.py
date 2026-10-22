"""Real PostgreSQL writes must serialize with immutable forecast input capture."""

from datetime import datetime, timedelta
from threading import Event, Thread
import time
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
import pytest

from app.dashboard import dashboard, dashboard_status
from app.repository import Repository
from app.schemas import (
    DataQualityUpsert,
    ForecastRunCreate,
    MovementCreate,
    ProductCreate,
    ProductUpdate,
    SaleCreate,
    SettingsUpdate,
)
from app.security import Principal
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


MUTATIONS = [
    "manual_sale", "product_metadata", "product_status", "product_create",
    "settings", "movement", "quality",
]


def snapshot_fixture(pg_client):
    client, business, dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    today = datetime.fromisoformat(
        client.get(base + "/forecast-dashboard").json()["data"]["businessDay"]
    ).date()
    start = today - timedelta(days=9)
    seeded = client.post(base + "/data-imports", json={"rows": [
        {"sku": product["sku"], "saleDate": str(start + timedelta(days=offset)),
         "quantity": "10", "sourceRecordKey": f"snapshot-seed-{offset}"}
        for offset in range(10)
    ]})
    assert seeded.status_code == 201, seeded.text
    settings = client.get(base + "/settings").json()["data"]
    with psycopg.connect(dsn) as conn:
        user_id = conn.execute(
            "SELECT id FROM users WHERE business_id=%s", (business,),
        ).fetchone()[0]
    principal = Principal(str(user_id), business, "owner@example.com", "Synthetic owner", "owner")
    request = ForecastRunCreate(
        training_start=start, training_end=today - timedelta(days=6),
        validation_start=today - timedelta(days=5), validation_end=today - timedelta(days=3),
        final_test_start=today - timedelta(days=2), final_test_end=today,
        forecast_horizon_days=14,
    )
    return business, dsn, product, today, settings, principal, request


def save_mutation(repository, kind, principal, product, today, settings):
    product_id = UUID(product["id"])
    if kind == "manual_sale":
        return repository.record_sale(principal, SaleCreate(
            product_id=product_id, sale_date=today, quantity="1",
        ))
    if kind == "product_metadata":
        return repository.update_product(principal, product_id, ProductUpdate(
            name="Changed after forecast capture", lead_time_days=5,
        ))
    if kind == "product_status":
        return repository.update_product(principal, product_id, ProductUpdate(is_active=False))
    if kind == "product_create":
        return repository.create_product(principal, ProductCreate.model_validate({
            **product, "sku": "LATE-PRODUCT", "name": "Late synthetic product",
            "currentStock": "0",
        }))
    if kind == "settings":
        return repository.put_settings(principal.business_id, SettingsUpdate.model_validate({
            **settings, "movingAverageWindow": 14,
        }))
    if kind == "movement":
        return repository.record_movement(principal, MovementCreate(
            product_id=product_id, movement_date=today,
            movement_type="receipt", quantity_delta="1",
        ))
    if kind == "quality":
        return repository.upsert_data_quality(principal, DataQualityUpsert(
            product_id=product_id, classification_date=today,
            classification="incomplete", note="Synthetic overlapping review",
        ))
    raise AssertionError(kind)


def mutation_timestamp(conn, kind, business, product, saved):
    if kind == "manual_sale":
        return conn.execute(
            "SELECT created_at AS stamp FROM sales WHERE business_id=%s AND id=%s",
            (business, saved["id"]),
        ).fetchone()["stamp"]
    if kind == "settings":
        return conn.execute(
            "SELECT updated_at AS stamp FROM business_settings WHERE business_id=%s", (business,),
        ).fetchone()["stamp"]
    if kind == "quality":
        return conn.execute(
            "SELECT updated_at AS stamp FROM sales_day_quality WHERE business_id=%s AND id=%s",
            (business, saved["id"]),
        ).fetchone()["stamp"]
    return conn.execute(
        "SELECT updated_at AS stamp FROM products WHERE business_id=%s AND id=%s",
        (business, saved["id"] if kind == "product_create" else product["id"]),
    ).fetchone()["stamp"]


def complete_for_freshness_check(conn, run):
    # Only the saved-input freshness decision is under test here. No worker or
    # fabricated prediction/accuracy rows are needed to exercise that decision.
    conn.execute(
        "UPDATE forecast_runs SET status='completed',completed_at=clock_timestamp() WHERE id=%s",
        (run["id"],),
    )


def assert_frozen_and_stale(conn, business, product, settings, run, captured, kind, saved):
    repository = Repository(conn)
    result = dashboard(repository, business)
    assert result["stale"] is True, f"{kind} saved after capture but forecast remained current"
    assert result["run"]["dataSnapshot"] == run["dataSnapshot"]
    assert run["dataSnapshot"]["salesCount"] == 10
    assert run["dataSnapshot"]["products"] == [product["id"]]
    assert run["dataSnapshot"]["settings"]["moving_average_window"] == settings["movingAverageWindow"]
    assert run["dataSnapshot"]["dataQuality"] == []
    assert len(run["dataSnapshot"]["dailySales"]) == 10
    assert all(float(row["quantity"]) == 10 for row in run["dataSnapshot"]["dailySales"])
    assert captured < mutation_timestamp(conn, kind, business, product, saved)


@pytest.mark.parametrize("kind", MUTATIONS)
def test_prestarted_transaction_saved_after_capture_invalidates_forecast(pg_client, kind):
    business, dsn, product, today, settings, principal, request = snapshot_fixture(pg_client)
    with psycopg.connect(dsn, row_factory=dict_row) as writer:
        started = writer.execute("SELECT now() AS started").fetchone()["started"]
        with psycopg.connect(dsn, row_factory=dict_row) as capture:
            run = Repository(capture).create_forecast_run(principal, request)
            complete_for_freshness_check(capture, run)
        captured = datetime.fromisoformat(run["dataSnapshot"]["capturedAt"])
        assert started < captured
        with psycopg.connect(dsn, row_factory=dict_row) as read:
            before = dashboard(Repository(read), business)
            revision_before = dashboard_status(Repository(read), business)["revision"]
            assert before["stale"] is False
        saved = save_mutation(Repository(writer), kind, principal, product, today, settings)
        writer.commit()
    with psycopg.connect(dsn, row_factory=dict_row) as read:
        assert dashboard_status(Repository(read), business)["revision"] != revision_before
        assert_frozen_and_stale(read, business, product, settings, run, captured, kind, saved)


@pytest.mark.parametrize("kind", MUTATIONS)
def test_save_waits_until_all_forecast_inputs_are_captured(pg_client, kind):
    business, dsn, product, today, settings, principal, request = snapshot_fixture(pg_client)
    capture = psycopg.connect(dsn, row_factory=dict_row)
    writer = psycopg.connect(dsn, row_factory=dict_row)
    observer = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)
    captured_event, proceed, saved_event = Event(), Event(), Event()
    outcome = {}

    class PausedCaptureConnection:
        def execute(self, query, params=None):
            result = capture.execute(query, params)
            if query == "SELECT clock_timestamp() AS captured_at":
                captured_event.set()
                if not proceed.wait(15):
                    raise RuntimeError("Timed out waiting to finish synthetic forecast capture")
            return result

    def capture_inputs():
        try:
            outcome["run"] = Repository(PausedCaptureConnection()).create_forecast_run(principal, request)
            complete_for_freshness_check(capture, outcome["run"])
            capture.commit()
        except BaseException as error:
            outcome["capture_error"] = error
            capture.rollback()

    def save_inputs():
        try:
            outcome["saved"] = save_mutation(Repository(writer), kind, principal, product, today, settings)
            writer.commit()
        except BaseException as error:
            outcome["save_error"] = error
            writer.rollback()
        finally:
            saved_event.set()

    capture_thread = Thread(target=capture_inputs, daemon=True)
    save_thread = Thread(target=save_inputs, daemon=True)
    try:
        started = writer.execute("SELECT now() AS started").fetchone()["started"]
        capture_thread.start()
        assert captured_event.wait(10), repr(outcome.get("capture_error"))
        save_thread.start()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            blockers = observer.execute(
                "SELECT pg_blocking_pids(%s) AS pids", (writer.info.backend_pid,),
            ).fetchone()["pids"]
            if capture.info.backend_pid in blockers:
                break
            assert not saved_event.is_set(), (
                f"{kind} completed while immutable forecast input capture held its business lock: {outcome}"
            )
            time.sleep(0.01)
        else:
            raise AssertionError(f"{kind} did not wait for the forecast's business lock")
        assert not saved_event.is_set()
        proceed.set()
        capture_thread.join(timeout=10)
        save_thread.join(timeout=10)
        assert not capture_thread.is_alive() and not save_thread.is_alive()
        assert "capture_error" not in outcome, repr(outcome.get("capture_error"))
        assert "save_error" not in outcome, repr(outcome.get("save_error"))
        run = outcome["run"]
        captured = datetime.fromisoformat(run["dataSnapshot"]["capturedAt"])
        assert started < captured
        assert_frozen_and_stale(
            observer, business, product, settings, run, captured, kind, outcome["saved"],
        )
    finally:
        proceed.set()
        for thread in (capture_thread, save_thread):
            if thread.ident is not None:
                thread.join(timeout=10)
        for conn in (capture, writer, observer):
            conn.close()
