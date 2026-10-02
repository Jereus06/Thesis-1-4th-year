"""Real PostgreSQL checks in a temporary schema in an explicit test database."""

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg_pool import ConnectionPool


@pytest.fixture()
def pg_client(monkeypatch, tmp_path):
    database = os.getenv("STOCKCAST_TEST_DATABASE_URL")
    if not database:
        pytest.skip("Set STOCKCAST_TEST_DATABASE_URL to an isolated PostgreSQL test database")
    schema = f"test_{uuid4().hex}"
    with psycopg.connect(database, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    url = urlsplit(database)
    query = dict(parse_qsl(url.query))
    query["options"] = f"-csearch_path={schema}"
    dsn = urlunsplit(url._replace(query=urlencode(query)))
    monkeypatch.setenv("DATABASE_URL", dsn)
    monkeypatch.setenv("OWNER_PASSWORD", "test-owner-password")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("ARTIFACT_DIR", str(tmp_path / "models"))
    from app.config import get_settings

    get_settings.cache_clear()
    from app import db
    from app.bootstrap_owner import bootstrap
    from app.migrate import migrate

    migrate()
    business = bootstrap()
    monkeypatch.setattr(
        db, "pool", ConnectionPool(dsn, open=False, kwargs={"row_factory": psycopg.rows.dict_row})
    )
    from app.main import app

    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/auth/sign-in",
                json={
                    "businessId": business,
                    "email": "owner@example.com",
                    "password": "test-owner-password",
                },
            )
            assert response.status_code == 200, response.text
            client.headers["X-CSRF-Token"] = client.cookies["stockcast_csrf"]
            yield client, business, dsn
    finally:
        get_settings.cache_clear()
        with psycopg.connect(database, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def create_product(client, business, stock="20"):
    response = client.post(
        f"/api/v1/businesses/{business}/products",
        headers={"Idempotency-Key": "product-1"},
        json={
            "sku": "TEST-1",
            "name": "Test Product",
            "category": "Test",
            "unit": "pc",
            "currentStock": stock,
            "leadTimeDays": 2,
            "safetyStock": "2",
            "unitCost": "10",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_postgres_writes_idempotency_import_export_and_owner_restart(pg_client):
    client, business, dsn = pg_client
    product = create_product(client, business)
    assert create_product(client, business)["id"] == product["id"]
    base = f"/api/v1/businesses/{business}"
    sale = {"productId": product["id"], "saleDate": "2026-09-30", "quantity": "2"}
    for _ in range(2):
        assert (
            client.post(
                base + "/sales", json=sale, headers={"Idempotency-Key": "sale-1"}
            ).status_code
            == 201
        )
    assert len(client.get(base + "/sales").json()["data"]) == 1
    changed = client.patch(base + f"/products/{product['id']}", json={"currentStock": "25"})
    assert changed.status_code == 200
    movements = client.get(base + "/inventory-movements").json()["data"]
    assert len(movements) == 3
    assert any(
        row["movementType"] == "adjustment" and float(row["quantityDelta"]) == 7
        for row in movements
    )
    imported = client.post(
        base + "/data-imports",
        json={
            "source": "csv",
            "rows": [{"sku": "TEST-1", "saleDate": "2026-09-29", "quantity": "4"}],
        },
    )
    assert imported.status_code == 201, imported.text
    assert float(client.get(base + "/products").json()["data"][0]["currentStock"]) == 25
    assert "TEST-1" in client.get(base + "/exports/sales.csv").text
    assert client.get(base + "/exports/inventory-movements.csv").status_code == 200
    settings = client.get(base + "/settings").json()["data"]
    saved = client.put(
        base + "/settings",
        json={**settings, "businessName": "My Test Store", "businessLocation": "Test City"},
    )
    assert saved.status_code == 200, saved.text
    assert client.get(base).json()["data"]["name"] == "My Test Store"
    rejected = client.put(
        base + "/settings", json={**settings, "businessName": "   ", "movingAverageWindow": 14}
    )
    assert rejected.status_code == 422
    assert (
        client.get(base + "/settings").json()["data"]["movingAverageWindow"]
        == settings["movingAverageWindow"]
    )
    from app.bootstrap_owner import bootstrap

    with psycopg.connect(dsn) as conn:
        before = conn.execute("SELECT password_hash FROM users").fetchone()[0]
    bootstrap()
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT password_hash FROM users").fetchone()[0] == before
    assert (
        client.get("/api/v1/businesses/00000000-0000-4000-8000-000000000099/products").status_code
        == 403
    )


def test_worker_commits_failed_job_and_processes_next_job(pg_client, monkeypatch):
    client, business, _dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    payload = {
        "trainingStart": "2026-01-01",
        "trainingEnd": "2026-01-01",
        "validationStart": "2026-01-02",
        "validationEnd": "2026-01-02",
        "finalTestStart": "2026-01-03",
        "finalTestEnd": "2026-01-03",
        "forecastHorizonDays": 7,
    }
    first = client.post(base + "/forecast-runs", json=payload)
    assert first.status_code == 202, first.text
    from app import worker

    real_process = worker.process_run
    monkeypatch.setattr(
        worker, "process_run", lambda *_: (_ for _ in ()).throw(RuntimeError("Test failure"))
    )
    assert worker.run_once()
    failed = client.get(base + f"/forecast-runs/{first.json()['data']['id']}").json()["data"]
    assert failed["status"] == "failed"
    monkeypatch.setattr(worker, "process_run", real_process)
    second = client.post(base + "/forecast-runs", json=payload)
    assert second.status_code == 202
    assert worker.run_once()
    completed = client.get(base + f"/forecast-runs/{second.json()['data']['id']}").json()["data"]
    assert completed["status"] == "completed"
    dashboard = client.get(base + "/forecast-dashboard")
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["data"]["recommendations"][0]["suggested_quantity"] == "0"


@pytest.fixture(autouse=True)
def fresh_auth_limiter(monkeypatch):
    from app import auth_routes

    monkeypatch.setattr(auth_routes, "limiter", auth_routes.AuthLimiter())


@pytest.fixture()
def google_exchange(pg_client, monkeypatch):
    from app.config import get_settings
    from app.google_auth import GoogleClient

    monkeypatch.setenv("CORS_ORIGIN", "http://127.0.0.1:5173")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-google-secret")
    monkeypatch.setenv(
        "GOOGLE_REDIRECT_URI", "http://127.0.0.1:5173/api/v1/auth/google/callback"
    )
    get_settings.cache_clear()
    result = {
        "identity": {
            "subject": "google-subject-test-1",
            "email": "google-owner@example.com",
            "display_name": "Google Test Owner",
        },
        "calls": [],
        "error": None,
    }

    def exchange(_client, code, verifier, nonce):
        result["calls"].append((code, verifier, nonce))
        if result["error"] is not None:
            raise result["error"]
        return dict(result["identity"])

    monkeypatch.setattr(GoogleClient, "exchange", exchange)
    yield result
    get_settings.cache_clear()


def signup_payload(**overrides):
    return {
        "displayName": "Test Signup Owner",
        "businessName": "Test Signup Store",
        "businessLocation": "Test Location",
        "dataOrigin": "demo",
        "email": "new.signup@example.com",
        "password": "signup-owner-password",
        **overrides,
    }


def signup_owner(client, **overrides):
    response = client.post("/api/v1/auth/sign-up", json=signup_payload(**overrides))
    assert response.status_code == 201, response.text
    client.headers["X-CSRF-Token"] = client.cookies["stockcast_csrf"]
    return response


def sign_out_owner(client):
    client.headers["X-CSRF-Token"] = client.cookies["stockcast_csrf"]
    response = client.post("/api/v1/auth/sign-out")
    assert response.status_code == 200, response.text
    client.headers.pop("X-CSRF-Token", None)


def start_google(client, intent="sign-in"):
    response = client.post("/api/v1/auth/google/start", json={"intent": intent})
    assert response.status_code == 200, response.text
    query = dict(parse_qsl(urlsplit(response.json()["data"]["url"]).query))
    assert query["code_challenge_method"] == "S256"
    return query["state"], client.cookies["stockcast_google_state"], query


def restore_google_browser(client, browser):
    for cookie in list(client.cookies.jar):
        if cookie.name == "stockcast_google_state":
            client.cookies.delete(cookie.name, domain=cookie.domain, path=cookie.path)
    client.cookies.set(
        "stockcast_google_state",
        browser,
        domain="testserver.local",
        path="/api/v1/auth/google",
    )


def google_callback(client, state, **query):
    return client.get(
        "/api/v1/auth/google/callback",
        params={"state": state, "code": "test-google-code", **query},
        follow_redirects=False,
    )


def callback_query(response):
    assert response.status_code == 303, response.text
    return dict(parse_qsl(urlsplit(response.headers["location"]).query))


def test_signup_creates_empty_isolated_store_and_authenticated_session(pg_client):
    from app.security import token_hash, verify_password

    client, old_business, dsn = pg_client
    response = signup_owner(
        client,
        email="New.Signup@example.com",
        displayName="  Test Signup Owner  ",
        businessName="  Test Signup Store  ",
    )
    user = response.json()["data"]
    business = user["businessId"]
    assert business != old_business
    assert user["role"] == "owner"
    assert user["email"] == "new.signup@example.com"
    assert user["displayName"] == "Test Signup Owner"
    assert client.get("/api/v1/auth/me").json()["data"] == user
    assert client.get(f"/api/v1/businesses/{business}/products").json()["data"] == []
    assert client.get(f"/api/v1/businesses/{business}/sales").json()["data"] == []
    assert client.get(f"/api/v1/businesses/{business}/settings").status_code == 200
    assert client.get(f"/api/v1/businesses/{old_business}/products").status_code == 403
    cookies = response.headers.get_list("set-cookie")
    assert any(
        value.startswith("stockcast_session=")
        and "httponly" in value.lower()
        and "samesite=strict" in value.lower()
        for value in cookies
    )
    assert any(
        value.startswith("stockcast_csrf=")
        and "httponly" not in value.lower()
        and "samesite=strict" in value.lower()
        for value in cookies
    )
    with psycopg.connect(dsn) as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE id=%s", (user["userId"],)
        ).fetchone()
        assert row[0] != "signup-owner-password"
        assert verify_password("signup-owner-password", row[0])
        session = conn.execute(
            "SELECT token_hash,csrf_token_hash FROM sessions WHERE user_id=%s",
            (user["userId"],),
        ).fetchone()
        assert session == (
            token_hash(client.cookies["stockcast_session"]),
            token_hash(client.cookies["stockcast_csrf"]),
        )
        assert conn.execute(
            "SELECT name,data_origin FROM businesses WHERE id=%s", (business,)
        ).fetchone() == ("Test Signup Store", "demo")
        before = conn.execute(
            "SELECT (SELECT count(*) FROM businesses), (SELECT count(*) FROM users), "
            "(SELECT count(*) FROM business_settings), (SELECT count(*) FROM sessions)"
        ).fetchone()
    duplicate = client.post(
        "/api/v1/auth/sign-up",
        json=signup_payload(email="new.signup@EXAMPLE.COM", businessName="No Orphan Store"),
    )
    assert duplicate.status_code == 409, duplicate.text
    with psycopg.connect(dsn) as conn:
        after = conn.execute(
            "SELECT (SELECT count(*) FROM businesses), (SELECT count(*) FROM users), "
            "(SELECT count(*) FROM business_settings), (SELECT count(*) FROM sessions)"
        ).fetchone()
    assert before == after


@pytest.mark.parametrize(
    "overrides",
    [
        {"displayName": "   "},
        {"businessName": "   "},
        {"password": "short"},
        {"password": "x" * 129},
    ],
)
def test_signup_rejects_invalid_fields_without_creating_records(pg_client, overrides):
    client, _business, dsn = pg_client
    response = client.post("/api/v1/auth/sign-up", json=signup_payload(**overrides))
    assert response.status_code == 422, response.text
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM businesses").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 1


def test_email_only_and_legacy_login_keep_csrf_and_session_guards(pg_client):
    client, business, dsn = pg_client
    csrf = client.headers.pop("X-CSRF-Token")
    assert client.post("/api/v1/auth/sign-out").status_code == 403
    assert client.get("/api/v1/auth/me").status_code == 200
    client.headers["X-CSRF-Token"] = csrf
    sign_out_owner(client)
    assert client.get("/api/v1/auth/me").status_code == 401
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0
    for payload in (
        {"email": "owner@example.com", "password": "test-owner-password"},
        {
            "businessId": business,
            "email": "owner@example.com",
            "password": "test-owner-password",
        },
    ):
        response = client.post("/api/v1/auth/sign-in", json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["businessId"] == business
        sign_out_owner(client)
    assert client.post(
        "/api/v1/auth/sign-in",
        json={"email": "owner@example.com", "password": "incorrect-password"},
    ).status_code == 401


def test_historical_shared_email_requires_explicit_business_selection(pg_client):
    from app.security import hash_password

    client, first_business, dsn = pg_client
    with psycopg.connect(dsn) as conn:
        second_business = conn.execute(
            "INSERT INTO businesses(name,data_origin) VALUES('Historical Test Store','demo') "
            "RETURNING id"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO business_settings(business_id) VALUES(%s)", (second_business,)
        )
        conn.execute(
            "INSERT INTO users(business_id,email,display_name,role,password_hash) "
            "VALUES(%s,'owner@example.com','Historical Owner','owner',%s)",
            (second_business, hash_password("test-owner-password")),
        )
    ambiguous = client.post(
        "/api/v1/auth/sign-in",
        json={"email": "owner@example.com", "password": "test-owner-password"},
    )
    assert ambiguous.status_code == 409
    assert "Business ID" in ambiguous.json()["detail"]
    for business in (first_business, str(second_business)):
        selected = client.post(
            "/api/v1/auth/sign-in",
            json={
                "businessId": business,
                "email": "owner@example.com",
                "password": "test-owner-password",
            },
        )
        assert selected.status_code == 200, selected.text
        assert selected.json()["data"]["businessId"] == business


def test_expired_sessions_and_disabled_businesses_cannot_authenticate(pg_client):
    from app.security import token_hash

    client, business, dsn = pg_client
    current_hash = token_hash(client.cookies["stockcast_session"])
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "UPDATE sessions SET created_at=now()-interval '1 hour', "
            "expires_at=now()-interval '1 minute' WHERE token_hash=%s",
            (current_hash,),
        )
    assert client.get("/api/v1/auth/me").status_code == 401
    logged_in = client.post(
        "/api/v1/auth/sign-in",
        json={"email": "owner@example.com", "password": "test-owner-password"},
    )
    assert logged_in.status_code == 200
    with psycopg.connect(dsn) as conn:
        conn.execute("UPDATE businesses SET is_active=false WHERE id=%s", (business,))
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post(
        "/api/v1/auth/sign-in",
        json={"email": "owner@example.com", "password": "test-owner-password"},
    ).status_code == 401


def test_registration_origin_guard_rejects_foreign_websites(pg_client):
    client, _business, dsn = pg_client
    response = client.post(
        "/api/v1/auth/sign-up",
        headers={"Origin": "https://foreign.example.invalid"},
        json=signup_payload(),
    )
    assert response.status_code == 403
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM businesses").fetchone()[0] == 1


def test_google_state_binding_replay_and_first_use_owner_onboarding(
    pg_client, google_exchange
):
    from app.security import token_hash

    client, old_business, dsn = pg_client
    sign_out_owner(client)
    assert client.get("/api/v1/auth/options").json()["data"]["googleEnabled"] is True
    state, browser, query = start_google(client)
    with psycopg.connect(dsn) as conn:
        flow = conn.execute(
            "SELECT state_hash,browser_hash,verifier,nonce FROM oauth_flows"
        ).fetchone()
    assert flow[0] == token_hash(state)
    assert flow[1] == token_hash(browser)
    assert flow[0] != state
    assert flow[1] != browser
    assert flow[3] == query["nonce"]
    restore_google_browser(client, "wrong-browser-token")
    wrong_browser = google_callback(client, state)
    assert callback_query(wrong_browser)["auth_error"] == "google_expired"
    assert google_exchange["calls"] == []
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM oauth_flows").fetchone()[0] == 1
    restore_google_browser(client, browser)
    result = google_callback(client, state)
    assert callback_query(result)["auth"] == "google-register"
    assert google_exchange["calls"] == [("test-google-code", flow[2], flow[3])]
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/google/pending").json()["data"] == {
        "email": "google-owner@example.com",
        "displayName": "Google Test Owner",
    }
    restore_google_browser(client, browser)
    assert callback_query(google_callback(client, state))["auth_error"] == "google_expired"
    assert len(google_exchange["calls"]) == 1
    completed = client.post(
        "/api/v1/auth/google/complete",
        json={
            "businessName": "Google Test Store",
            "businessLocation": "Synthetic Test Location",
            "dataOrigin": "demo",
        },
    )
    assert completed.status_code == 201, completed.text
    user = completed.json()["data"]
    assert user["role"] == "owner"
    assert user["businessId"] != old_business
    assert client.get("/api/v1/auth/me").json()["data"] == user
    assert client.get(f"/api/v1/businesses/{user['businessId']}/products").json()["data"] == []
    assert client.get(f"/api/v1/businesses/{old_business}/products").status_code == 403
    with psycopg.connect(dsn) as conn:
        assert conn.execute(
            "SELECT password_hash FROM users WHERE id=%s", (user["userId"],)
        ).fetchone()[0] is None
        assert str(conn.execute("SELECT user_id FROM google_identities").fetchone()[0]) == user["userId"]
        assert conn.execute("SELECT count(*) FROM google_pending").fetchone()[0] == 0
    assert client.get("/api/v1/auth/google/pending").json()["data"] is None
    assert client.post(
        "/api/v1/auth/google/complete",
        json={"businessName": "Duplicate Store", "dataOrigin": "demo"},
    ).status_code == 401
    sign_out_owner(client)
    next_state, _browser, _query = start_google(client)
    assert callback_query(google_callback(client, next_state))["auth"] == "google"
    assert client.get("/api/v1/auth/me").json()["data"] == user
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM businesses").fetchone()[0] == 2


def test_google_existing_password_email_never_auto_links(pg_client, google_exchange):
    client, _business, dsn = pg_client
    sign_out_owner(client)
    google_exchange["identity"]["email"] = "owner@example.com"
    state, _browser, _query = start_google(client)
    response = google_callback(client, state)
    assert callback_query(response)["auth_error"] == "google_account_exists"
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/google/pending").json()["data"] is None
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM google_identities").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM oauth_flows").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM businesses").fetchone()[0] == 1


