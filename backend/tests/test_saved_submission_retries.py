"""Saved requests replay before mutable stock, activity, and business-date checks."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg
import pytest

from app import sqlite_demo
from app.repository import Repository
from test_postgres_integration import fresh_auth_limiter, pg_client  # noqa: F401
from test_sqlite_demo import client as sqlite_client, sign_in  # noqa: F401


INSTANT = datetime(2026, 10, 4, 16, 30, tzinfo=UTC)
SAVED_DAY = date(2026, 10, 5)
CASES = ["sale", "receipt", "return", "write_off", "adjustment"]


@pytest.fixture(params=["postgres", "sqlite"])
def retry_api(request, monkeypatch):
    kind = request.param
    if kind == "postgres":
        client, business, dsn = request.getfixturevalue("pg_client")
    else:
        client = request.getfixturevalue("sqlite_client")
        client.headers.update(sign_in(client))
        business, dsn = sqlite_demo.DEMO_BUSINESS_ID, None

    def business_day(self, business_id):
        return INSTANT.astimezone(ZoneInfo(self.get_settings(business_id)["timezone"])).date()

    class BusinessDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if isinstance(tz, ZoneInfo):
                return INSTANT.astimezone(tz)
            return datetime.now(tz)

    monkeypatch.setattr(Repository, "business_day", business_day)
    monkeypatch.setattr(sqlite_demo, "datetime", BusinessDateTime)
    base = f"/api/v1/businesses/{business}"
    created = client.post(base + "/products", json={
        "sku": "SAVED-RETRY", "name": "Synthetic saved retry", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    })
    assert created.status_code == 201, created.text
    return client, base, created.json()["data"], kind, dsn


def submission(base, product_id, case, day=SAVED_DAY):
    if case == "sale":
        return base + "/sales", {
            "productId": product_id, "saleDate": str(day), "quantity": "5",
        }
    delta = {"receipt": "2", "return": "2", "write_off": "-5", "adjustment": "-2"}[case]
    return base + "/inventory-movements", {
        "productId": product_id, "movementDate": str(day), "movementType": case,
        "quantityDelta": delta, "note": "Synthetic saved submission regression",
    }


def snapshot(client, base):
    return (
        client.get(base + "/products").json()["data"],
        client.get(base + "/sales").json()["data"],
        client.get(base + "/inventory-movements").json()["data"],
    )


@pytest.mark.parametrize("case", CASES)
def test_saved_retry_survives_deactivation_but_uncached_submission_rejects(retry_api, case):
    client, base, product, _kind, _dsn = retry_api
    path, payload = submission(base, product["id"], case)
    headers = {"Idempotency-Key": "saved-before-deactivation"}
    saved = client.post(path, json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    disabled = client.patch(base + f"/products/{product['id']}", json={"isActive": False})
    assert disabled.status_code == 200, disabled.text
    before = snapshot(client, base)

    replay = client.post(path, json=payload, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.json() == saved.json()
    fresh = client.post(path, json=payload, headers={"Idempotency-Key": "new-after-deactivation"})
    assert fresh.status_code == 404, fresh.text
    assert snapshot(client, base) == before


@pytest.mark.parametrize("case", CASES)
def test_saved_retry_survives_business_date_change_but_new_future_write_rejects(retry_api, case):
    client, base, product, _kind, _dsn = retry_api
    path, payload = submission(base, product["id"], case)
    headers = {"Idempotency-Key": "saved-before-date-change"}
    saved = client.post(path, json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    settings = client.get(base + "/settings").json()["data"]
    changed = client.put(base + "/settings", json={**settings, "timezone": "America/Los_Angeles"})
    assert changed.status_code == 200, changed.text
    before = snapshot(client, base)

    replay = client.post(path, json=payload, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.json() == saved.json()
    fresh_headers = {"Idempotency-Key": "new-future-submission"}
    fresh = client.post(path, json=payload, headers=fresh_headers)
    assert fresh.status_code == 422, fresh.text
    assert snapshot(client, base) == before
    # A rejected write cannot reserve a request key and block a corrected date.
    _path, corrected_payload = submission(base, product["id"], case, SAVED_DAY - timedelta(days=1))
    corrected = client.post(path, json=corrected_payload, headers=fresh_headers)
    assert corrected.status_code == 201, corrected.text


@pytest.mark.parametrize("case", ["sale", "write_off"])
def test_changed_retry_payload_conflicts_before_mutable_checks(retry_api, case):
    client, base, product, _kind, _dsn = retry_api
    path, payload = submission(base, product["id"], case)
    headers = {"Idempotency-Key": "changed-saved-payload"}
    saved = client.post(path, json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    assert client.patch(base + f"/products/{product['id']}", json={"isActive": False}).status_code == 200
    before = snapshot(client, base)
    changed = {**payload, **({"quantity": "6"} if case == "sale" else {"quantityDelta": "-6"})}
    conflict = client.post(path, json=changed, headers=headers)
    assert conflict.status_code == 409, conflict.text
    assert snapshot(client, base) == before


def test_saved_write_off_replay_still_requires_csrf_owner_and_business_membership(retry_api):
    client, base, product, kind, dsn = retry_api
    path, payload = submission(base, product["id"], "write_off")
    headers = {"Idempotency-Key": "protected-saved-write-off"}
    saved = client.post(path, json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    before = snapshot(client, base)
    csrf = client.headers.pop("X-CSRF-Token")
    assert client.post(path, json=payload, headers=headers).status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    wrong_business_path = f"/api/v1/businesses/{uuid4()}/inventory-movements"
    assert client.post(wrong_business_path, json=payload, headers=headers).status_code == 403
    if kind == "postgres":
        with psycopg.connect(dsn) as conn:
            conn.execute("UPDATE users SET role='staff'")
    else:
        with sqlite_demo.connect() as conn:
            conn.execute("UPDATE users SET role='staff'")
    assert client.post(path, json=payload, headers=headers).status_code == 403
    assert snapshot(client, base) == before


def test_voided_sale_cannot_be_replayed_as_a_saved_submission(retry_api):
    client, base, product, _kind, _dsn = retry_api
    path, payload = submission(base, product["id"], "sale")
    headers = {"Idempotency-Key": "subsequently-voided-sale"}
    saved = client.post(path, json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    deleted = client.delete(base + f"/sales/{saved.json()['data']['id']}")
    assert deleted.status_code == 200, deleted.text
    before = snapshot(client, base)
    assert Decimal(before[0][0]["currentStock"]) == 20
    replay = client.post(path, json=payload, headers=headers)
    assert replay.status_code == 409, replay.text
    assert "deleted" in replay.json()["detail"]
    assert snapshot(client, base) == before
