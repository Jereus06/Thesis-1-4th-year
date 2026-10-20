"""Stock movement date limits through isolated authenticated API requests."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import psycopg
import pytest

from app import repository, sqlite_demo
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401
from test_sqlite_demo import client as sqlite_client, sign_in  # noqa: F401


FROZEN_INSTANT = datetime(2026, 10, 4, 16, 30, tzinfo=UTC)
TIMEZONES = [
    ("Asia/Manila", date(2026, 10, 5)),
    ("America/Los_Angeles", date(2026, 10, 4)),
]
MOVEMENTS = [("receipt", "2"), ("return", "2"), ("write_off", "-2"), ("adjustment", "-2")]


def freeze_business_day(monkeypatch):
    # Leave authentication and idempotency expiry clocks alone.
    def business_day(self, business_id):
        timezone = ZoneInfo(self.get_settings(business_id)["timezone"])
        return FROZEN_INSTANT.astimezone(timezone).date()

    monkeypatch.setattr(repository.Repository, "business_day", business_day)


def configure_timezone(client, base, timezone):
    settings = client.get(base + "/settings").json()["data"]
    response = client.put(base + "/settings", json={**settings, "timezone": timezone})
    assert response.status_code == 200, response.text


def movement_payload(product_id, day, movement_type, quantity_delta):
    return {
        "productId": product_id,
        "movementDate": str(day),
        "movementType": movement_type,
        "quantityDelta": quantity_delta,
        "note": "Synthetic movement date regression",
    }


@pytest.mark.parametrize("timezone, today", TIMEZONES)
def test_business_day_uses_saved_timezone_at_same_utc_instant(monkeypatch, timezone, today):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return FROZEN_INSTANT.astimezone(tz) if tz else FROZEN_INSTANT.replace(tzinfo=None)

    monkeypatch.setattr(repository, "datetime", FrozenDateTime)
    settings = SimpleNamespace(get_settings=lambda _business: {"timezone": timezone})
    assert repository.Repository.business_day(settings, "synthetic-business") == today


@pytest.mark.parametrize("timezone, today", TIMEZONES)
@pytest.mark.parametrize("movement_type, quantity_delta", MOVEMENTS)
def test_future_movement_rejects_without_stock_audit_or_request_key_writes(
    pg_client, monkeypatch, timezone, today, movement_type, quantity_delta,
):
    client, business, dsn = pg_client
    freeze_business_day(monkeypatch)
    base = f"/api/v1/businesses/{business}"
    configure_timezone(client, base, timezone)
    product = create_product(client, business)
    before_products = client.get(base + "/products").json()["data"]
    before_movements = client.get(base + "/inventory-movements").json()["data"]
    key = "future-movement"
    payload = movement_payload(product["id"], today + timedelta(days=1), movement_type, quantity_delta)

    response = client.post(base + "/inventory-movements", json=payload, headers={"Idempotency-Key": key})
    assert response.status_code == 422, response.text
    assert "business's current date" in response.json()["detail"]
    assert client.get(base + "/products").json()["data"] == before_products
    assert client.get(base + "/inventory-movements").json()["data"] == before_movements
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM idempotency_keys WHERE key=%s", (key,)).fetchone()[0] == 0

    # A rejected date must not reserve the key and prevent correcting the request.
    payload["movementDate"] = str(today)
    corrected = client.post(base + "/inventory-movements", json=payload, headers={"Idempotency-Key": key})
    assert corrected.status_code == 201, corrected.text
    assert corrected.json()["data"]["movementDate"] == str(today)
    stock = Decimal(client.get(base + "/products").json()["data"][0]["currentStock"])
    assert stock == Decimal("20") + Decimal(quantity_delta)


@pytest.mark.parametrize("timezone, today", TIMEZONES)
@pytest.mark.parametrize("movement_type, quantity_delta", MOVEMENTS)
def test_today_and_backdated_movements_remain_accepted(
    pg_client, monkeypatch, timezone, today, movement_type, quantity_delta,
):
    client, business, _dsn = pg_client
    freeze_business_day(monkeypatch)
    base = f"/api/v1/businesses/{business}"
    configure_timezone(client, base, timezone)
    product = create_product(client, business)
    before_movements = client.get(base + "/inventory-movements").json()["data"]
    saved = []
    for index, day in enumerate([today, today - timedelta(days=7)]):
        response = client.post(
            base + "/inventory-movements",
            json=movement_payload(product["id"], day, movement_type, quantity_delta),
            headers={"Idempotency-Key": f"accepted-movement-{index}"},
        )
        assert response.status_code == 201, response.text
        saved.append(response.json()["data"])
        assert saved[-1]["movementDate"] == str(day)

    stock = Decimal(client.get(base + "/products").json()["data"][0]["currentStock"])
    assert stock == Decimal("20") + 2 * Decimal(quantity_delta)
    after_movements = client.get(base + "/inventory-movements").json()["data"]
    assert len(after_movements) == len(before_movements) + 2
    assert all(row in after_movements for row in before_movements + saved)


def test_saved_write_off_still_replays_at_zero_stock(pg_client, monkeypatch):
    client, business, _dsn = pg_client
    freeze_business_day(monkeypatch)
    base = f"/api/v1/businesses/{business}"
    configure_timezone(client, base, "Asia/Manila")
    product = create_product(client, business, stock="5")
    payload = movement_payload(product["id"], date(2026, 10, 5), "write_off", "-5")
    headers = {"Idempotency-Key": "zero-stock-write-off"}
    saved = client.post(base + "/inventory-movements", json=payload, headers=headers)
    assert saved.status_code == 201, saved.text
    before_movements = client.get(base + "/inventory-movements").json()["data"]

    # Saved responses are confirmed before revalidating a new movement against stock/date.
    configure_timezone(client, base, "America/Los_Angeles")
    replay = client.post(base + "/inventory-movements", json=payload, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.json() == saved.json()
    assert Decimal(client.get(base + "/products").json()["data"][0]["currentStock"]) == 0
    assert client.get(base + "/inventory-movements").json()["data"] == before_movements


@pytest.mark.parametrize("timezone, today", TIMEZONES)
@pytest.mark.parametrize("movement_type, quantity_delta", MOVEMENTS)
def test_sqlite_movement_dates_use_saved_timezone_and_preserve_past_dates(
    sqlite_client, monkeypatch, timezone, today, movement_type, quantity_delta,
):
    headers = sign_in(sqlite_client)
    base = f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}"
    with sqlite_demo.connect() as conn:
        conn.execute("UPDATE business_settings SET timezone=?", (timezone,))

    class FrozenBusinessDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            # Authentication and audit timestamps use UTC; freeze only the business-date read.
            if isinstance(tz, ZoneInfo):
                return FROZEN_INSTANT.astimezone(tz)
            return datetime.now(tz)

    monkeypatch.setattr(sqlite_demo, "datetime", FrozenBusinessDateTime)
    created = sqlite_client.post(base + "/products", headers=headers, json={
        "sku": "MOVEMENT-DATES", "name": "Synthetic date product", "category": "Test",
        "unit": "piece", "currentStock": "20", "leadTimeDays": 2,
        "safetyStock": "0", "unitCost": "1",
    })
    assert created.status_code == 201, created.text
    product = created.json()["data"]
    before_products = sqlite_client.get(base + "/products").json()["data"]
    before_movements = sqlite_client.get(base + "/inventory-movements").json()["data"]
    future = sqlite_client.post(
        base + "/inventory-movements", headers=headers,
        json=movement_payload(product["id"], today + timedelta(days=1), movement_type, quantity_delta),
    )
    assert future.status_code == 422, future.text
    assert "business's current date" in future.json()["detail"]
    assert sqlite_client.get(base + "/products").json()["data"] == before_products
    assert sqlite_client.get(base + "/inventory-movements").json()["data"] == before_movements

    for day in [today, today - timedelta(days=7)]:
        accepted = sqlite_client.post(
            base + "/inventory-movements", headers=headers,
            json=movement_payload(product["id"], day, movement_type, quantity_delta),
        )
        assert accepted.status_code == 201, accepted.text
        assert accepted.json()["data"]["movementDate"] == str(day)
    stock = Decimal(sqlite_client.get(base + "/products").json()["data"][0]["currentStock"])
    assert stock == Decimal("20") + 2 * Decimal(quantity_delta)
    assert len(sqlite_client.get(base + "/inventory-movements").json()["data"]) == len(before_movements) + 2
