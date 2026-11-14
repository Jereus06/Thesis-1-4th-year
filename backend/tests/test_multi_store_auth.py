"""Same-email store accounts using the existing schema in disposable test schemas."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg
import pytest

from app.auth_repository import AuthRepository
from app.security import hash_password, token_hash
from test_postgres_integration import (
    fresh_auth_limiter,
    pg_client,
    signup_owner,
    signup_payload,
)


EMAIL = "owner@example.com"
PASSWORD = "test-owner-password"


def another_store(client, **changes):
    return signup_owner(
        client, **{"email": EMAIL, "password": PASSWORD, "businessName": "Second Store", **changes}
    ).json()["data"]


def test_reusing_email_creates_separate_empty_store_without_changing_original(pg_client):
    client, original, dsn = pg_client
    with psycopg.connect(dsn) as conn:
        # Seed the existing catalog contract directly: this auth regression is independent
        # of product-editor fields that are not part of this change.
        product_id = conn.execute(
            """INSERT INTO products(business_id,sku,name,category,unit,current_stock,
                       lead_time_days,safety_stock,unit_cost)
               VALUES(%s,'AUTH-TEST','Existing product','Test','piece',20,2,2,10) RETURNING id""",
            (original,),
        ).fetchone()[0]
        before = conn.execute(
            "SELECT id,password_hash,display_name FROM users WHERE business_id=%s", (original,)
        ).fetchone()
    created = another_store(client, email="OWNER@example.com")
    assert created["email"] == EMAIL
    assert created["businessId"] != original
    assert created["userId"] != str(before[0])
    assert client.get(f"/api/v1/businesses/{created['businessId']}/products").json()["data"] == []
    assert client.get(f"/api/v1/businesses/{created['businessId']}/sales").json()["data"] == []
    assert client.get(f"/api/v1/businesses/{original}/products").status_code == 403
    with psycopg.connect(dsn) as conn:
        assert conn.execute(
            "SELECT id,password_hash,display_name FROM users WHERE business_id=%s", (original,)
        ).fetchone() == before
        assert conn.execute("SELECT current_stock FROM products WHERE id=%s", (product_id,)).fetchone()[0] == 20
        assert conn.execute("SELECT count(*) FROM users WHERE email=%s", (EMAIL,)).fetchone()[0] == 2


@pytest.mark.parametrize("unavailable", ["wrong-password", "inactive-user", "inactive-business", "no-password"])
def test_email_reuse_requires_valid_existing_credentials_and_cannot_leave_orphans(pg_client, unavailable):
    client, original, dsn = pg_client
    with psycopg.connect(dsn) as conn:
        if unavailable == "inactive-user":
            conn.execute("UPDATE users SET is_active=false WHERE business_id=%s", (original,))
        elif unavailable == "inactive-business":
            conn.execute("UPDATE businesses SET is_active=false WHERE id=%s", (original,))
        elif unavailable == "no-password":
            conn.execute("UPDATE users SET password_hash=NULL WHERE business_id=%s", (original,))
    response = client.post("/api/v1/auth/sign-up", json=signup_payload(
        email=EMAIL, password="unmatched-password" if unavailable == "wrong-password" else PASSWORD,
    ))
    assert response.status_code == 409
    assert "current password" in response.json()["detail"]
    with psycopg.connect(dsn) as conn:
        for table in ("businesses", "users", "business_settings"):
            assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 1


def test_same_store_retry_is_rejected_but_another_location_can_be_created(pg_client):
    client, _, dsn = pg_client
    first = another_store(client)
    repeated = client.post("/api/v1/auth/sign-up", json=signup_payload(
        email=EMAIL, password=PASSWORD, businessName="  SECOND STORE  ", businessLocation="test location",
    ))
    assert repeated.status_code == 409
    assert "name and location" in repeated.json()["detail"]
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM businesses").fetchone()[0] == 2
    branch = another_store(client, businessLocation="Another Location")
    assert branch["businessId"] != first["businessId"]


def test_store_choices_require_password_and_issue_no_session_or_cross_store_access(pg_client):
    client, original, dsn = pg_client
    created = another_store(client)
    with psycopg.connect(dsn) as conn:
        before = conn.execute("SELECT count(*) FROM sessions").fetchone()[0]
    payload = {"email": EMAIL, "password": PASSWORD}
    ambiguous = client.post("/api/v1/auth/sign-in", json=payload)
    assert ambiguous.status_code == 409
    assert not ambiguous.headers.get_list("set-cookie")
    choices = client.post("/api/v1/auth/sign-in/stores", json=payload)
    assert choices.status_code == 200
    assert choices.headers["cache-control"] == "no-store"
    assert not choices.headers.get_list("set-cookie")
    stores = choices.json()["data"]
    assert {store["businessId"] for store in stores} == {original, created["businessId"]}
    assert all(set(store) == {"businessId", "businessName", "businessLocation", "role"} for store in stores)
    for wrong in [{"email": EMAIL, "password": "incorrect"}, {"email": "unknown@example.com", "password": PASSWORD}]:
        failure = client.post("/api/v1/auth/sign-in/stores", json=wrong)
        assert failure.status_code == 401
        assert failure.json() == {"detail": "Invalid business, email, or password"}
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == before
    chosen = client.post("/api/v1/auth/sign-in", json={**payload, "businessId": original})
    assert chosen.status_code == 200
    assert chosen.json()["data"]["businessId"] == original
    assert client.get(f"/api/v1/businesses/{created['businessId']}/products").status_code == 403
    foreign = client.post("/api/v1/auth/sign-in/stores", json=payload, headers={"Origin": "https://foreign.example.com"})
    assert foreign.status_code == 403


@pytest.mark.parametrize("excluded", ["different-password", "inactive-user", "inactive-business"])
def test_store_choice_only_discloses_matching_active_accounts(pg_client, excluded):
    client, original, dsn = pg_client
    created = another_store(client)
    with psycopg.connect(dsn) as conn:
        if excluded == "different-password":
            conn.execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password("different-store-password"), created["userId"]))
        elif excluded == "inactive-user":
            conn.execute("UPDATE users SET is_active=false WHERE id=%s", (created["userId"],))
        else:
            conn.execute("UPDATE businesses SET is_active=false WHERE id=%s", (created["businessId"],))
    response = client.post("/api/v1/auth/sign-in/stores", json={"email": EMAIL, "password": PASSWORD})
    assert response.status_code == 200
    assert [store["businessId"] for store in response.json()["data"]] == [original]
    assert client.post("/api/v1/auth/sign-in", json={"email": EMAIL, "password": PASSWORD, "businessId": created["businessId"]}).status_code == 401


def test_multi_store_recovery_sends_one_email_and_changes_only_selected_store(pg_client, monkeypatch):
    client, original, dsn = pg_client
    created = another_store(client)
    sent = []
    monkeypatch.setattr("app.auth_routes.Mailer.send", lambda _self, to, subject, text: sent.append((to, text)))
    response = client.post("/api/v1/auth/password/recovery", json={"email": EMAIL})
    assert response.status_code == 200
    assert response.json() == {"data": {"accepted": True}}
    assert len(sent) == 1 and sent[0][0] == EMAIL
    assert "Second Store" in sent[0][1]
    tokens = [part.split()[0] for part in sent[0][1].split("?reset=")[1:]]
    assert len(tokens) == 2 and len(set(tokens)) == 2
    with psycopg.connect(dsn) as conn:
        target = next(raw for raw in tokens if str(conn.execute("SELECT user_id FROM password_reset_tokens WHERE token_hash=%s", (token_hash(raw),)).fetchone()[0]) == created["userId"])
    reset = client.post("/api/v1/auth/password/recovery/complete", json={"token": target, "newPassword": "second-store-new-password"})
    assert reset.status_code == 200
    assert client.post("/api/v1/auth/password/recovery/complete", json={"token": target, "newPassword": "unusable-repeated-password"}).status_code == 400
    for business_id, password in [(original, PASSWORD), (created["businessId"], "second-store-new-password")]:
        signed = client.post("/api/v1/auth/sign-in", json={"email": EMAIL, "password": password, "businessId": business_id})
        assert signed.status_code == 200 and signed.json()["data"]["businessId"] == business_id
    narrowed = client.post("/api/v1/auth/password/recovery", json={"email": EMAIL, "businessId": original})
    assert narrowed.status_code == 200
    assert sent[-1][1].count("?reset=") == 1
    assert "Second Store" not in sent[-1][1]


def test_concurrent_multi_store_recovery_replaces_all_old_links_atomically(pg_client):
    client, _, dsn = pg_client
    another_store(client)
    barrier = Barrier(2)
    def recover():
        with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
            barrier.wait(timeout=10)
            return AuthRepository(conn).create_store_resets(EMAIL)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = [future.result(timeout=20) for future in [executor.submit(recover), executor.submit(recover)]]
    batches = [{token_hash(link["token"]) for link in batch} for batch in (first, second)]
    with psycopg.connect(dsn) as conn:
        active = {row[0] for row in conn.execute("SELECT token_hash FROM password_reset_tokens WHERE consumed_at IS NULL").fetchall()}
    assert len(active) == 2 and active in batches
