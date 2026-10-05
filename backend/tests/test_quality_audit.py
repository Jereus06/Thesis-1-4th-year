"""Classification revisions read, change, and audit state under one business lock."""

from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.repository import Repository
from app.schemas import DataQualityDelete, DataQualityUpsert
from app.security import Principal


PRODUCT_ID = UUID("00000000-0000-4000-8000-000000000001")
USER = Principal("owner", "store-1", "owner@example.com", "Owner", "owner")
DAY = date(2026, 1, 1)


class Result:
    def __init__(self, row=None):
        self.row = dict(row) if row is not None else None

    def fetchone(self):
        return self.row

    def fetchall(self):
        return [self.row] if self.row is not None else []


class QualityConnection:
    def __init__(self):
        self.quality = {}
        self.audits = []
        self.products = {(USER.business_id, PRODUCT_ID)}
        self.in_transaction = False
        self.locked_business = None
        self.revision_at = None
        self.clock_reads = 0
        self.next_id = 1

    @contextmanager
    def transaction(self):
        assert not self.in_transaction
        self.in_transaction = True
        try:
            yield
        finally:
            self.in_transaction = False
            self.locked_business = None
            self.revision_at = None

    def execute(self, query, params=()):
        assert self.in_transaction, "Classification changes must be transactional"
        if "FOR NO KEY UPDATE" in query:
            self.locked_business = params[0]
            return Result({"id": params[0]})
        if "clock_timestamp()" in query:
            assert self.locked_business is not None, "Capture revision time after acquiring the lock"
            self.clock_reads += 1
            self.revision_at = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=self.clock_reads)
            return Result({"revision_at": self.revision_at})
        assert self.locked_business == params[0], "Lock the business before any classification read/write"
        assert self.revision_at is not None
        if "FROM products" in query:
            return Result({"exists": 1}) if params in self.products else Result()
        if "SELECT * FROM sales_day_quality" in query:
            return Result(self.quality.get(params))
        if "DELETE FROM sales_day_quality" in query:
            return Result(self.quality.pop(params, None))
        if "INSERT INTO sales_day_quality_audit" in query:
            if "'deleted'" in query:
                business, quality_id, product, day, previous, previous_note, user, changed_at = params
                current, note, action = None, None, "deleted"
            else:
                business, quality_id, product, day, previous, current, previous_note, note, action, user, changed_at = params
            assert changed_at == self.revision_at
            self.audits.append({
                "business_id": business, "quality_id": quality_id, "product_id": product,
                "classification_date": day, "previous_classification": previous,
                "classification": current, "previous_note": previous_note, "note": note,
                "action": action, "changed_by": user, "changed_at": changed_at,
            })
            return Result()
        if "INSERT INTO sales_day_quality" in query:
            business, product, day, classification, note, creator, updater, created_at, updated_at = params
            assert created_at == updated_at == self.revision_at
            key = (business, product, day)
            previous = self.quality.get(key)
            quality_id = previous["id"] if previous else f"quality-{self.next_id}"
            self.next_id += 1
            row = {
                "id": quality_id, "business_id": business, "product_id": product,
                "classification_date": day, "classification": classification, "note": note,
                "created_by": previous["created_by"] if previous else creator, "updated_by": updater,
                "created_at": previous["created_at"] if previous else created_at,
                "updated_at": updated_at,
            }
            self.quality[key] = row
            return Result(row)
        raise AssertionError(f"Unexpected classification query: {query}")


@pytest.mark.parametrize("product_id", [None, PRODUCT_ID])
def test_classification_lifecycle_keeps_previous_state_and_revision_time_under_lock(product_id):
    connection = QualityConnection()
    repository = Repository(connection)
    created = repository.upsert_data_quality(USER, DataQualityUpsert(
        product_id=product_id, classification_date=DAY, classification="confirmed_zero", note="First review",
    ))
    updated = repository.upsert_data_quality(USER, DataQualityUpsert(
        product_id=product_id, classification_date=DAY, classification="business_closed", note="Corrected review",
    ))
    assert repository.delete_data_quality(USER, DataQualityDelete(
        product_id=product_id, classification_date=DAY,
    )) == {"deleted": True}
    recreated = repository.upsert_data_quality(USER, DataQualityUpsert(
        product_id=product_id, classification_date=DAY, classification="incomplete", note=None,
    ))
    assert [audit["action"] for audit in connection.audits] == ["created", "updated", "deleted", "created"]
    assert [audit["previous_classification"] for audit in connection.audits] == [
        None, "confirmed_zero", "business_closed", None,
    ]
    assert [audit["previous_note"] for audit in connection.audits] == [
        None, "First review", "Corrected review", None,
    ]
    assert [audit["classification"] for audit in connection.audits] == [
        "confirmed_zero", "business_closed", None, "incomplete",
    ]
    assert created["id"] == updated["id"] != recreated["id"]
    assert created["createdAt"] == updated["createdAt"]
    assert created["updatedAt"] == connection.audits[0]["changed_at"].isoformat()
    assert updated["updatedAt"] == connection.audits[1]["changed_at"].isoformat()
    assert recreated["updatedAt"] == connection.audits[3]["changed_at"].isoformat()
    assert connection.clock_reads == 4
    assert all(audit["product_id"] == product_id for audit in connection.audits)