def test_google_link_requires_csrf_and_live_initiating_session(pg_client, google_exchange):
    from app.security import token_hash

    client, _business, dsn = pg_client
    raw_session = client.cookies["stockcast_session"]
    original_csrf = client.cookies["stockcast_csrf"]
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "UPDATE sessions SET csrf_token_hash=NULL WHERE token_hash=%s",
            (token_hash(raw_session),),
        )
    arbitrary_csrf = "legacy-arbitrary-csrf"
    legacy = client.post(
        "/api/v1/auth/google/start",
        json={"intent": "link"},
        headers={
            "Cookie": f"stockcast_session={raw_session}; stockcast_csrf={arbitrary_csrf}",
            "X-CSRF-Token": arbitrary_csrf,
        },
    )
    assert legacy.status_code == 403, legacy.text
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "UPDATE sessions SET csrf_token_hash=%s WHERE token_hash=%s",
            (token_hash(original_csrf), token_hash(raw_session)),
        )
    csrf = client.headers.pop("X-CSRF-Token")
    rejected = client.post("/api/v1/auth/google/start", json={"intent": "link"})
    assert rejected.status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    state, _browser, _query = start_google(client, "link")
    sign_out_owner(client)
    assert callback_query(google_callback(client, state))["auth_error"] == "google_link_expired"
    assert client.post(
        "/api/v1/auth/google/start", json={"intent": "link"}
    ).status_code == 401
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM google_identities").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM oauth_flows").fetchone()[0] == 0


