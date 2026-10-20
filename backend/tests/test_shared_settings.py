"""Canonical settings and optimistic conflict checks for shared clients."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

from fastapi import HTTPException
import psycopg
import pytest

from app import sqlite_demo
from app.repository import Repository
from app.schemas import SettingsUpdate
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401
from test_sqlite_demo import client as sqlite_client, sign_in  # noqa: F401


def saved_settings(client, base):
    response = client.get(base + "/settings")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_settings_return_canonical_profile_and_stable_version(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    current = saved_settings(client, base)
    assert current == saved_settings(client, base)
    assert isinstance(current["version"], str) and len(current["version"]) == 64
    assert current["businessName"]
    assert current["businessLocation"] is None
    assert current["dataOrigin"] == "demo"
    response = client.put(base + "/settings", json={
        **current, "expectedVersion": current["version"], "movingAverageWindow": 14,
        "businessName": "Updated synthetic store", "businessLocation": "Synthetic location",
    })
    assert response.status_code == 200, response.text
    saved = response.json()["data"]
    assert saved == saved_settings(client, base)
    assert saved["version"] != current["version"]
    assert saved["movingAverageWindow"] == 14
    assert saved["businessName"] == "Updated synthetic store"
    assert saved["businessLocation"] == "Synthetic location"


def test_stale_name_only_submission_cannot_revert_another_clients_window(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    old = saved_settings(client, base)
    another_client = client.put(base + "/settings", json={
        **old, "expectedVersion": old["version"], "movingAverageWindow": 14,
    })
    assert another_client.status_code == 200, another_client.text
    canonical = another_client.json()["data"]
    stale = client.put(base + "/settings", json={
        **old, "expectedVersion": old["version"], "businessName": "Local unsaved name",
    })
    assert stale.status_code == 409, stale.text
    assert saved_settings(client, base) == canonical
    merged = client.put(base + "/settings", json={
        **canonical, "expectedVersion": canonical["version"], "businessName": "Local unsaved name",
    })
    assert merged.status_code == 200, merged.text
    assert merged.json()["data"]["movingAverageWindow"] == 14
    assert merged.json()["data"]["businessName"] == "Local unsaved name"


def test_parallel_settings_writes_with_same_version_have_one_winner(pg_client):
    client, business, dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    current = saved_settings(client, base)
    barrier = Barrier(2)

    def save(window):
        try:
            with psycopg.connect(dsn) as conn:
                repository = Repository(conn)
                barrier.wait(timeout=10)
                result = repository.put_settings(business, SettingsUpdate.model_validate({
                    **current, "expectedVersion": current["version"], "movingAverageWindow": window,
                }))
            return 200, result
        except HTTPException as error:
            return error.status_code, None

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(save, [14, 30]))
    assert sorted(status for status, _result in results) == [200, 409]
    winner = next(result for status, result in results if status == 200)
    assert saved_settings(client, base) == winner


def test_profile_only_edit_changes_settings_version_and_poll_revision(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    before = saved_settings(client, base)
    revision = client.get(base + "/forecast-status").json()["data"]["revision"]
    changed = client.patch(base, json={"name": "Externally renamed store"})
    assert changed.status_code == 200, changed.text
    after = saved_settings(client, base)
    assert after["version"] != before["version"]
    assert after["businessName"] == "Externally renamed store"
    assert client.get(base + "/forecast-status").json()["data"]["revision"] != revision
    stale = client.put(base + "/settings", json={
        **before, "expectedVersion": before["version"], "movingAverageWindow": 14,
    })
    assert stale.status_code == 409, stale.text
    assert saved_settings(client, base) == after


def test_legacy_settings_writes_and_permissions_remain_supported(pg_client):
    client, business, dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    current = saved_settings(client, base)
    legacy = client.put(base + "/settings", json={**current, "movingAverageWindow": 14})
    assert legacy.status_code == 200, legacy.text
    canonical = legacy.json()["data"]
    csrf = client.headers.pop("X-CSRF-Token")
    no_csrf = client.put(base + "/settings", json=current)
    assert no_csrf.status_code == 403, no_csrf.text
    client.headers["X-CSRF-Token"] = csrf
    other_business = f"/api/v1/businesses/{uuid4()}"
    assert client.get(other_business + "/settings").status_code == 403
    assert client.put(other_business + "/settings", json=current).status_code == 403
    with psycopg.connect(dsn) as conn:
        conn.execute("UPDATE users SET role='staff' WHERE business_id=%s", (business,))
    assert saved_settings(client, base) == canonical
    no_owner = client.put(base + "/settings", json=current)
    assert no_owner.status_code == 403, no_owner.text
    assert saved_settings(client, base) == canonical


def test_dashboard_sync_contains_full_catalog_and_current_advice_settings(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    active = create_product(client, business)
    inactive_response = client.post(base + "/products", json={
        **active, "sku": "INACTIVE", "name": "Inactive synthetic product",
    })
    assert inactive_response.status_code == 201, inactive_response.text
    inactive = inactive_response.json()["data"]
    assert client.patch(base + f"/products/{inactive['id']}", json={"isActive": False}).status_code == 200
    day = client.get(base + "/forecast-dashboard").json()["data"]["businessDay"]
    sale = client.post(base + "/sales", json={
        "productId": active["id"], "saleDate": day, "quantity": "5",
    })
    assert sale.status_code == 201, sale.text
    response = client.get(base + "/forecast-dashboard")
    assert response.status_code == 200, response.text
    dashboard = response.json()["data"]
    assert dashboard["sharedState"]["products"] == client.get(base + "/products").json()["data"]
    assert dashboard["sharedState"]["settings"] == saved_settings(client, base)
    assert {row["id"] for row in dashboard["sharedState"]["products"]} == {active["id"], inactive["id"]}
    assert [row["productId"] for row in dashboard["recommendations"]] == [active["id"]]
    recommendation = dashboard["recommendations"][0]
    assert Decimal(recommendation["days_of_cover"]) == 3


def sqlite_settings_base(client):
    client.headers.update(sign_in(client))
    return f"/api/v1/businesses/{sqlite_demo.DEMO_BUSINESS_ID}"


def test_sqlite_canonical_settings_and_stale_name_save_preserve_new_window(sqlite_client):
    base = sqlite_settings_base(sqlite_client)
    old = saved_settings(sqlite_client, base)
    assert old == saved_settings(sqlite_client, base)
    assert old["businessName"] == "StockCast SQLite Demo"
    assert old["businessLocation"] is None
    assert old["dataOrigin"] == "demo"
    assert isinstance(old["version"], str) and len(old["version"]) == 64
    changed = sqlite_client.put(base + "/settings", json={
        **old, "expectedVersion": old["version"], "movingAverageWindow": 14,
        "businessName": "Updated SQLite store",
    })
    assert changed.status_code == 200, changed.text
    canonical = changed.json()["data"]
    assert canonical["version"] != old["version"]
    assert canonical["businessName"] == "Updated SQLite store"
    stale = sqlite_client.put(base + "/settings", json={
        **old, "expectedVersion": old["version"], "businessName": "Local unsaved name",
    })
    assert stale.status_code == 409, stale.text
    assert saved_settings(sqlite_client, base) == canonical


def test_sqlite_parallel_same_version_writes_have_one_winner(sqlite_client):
    base = sqlite_settings_base(sqlite_client)
    current = saved_settings(sqlite_client, base)
    barrier = Barrier(2)

    def save(window):
        barrier.wait(timeout=10)
        return sqlite_client.put(base + "/settings", json={
            **current, "expectedVersion": current["version"], "movingAverageWindow": window,
        })

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(save, [14, 30]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json()["data"] for response in responses if response.status_code == 200)
    assert saved_settings(sqlite_client, base) == winner


def test_sqlite_unsupported_location_rejects_before_any_settings_or_name_change(sqlite_client):
    base = sqlite_settings_base(sqlite_client)
    current = saved_settings(sqlite_client, base)
    rejected = sqlite_client.put(base + "/settings", json={
        **current, "expectedVersion": current["version"], "movingAverageWindow": 14,
        "businessName": "Must not save", "businessLocation": "Unsupported location",
    })
    assert rejected.status_code == 422, rejected.text
    assert saved_settings(sqlite_client, base) == current


@pytest.mark.parametrize("location", [None, "", "   "])
def test_sqlite_legacy_save_accepts_empty_location_without_new_business_columns(sqlite_client, location):
    base = sqlite_settings_base(sqlite_client)
    current = saved_settings(sqlite_client, base)
    saved = sqlite_client.put(base + "/settings", json={
        **current, "movingAverageWindow": 14, "businessLocation": location,
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["movingAverageWindow"] == 14
    assert saved.json()["data"]["businessLocation"] is None
    with sqlite_demo.connect() as conn:
        assert {row["name"] for row in conn.execute("PRAGMA table_info(businesses)")} == {
            "id", "name", "data_origin",
        }


def test_sqlite_settings_permissions_and_business_scope_remain_enforced(sqlite_client):
    base = sqlite_settings_base(sqlite_client)
    current = saved_settings(sqlite_client, base)
    other = f"/api/v1/businesses/{uuid4()}/settings"
    assert sqlite_client.get(other).status_code == 403
    assert sqlite_client.put(other, json=current).status_code == 403
    csrf = sqlite_client.headers.pop("X-CSRF-Token")
    assert sqlite_client.put(base + "/settings", json=current).status_code == 403
    sqlite_client.headers["X-CSRF-Token"] = csrf
    with sqlite_demo.connect() as conn:
        conn.execute("UPDATE users SET role='staff' WHERE business_id=?", (sqlite_demo.DEMO_BUSINESS_ID,))
    assert saved_settings(sqlite_client, base) == current
    assert sqlite_client.put(base + "/settings", json=current).status_code == 403
    assert saved_settings(sqlite_client, base) == current