@pytest.mark.parametrize("product_id", [None, PRODUCT_ID])
def test_missing_classification_delete_keeps_404_and_does_not_invent_audit(product_id):
    connection = QualityConnection()
    with pytest.raises(HTTPException) as missing:
        Repository(connection).delete_data_quality(USER, DataQualityDelete(
            product_id=product_id, classification_date=DAY,
        ))
    assert missing.value.status_code == 404
    assert missing.value.detail == "Classification not found"
    assert not connection.audits


def test_unknown_product_keeps_404_and_no_classification_or_audit():
    connection = QualityConnection()
    with pytest.raises(HTTPException) as missing:
        Repository(connection).upsert_data_quality(USER, DataQualityUpsert(
            product_id=UUID("00000000-0000-4000-8000-000000000002"), classification_date=DAY,
            classification="confirmed_zero",
        ))
    assert missing.value.status_code == 404
    assert missing.value.detail == "Product not found"
    assert not connection.quality
    assert not connection.audits



class SnapshotConnection:
    def __init__(self):
        self.locked = False
        self.revision_at = datetime(2026, 1, 1, tzinfo=UTC)
        self.captured_at = self.revision_at + timedelta(seconds=1)
        self.quality = None

    def execute(self, query, params=()):
        query = " ".join(query.split())
        if "FOR NO KEY UPDATE" in query:
            assert params == (USER.business_id,)
            self.locked = True
            # A classification revision committed while this lock was waiting.
            self.quality = {
                "product_id": None, "classification_date": DAY,
                "classification": "confirmed_zero", "note": "Included revision",
            }
            return Result({"id": USER.business_id})
        assert self.locked, "Snapshot clock and reads must follow the classification lock"
        if "clock_timestamp()" in query:
            return Result({"captured_at": self.captured_at})
        if "SELECT id FROM forecast_runs" in query:
            return Result()
        if "count(*) AS sales_count" in query:
            return Result({"sales_count": 0, "first_sale_date": None, "last_sale_date": None})
        if "FROM sales WHERE" in query:
            return Result()
        if "FROM business_settings" in query:
            return Result({"business_id": USER.business_id, "moving_average_window": 7})
        if "FROM sales_day_quality" in query:
            return Result(self.quality)
        if "FROM products" in query:
            return Result()
        if "INSERT INTO forecast_runs" in query:
            return Result({"data_snapshot": params[9].obj})
        raise AssertionError(f"Unexpected forecast snapshot query: {query}")


def test_forecast_snapshot_captures_time_after_waiting_for_included_classification(monkeypatch):
    from app.schemas import ForecastRunCreate

    connection = SnapshotConnection()
    repository = Repository(connection)
    # Freeze the independent future-date cutoff; this fixture exercises the
    # classification lock and database snapshot clock, not business settings.
    monkeypatch.setattr(repository, "business_day", lambda *_: DAY + timedelta(days=2))
    monkeypatch.setattr(repository, "_forecast_run", lambda row: row)
    result = repository.create_forecast_run(USER, ForecastRunCreate(
        training_start=DAY, training_end=DAY,
        validation_start=DAY + timedelta(days=1), validation_end=DAY + timedelta(days=1),
        final_test_start=DAY + timedelta(days=2), final_test_end=DAY + timedelta(days=2),
        forecast_horizon_days=7,
    ))
    snapshot = result["data_snapshot"]
    assert datetime.fromisoformat(snapshot["capturedAt"]) > connection.revision_at
    assert snapshot["dataQuality"] == [{
        "productId": None, "date": str(DAY),
        "classification": "confirmed_zero", "note": "Included revision",
    }]