def test_google_explicit_link_subject_login_and_identity_conflict(
    pg_client, google_exchange
):
    client, owner_business, dsn = pg_client
    original_user = client.get("/api/v1/auth/me").json()["data"]
    state, _browser, _query = start_google(client, "link")
    assert callback_query(google_callback(client, state))["auth"] == "google-linked"
    assert client.get("/api/v1/auth/me").json()["data"] == original_user
    sign_out_owner(client)
    # Email is mutable at Google; the linked provider subject identifies the user.
    google_exchange["identity"]["email"] = "changed-google-email@example.com"
    state, _browser, _query = start_google(client)
    assert callback_query(google_callback(client, state))["auth"] == "google"
    assert client.get("/api/v1/auth/me").json()["data"] == original_user
    new_user = signup_owner(client, email="another-owner@example.com").json()["data"]
    state, browser, _query = start_google(client, "link")
    assert callback_query(google_callback(client, state))["auth_error"] == "google_link_conflict"
    assert client.get("/api/v1/auth/me").json()["data"] == new_user
    assert client.get(f"/api/v1/businesses/{owner_business}/products").status_code == 403
    with psycopg.connect(dsn) as conn:
        assert str(conn.execute("SELECT user_id FROM google_identities").fetchone()[0]) == original_user["userId"]
        assert conn.execute("SELECT count(*) FROM oauth_flows").fetchone()[0] == 0
    restore_google_browser(client, browser)
    assert callback_query(google_callback(client, state))["auth_error"] == "google_expired"


@pytest.mark.parametrize("failure", ["denied", "missing-code", "exchange"])
def test_google_callback_errors_consume_state(pg_client, google_exchange, failure):
    from app.google_auth import GoogleAuthError

    client, _business, dsn = pg_client
    state, browser, _query = start_google(client)
    query = {}
    if failure == "denied":
        query["error"] = "access_denied"
        expected = "google_denied"
    elif failure == "missing-code":
        query["code"] = ""
        expected = "google_failed"
    else:
        google_exchange["error"] = GoogleAuthError("Synthetic provider failure")
        expected = "google_failed"
    assert callback_query(google_callback(client, state, **query))["auth_error"] == expected
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM oauth_flows").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM google_pending").fetchone()[0] == 0
    calls = len(google_exchange["calls"])
    restore_google_browser(client, browser)
    assert callback_query(google_callback(client, state))["auth_error"] == "google_expired"
    assert len(google_exchange["calls"]) == calls


def test_expired_google_flow_and_pending_registration_create_no_store(
    pg_client, google_exchange
):
    client, _business, dsn = pg_client
    sign_out_owner(client)
    state, _browser, _query = start_google(client)
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "UPDATE oauth_flows SET created_at=now()-interval '20 minutes', "
            "expires_at=now()-interval '1 minute'"
        )
    assert callback_query(google_callback(client, state))["auth_error"] == "google_expired"
    assert google_exchange["calls"] == []
    state, _browser, _query = start_google(client)
    assert callback_query(google_callback(client, state))["auth"] == "google-register"
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "UPDATE google_pending SET created_at=now()-interval '20 minutes', "
            "expires_at=now()-interval '1 minute'"
        )
    assert client.get("/api/v1/auth/google/pending").json()["data"] is None
    rejected = client.post(
        "/api/v1/auth/google/complete",
        json={"businessName": "Expired Test Store", "dataOrigin": "demo"},
    )
    assert rejected.status_code == 401
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT count(*) FROM businesses").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM google_identities").fetchone()[0] == 0


def test_quality_snapshot_precedence_warning_and_deletion_staleness(pg_client):
    client,business,_=pg_client
    product=create_product(client,business)
    base=f"/api/v1/businesses/{business}"
    for index in range(5):
        day=f"2026-01-0{index+1}"
        assert client.post(base+"/sales",json={"productId":product["id"],"saleDate":day,"quantity":"2"},headers={"Idempotency-Key":f"quality-sale-{index}"}).status_code==201
    assert client.put(base+"/data-quality",json={"classificationDate":"2026-01-02","classification":"business_closed","productId":None}).status_code==200
    assert client.put(base+"/data-quality",json={"classificationDate":"2026-01-02","classification":"confirmed_zero","productId":product["id"]}).status_code==200
    run=client.post(base+"/forecast-runs",json={"trainingStart":"2026-01-01","trainingEnd":"2026-01-03","validationStart":"2026-01-04","validationEnd":"2026-01-04","finalTestStart":"2026-01-05","finalTestEnd":"2026-01-05","forecastHorizonDays":7})
    assert run.status_code==202,run.text
    snapshot=run.json()["data"]["dataSnapshot"]["preparedProducts"][product["id"]]
    target=next(item for item in snapshot["targets"] if item["day"]=="2026-01-02")
    assert target["quantity"]==2 and target["provenance"]=="recorded_sales"
    assert snapshot["warnings"][0]["code"]=="confirmed_zero_with_sales"
    from app import worker
    assert worker.run_once()
    assert not client.get(base+"/forecast-dashboard").json()["data"]["stale"]
    deleted=client.request("DELETE",base+"/data-quality",json={"classificationDate":"2026-01-02","productId":product["id"]})
    assert deleted.status_code==200
    dashboard=client.get(base+"/forecast-dashboard").json()["data"]
    assert dashboard["stale"] and dashboard["run"] is not None


def test_account_recovery_invitation_and_tenant_permissions(pg_client,monkeypatch):
    client,business,_=pg_client
    sent=[]
    monkeypatch.setattr("app.auth_routes.Mailer.send",lambda _self,to,subject,text: sent.append((to,subject,text)))
    recovery=client.post("/api/v1/auth/password/recovery",json={"email":"owner@example.com","businessId":business})
    assert recovery.status_code==200 and sent
    token=sent[-1][2].split("?reset=")[1].split()[0]
    assert client.post("/api/v1/auth/password/recovery/complete",json={"token":token,"newPassword":"replacement-password-123"}).status_code==200
    assert client.post("/api/v1/auth/password/recovery/complete",json={"token":token,"newPassword":"another-password-123"}).status_code==400
    # Sign back in after recovery invalidated every owner session.
    signed=client.post("/api/v1/auth/sign-in",json={"businessId":business,"email":"owner@example.com","password":"replacement-password-123"})
    assert signed.status_code==200; client.headers["X-CSRF-Token"]=client.cookies["stockcast_csrf"]
    invitation=client.post("/api/v1/auth/staff/invitations",json={"email":"synthetic.staff@example.invalid","displayName":"Synthetic Staff"})
    assert invitation.status_code==201,invitation.text
    invite_token=sent[-1][2].split("?invitation=")[1].split()[0]
    accepted=client.post("/api/v1/auth/staff/invitations/accept",json={"token":invite_token,"password":"synthetic-staff-password"})
    assert accepted.status_code==201 and accepted.json()["data"]["role"]=="staff"
    assert client.post("/api/v1/auth/staff/invitations/accept",json={"token":invite_token,"password":"synthetic-staff-password"}).status_code==400
    client.headers["X-CSRF-Token"]=client.cookies["stockcast_csrf"]
    assert client.post("/api/v1/auth/staff/invitations",json={"email":"other@example.invalid","displayName":"Other"}).status_code==403
