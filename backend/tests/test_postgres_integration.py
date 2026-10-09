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


def test_inventory_count_only_preserves_latest_details_and_audits_stock(pg_client):
    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    # Simulate details edited after the browser prepared its preview.
    edit = client.patch(base + f"/products/{product['id']}", json={
        "name": "Updated name", "category": "Updated category", "unitCost": "12.1250",
        "safetyStock": "2.125", "leadTimeDays": 5,
    })
    assert edit.status_code == 200, edit.text
    before = edit.json()["data"]
    response = client.post(base + "/inventory-imports", json={
        "rows": [{"sku": "TEST-1", "currentStock": "11.125"}],
    })
    assert response.status_code == 201, response.text
    assert response.json()["data"] == {"created": 0, "updated": 1}
    saved = client.get(base + "/products").json()["data"][0]
    for field in ["id", "sku", "name", "category", "unit", "unitCost", "safetyStock", "leadTimeDays"]:
        assert saved[field] == before[field]
    assert float(saved["currentStock"]) == 11.125
    movements = client.get(base + "/inventory-movements").json()["data"]
    assert any(row["movementType"] == "adjustment" and float(row["quantityDelta"]) == -8.875
               for row in movements)


def test_inventory_incomplete_new_sku_rolls_back_all_counts(pg_client):
    client, business, _dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    before_movements = client.get(base + "/inventory-movements").json()["data"]
    response = client.post(base + "/inventory-imports", json={"rows": [
        {"sku": "TEST-1", "currentStock": "2"},
        {"sku": "NEW", "currentStock": "3"},
    ]})
    assert response.status_code == 422, response.text
    assert "New SKU" in response.text
    saved = client.get(base + "/products").json()["data"]
    assert len(saved) == 1
    assert float(saved[0]["currentStock"]) == 20
    assert client.get(base + "/inventory-movements").json()["data"] == before_movements


def test_inventory_partial_metadata_and_full_new_product_are_compatible(pg_client):
    client, business, _dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    response = client.post(base + "/inventory-imports", json={"rows": [
        {"sku": "TEST-1", "currentStock": "12", "name": "Imported name"},
        {"sku": "NEW", "currentStock": "3", "name": "New product", "category": "Test",
         "unit": "pc", "leadTimeDays": 1, "safetyStock": "0", "unitCost": "1.25"},
    ]})
    assert response.status_code == 201, response.text
    assert response.json()["data"] == {"created": 1, "updated": 1}
    saved = {row["sku"]: row for row in client.get(base + "/products").json()["data"]}
    assert saved["TEST-1"]["name"] == "Imported name"
    assert float(saved["TEST-1"]["unitCost"]) == 10
    assert float(saved["NEW"]["currentStock"]) == 3
    assert client.post(f"/api/v1/businesses/{uuid4()}/inventory-imports", json={
        "rows": [{"sku": "TEST-1", "currentStock": "0"}],
    }).status_code == 403


def test_inventory_exact_skus_precede_folded_matches_and_ambiguity_rolls_back(pg_client):
    client, business, _dsn = pg_client
    first = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    for sku in ["test-1", "OTHER"]:
        created = client.post(base + "/products", json={
            "sku": sku, "name": f"Synthetic {sku}", "category": "Test", "unit": "pc",
            "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
        })
        assert created.status_code == 201, created.text
    before = {row["sku"]: row for row in client.get(base + "/products").json()["data"]}
    for sku, count in [(" TEST-1 ", "11"), ("test-1", "12")]:
        response = client.post(base + "/inventory-imports", json={"rows": [
            {"sku": sku, "currentStock": count},
        ]})
        assert response.status_code == 201, response.text
        assert response.json()["data"] == {"created": 0, "updated": 1}
    folded = client.post(base + "/inventory-imports", json={"rows": [
        {"sku": "oThEr", "currentStock": "13"},
    ]})
    assert folded.status_code == 201, folded.text
    assert folded.json()["data"] == {"created": 0, "updated": 1}
    saved = {row["sku"]: row for row in client.get(base + "/products").json()["data"]}
    assert saved["TEST-1"]["id"] == first["id"]
    assert saved["test-1"]["id"] == before["test-1"]["id"]
    assert float(saved["TEST-1"]["currentStock"]) == 11
    assert float(saved["test-1"]["currentStock"]) == 12
    assert saved["oThEr"]["id"] == before["OTHER"]["id"]
    assert float(saved["oThEr"]["currentStock"]) == 13
    movements_before = client.get(base + "/inventory-movements").json()["data"]
    rejected = client.post(base + "/inventory-imports", json={"rows": [
        {"sku": "OTHER", "currentStock": "1"},
        {"sku": "TeSt-1", "currentStock": "0"},
    ]})
    assert rejected.status_code == 422, rejected.text
    assert "matches multiple products" in rejected.json()["detail"]
    assert {row["sku"]: row for row in client.get(base + "/products").json()["data"]} == saved
    assert client.get(base + "/inventory-movements").json()["data"] == movements_before



def test_sales_cursor_preserves_ties_legacy_offsets_and_business_scope(pg_client):
    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    response = client.post(base + "/data-imports", json={"rows": [
        {"sku": "TEST-1", "saleDate": "2026-09-29" if i < 4 else "2026-09-30",
         "quantity": "1.125", "sourceRecordKey": f"cursor:{i}"}
        for i in range(12)
    ]})
    assert response.status_code == 201, response.text
    expected = client.get(base + "/sales?limit=1000").json()["data"]
    assert len(expected) == 12
    gathered = []
    cursor = {}
    while True:
        page = client.get(base + "/sales", params={"limit": 3, **cursor})
        assert page.status_code == 200, page.text
        rows = page.json()["data"]
        gathered.extend(rows)
        if len(rows) < 3:
            break
        cursor = {"beforeDate": rows[-1]["saleDate"], "beforeId": rows[-1]["id"]}
    assert gathered == expected
    assert len({row["id"] for row in gathered}) == 12
    assert client.get(base + "/sales?limit=3&offset=3").json()["data"] == expected[3:6]
    assert float(client.get(base + "/products").json()["data"][0]["currentStock"]) == float(product["currentStock"])
    other = str(uuid4())
    assert client.get(f"/api/v1/businesses/{other}/sales", params={"limit": 1000, **cursor}).status_code == 403


def test_sales_cursor_rejects_partial_markers_mixed_offsets_and_oversized_pages(pg_client):
    client, business, _dsn = pg_client
    path = f"/api/v1/businesses/{business}/sales"
    for query in [
        {"beforeDate": "2026-09-30"},
        {"beforeId": str(uuid4())},
        {"beforeDate": "2026-09-30", "beforeId": str(uuid4()), "offset": 1},
        {"beforeDate": "2026-02-30", "beforeId": str(uuid4())},
        {"beforeDate": "2026-09-30", "beforeId": "invalid"},
        {"limit": 1001},
    ]:
        assert client.get(path, params=query).status_code == 422


def test_sales_cursor_does_not_repeat_rows_when_a_newer_sale_arrives(pg_client):
    client, business, _dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    response = client.post(base + "/data-imports", json={"rows": [
        {"sku": "TEST-1", "saleDate": "2026-09-29", "quantity": "1", "sourceRecordKey": f"before:{i}"}
        for i in range(5)
    ]})
    assert response.status_code == 201, response.text
    original = client.get(base + "/sales?limit=1000").json()["data"]
    first = original[:2]
    response = client.post(base + "/data-imports", json={"rows": [
        {"sku": "TEST-1", "saleDate": "2026-09-30", "quantity": "1", "sourceRecordKey": "newer"}
    ]})
    assert response.status_code == 201, response.text
    following = client.get(base + "/sales", params={"limit": 1000, "beforeDate": first[-1]["saleDate"], "beforeId": first[-1]["id"]}).json()["data"]
    assert first + following == original

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
    assert not dashboard.json()["data"]["recommendations"][0]["demandAvailable"]
    assert dashboard.json()["data"]["predictions"] == []


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
    invitation=client.post("/api/v1/auth/staff/invitations",json={"email":"synthetic.staff@example.com","displayName":"Synthetic Staff"})
    assert invitation.status_code==201,invitation.text
    invite_token=sent[-1][2].split("?invitation=")[1].split()[0]
    accepted=client.post("/api/v1/auth/staff/invitations/accept",json={"token":invite_token,"password":"synthetic-staff-password"})
    assert accepted.status_code==201 and accepted.json()["data"]["role"]=="staff"
    assert client.post("/api/v1/auth/staff/invitations/accept",json={"token":invite_token,"password":"synthetic-staff-password"}).status_code==400
    client.headers["X-CSRF-Token"]=client.cookies["stockcast_csrf"]
    assert client.post("/api/v1/auth/staff/invitations",json={"email":"other@example.com","displayName":"Other"}).status_code==403


def test_password_change_revokes_previously_issued_recovery_links(pg_client, monkeypatch):
    client, business, _dsn = pg_client
    sent = []
    monkeypatch.setattr(
        "app.auth_routes.Mailer.send",
        lambda _self, _to, _subject, text: sent.append(text),
    )
    response = client.post(
        "/api/v1/auth/password/recovery",
        json={"email": "owner@example.com", "businessId": business},
    )
    assert response.status_code == 200
    token = sent[-1].split("?reset=")[1].split()[0]
    changed = client.post(
        "/api/v1/auth/password/change",
        json={"currentPassword": "test-owner-password", "newPassword": "new-owner-password"},
    )
    assert changed.status_code == 200, changed.text
    assert client.get("/api/v1/auth/me").status_code == 401
    reused = client.post(
        "/api/v1/auth/password/recovery/complete",
        json={"token": token, "newPassword": "old-link-replacement-password"},
    )
    assert reused.status_code == 400
    signed_in = client.post(
        "/api/v1/auth/sign-in",
        json={"email": "owner@example.com", "password": "new-owner-password"},
    )
    assert signed_in.status_code == 200


def test_failed_password_change_keeps_valid_recovery_link(pg_client):
    from app.auth_repository import AuthRepository

    client, business, dsn = pg_client
    token = "synthetic-recovery-after-wrong-current-password"
    with psycopg.connect(dsn) as conn:
        assert AuthRepository(conn).create_reset("owner@example.com", token)
    changed = client.post(
        "/api/v1/auth/password/change",
        json={"currentPassword": "incorrect-password", "newPassword": "new-owner-password"},
    )
    assert changed.status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 200
    reset = client.post(
        "/api/v1/auth/password/recovery/complete",
        json={"token": token, "newPassword": "recovered-owner-password"},
    )
    assert reset.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post(
        "/api/v1/auth/sign-in",
        json={"businessId": business, "email": "owner@example.com", "password": "recovered-owner-password"},
    ).status_code == 200


def test_recovery_revokes_other_previously_outstanding_links(pg_client):
    from app.security import token_hash

    client, _business, dsn = pg_client
    tokens = ["synthetic-older-outstanding-reset", "synthetic-selected-outstanding-reset"]
    with psycopg.connect(dsn) as conn:
        user_id = conn.execute("SELECT id FROM users WHERE email='owner@example.com'").fetchone()[0]
        for token in tokens:
            # Older concurrent recovery requests could leave more than one active
            # token. Completing either one must retire every outstanding link.
            conn.execute(
                "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) "
                "VALUES(%s,%s,now()+interval '30 minutes')",
                (user_id, token_hash(token)),
            )
    assert client.post(
        "/api/v1/auth/password/recovery/complete",
        json={"token": tokens[1], "newPassword": "recovered-owner-password"},
    ).status_code == 200
    assert client.post(
        "/api/v1/auth/password/recovery/complete",
        json={"token": tokens[0], "newPassword": "stale-link-replacement-password"},
    ).status_code == 400
    assert client.post(
        "/api/v1/auth/sign-in",
        json={"email": "owner@example.com", "password": "recovered-owner-password"},
    ).status_code == 200


def test_concurrent_recovery_requests_leave_one_active_link(pg_client):
    from concurrent.futures import ThreadPoolExecutor
    from queue import Queue
    from threading import Event
    from time import monotonic
    from app.auth_repository import AuthRepository
    from app.security import token_hash

    _client, _business, dsn = pg_client
    started = Queue()
    tokens = ["synthetic-first-concurrent-reset", "synthetic-second-concurrent-reset"]

    def request_second():
        with psycopg.connect(dsn) as conn:
            started.put(conn.info.backend_pid)
            return AuthRepository(conn).create_reset("owner@example.com", tokens[1])

    with ThreadPoolExecutor(max_workers=1) as executor:
        with psycopg.connect(dsn) as conn:
            with conn.transaction():
                assert AuthRepository(conn).create_reset("owner@example.com", tokens[0])
                future = executor.submit(request_second)
                waiter_pid = started.get(timeout=10)
                deadline = monotonic() + 10
                pause = Event()
                with psycopg.connect(dsn, autocommit=True) as observer:
                    while True:
                        blockers = observer.execute(
                            "SELECT pg_blocking_pids(%s)", (waiter_pid,),
                        ).fetchone()[0]
                        if conn.info.backend_pid in blockers:
                            break
                        if future.done():
                            future.result()
                            raise AssertionError("Concurrent recovery bypassed the account lock")
                        assert monotonic() < deadline, "Concurrent recovery did not wait"
                        pause.wait(0.01)
        assert future.result(timeout=10)
    with psycopg.connect(dsn) as conn:
        active = conn.execute(
            "SELECT token_hash FROM password_reset_tokens WHERE consumed_at IS NULL",
        ).fetchall()
    assert active == [(token_hash(tokens[1]),)]


@pytest.mark.parametrize("inactive", ["user", "business"])
def test_recovery_cannot_change_an_inactive_account(pg_client, inactive):
    from app.auth_repository import AuthRepository
    from app.security import verify_password

    client, business, dsn = pg_client
    token = "synthetic-recovery-before-account-disabled"
    with psycopg.connect(dsn) as conn:
        repository = AuthRepository(conn)
        assert repository.create_reset("owner@example.com", token)
        if inactive == "user":
            conn.execute("UPDATE users SET is_active=false WHERE business_id=%s", (business,))
        else:
            conn.execute("UPDATE businesses SET is_active=false WHERE id=%s", (business,))
        assert not repository.create_reset("owner@example.com", "synthetic-recovery-after-disabled")
    response = client.post(
        "/api/v1/auth/password/recovery/complete",
        json={"token": token, "newPassword": "inactive-replacement-password"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Reset link is invalid or expired"
    with psycopg.connect(dsn) as conn:
        stored = conn.execute("SELECT password_hash FROM users WHERE business_id=%s", (business,)).fetchone()[0]
    assert verify_password("test-owner-password", stored)


@pytest.mark.parametrize("legacy_snapshot", [False, True])
def test_worker_preserves_frozen_exclusions_after_live_classification_deletion(
    pg_client, legacy_snapshot
):
    client, business, dsn = pg_client
    product = create_product(client, business, stock="100")
    base = f"/api/v1/businesses/{business}"
    for index, quantity in enumerate([2, 2, 50, 2, 2], start=1):
        response = client.post(
            base + "/sales",
            json={
                "productId": product["id"],
                "saleDate": f"2026-01-0{index}",
                "quantity": str(quantity),
            },
            headers={"Idempotency-Key": f"frozen-quality-sale-{index}"},
        )
        assert response.status_code == 201, response.text
    classification = {"classificationDate": "2026-01-03", "productId": product["id"]}
    response = client.put(
        base + "/data-quality", json={**classification, "classification": "partial_stockout"}
    )
    assert response.status_code == 200, response.text
    response = client.post(
        base + "/forecast-runs",
        json={
            "trainingStart": "2026-01-01",
            "trainingEnd": "2026-01-03",
            "validationStart": "2026-01-04",
            "validationEnd": "2026-01-04",
            "finalTestStart": "2026-01-05",
            "finalTestEnd": "2026-01-05",
            "forecastHorizonDays": 7,
        },
    )
    assert response.status_code == 202, response.text
    queued = response.json()["data"]
    assert queued["dataSnapshot"]["preparedProducts"][product["id"]]["excludedDates"] == [
        "2026-01-03"
    ]
    if legacy_snapshot:
        with psycopg.connect(dsn) as conn:
            conn.execute(
                "UPDATE forecast_runs SET data_snapshot=data_snapshot - 'preparedProducts' "
                "- 'preparationPolicyVersion' WHERE id=%s",
                (queued["id"],),
            )
    deleted = client.request("DELETE", base + "/data-quality", json=classification)
    assert deleted.status_code == 200, deleted.text
    from app import worker

    assert worker.run_once()
    completed = client.get(base + f"/forecast-runs/{queued['id']}").json()["data"]
    assert completed["status"] == "completed", completed["failureMessage"]
    summary = completed["configuration"]["products"][product["id"]]
    assert summary["historyDays"] == 2
    assert summary["excludedDays"] == 1
    assert completed["configuration"]["preparationSource"] == (
        "prepared_from_legacy_snapshot" if legacy_snapshot else "frozen_prepared_snapshot"
    )
    predictions = client.get(base + f"/forecast-runs/{queued['id']}/predictions").json()["data"]
    future = [point for point in predictions if point["datasetSplit"] == "future"]
    assert len(future) == 7
    assert all(float(point["predictedQuantity"]) == 2 for point in future)
    assert client.get(base + "/forecast-dashboard").json()["data"]["stale"]


def test_dashboard_baseline_preserves_empty_unknown_and_excluded_history(pg_client, monkeypatch):
    from datetime import date
    from app.repository import Repository

    monkeypatch.setattr(Repository, "business_day", lambda *_: date(2026, 1, 4))
    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"

    def read_dashboard():
        response = client.get(base + "/forecast-dashboard")
        assert response.status_code == 200, response.text
        return response.json()["data"]

    empty = read_dashboard()
    assert empty["predictions"] == []
    assert not empty["recommendations"][0]["demandAvailable"]
    for day, quantity in [("2026-01-01", "2"), ("2026-01-03", "6")]:
        response = client.post(
            base + "/sales",
            json={"productId": product["id"], "saleDate": day, "quantity": quantity},
            headers={"Idempotency-Key": f"baseline-sale-{day}"},
        )
        assert response.status_code == 201, response.text
    sparse = read_dashboard()
    assert sparse["summaries"][product["id"]]["unknownDays"] == 2
    assert all(float(point["predictedQuantity"]) == 6 for point in sparse["predictions"])
    assert sparse["recommendations"][0]["demandAvailable"]
    assert client.put(
        base + "/data-quality",
        json={"classificationDate": "2026-01-03", "classification": "incomplete"},
    ).status_code == 200
    excluded = read_dashboard()
    # Excluding the latest sale leaves an older valid cutoff; its original
    # forecast dates are still inside the configured horizon on January 4.
    assert excluded["asOf"] == "2026-01-01"
    assert all(float(point["predictedQuantity"]) == 2 for point in excluded["predictions"])
    assert all(point["predictionDate"] >= "2026-01-04" for point in excluded["predictions"])
    assert excluded["recommendations"][0]["demandAvailable"]
    assert excluded["summaries"][product["id"]]["excludedDays"] == 1


def test_rule_recommendations_regenerate_with_reviewed_day_policy(pg_client):
    client, business, _dsn = pg_client
    product = create_product(client, business, stock="100")
    base = f"/api/v1/businesses/{business}"
    for day, quantity in [("2026-01-01", "10"), ("2026-01-03", "6")]:
        response = client.post(
            base + "/sales",
            json={"productId": product["id"], "saleDate": day, "quantity": quantity},
            headers={"Idempotency-Key": f"reviewed-rule-sale-{day}"},
        )
        assert response.status_code == 201, response.text
    payload = {"recommendationDate": "2026-01-03", "lookbackDays": 7}

    def generate():
        response = client.post(base + "/reorder-recommendations/generate", json=payload)
        assert response.status_code == 201, response.text
        return response.json()["data"]

    sparse = generate()
    assert float(sparse[0]["forecastDailyDemand"]) == 6
    assert sparse[0]["calculationVersion"] == "rule-v2-reviewed-days"
    response = client.put(
        base + "/data-quality",
        json={"classificationDate": "2026-01-02", "classification": "confirmed_zero"},
    )
    assert response.status_code == 200, response.text
    assert float(generate()[0]["forecastDailyDemand"]) == pytest.approx(5.333)
    response = client.put(
        base + "/data-quality",
        json={"classificationDate": "2026-01-03", "classification": "partial_stockout"},
    )
    assert response.status_code == 200, response.text
    assert generate() == []
    assert client.get(base + "/reorder-recommendations").json()["data"] == []
    response = client.put(
        base + "/data-quality",
        json={
            "classificationDate": "2026-01-03",
            "classification": "confirmed_zero",
            "productId": product["id"],
        },
    )
    assert response.status_code == 200, response.text
    assert float(generate()[0]["forecastDailyDemand"]) == pytest.approx(5.333)


def test_dashboard_expiration_uses_business_day_and_preserves_archived_predictions(
    pg_client, monkeypatch
):
    from datetime import date
    from app.repository import Repository

    client, business, _dsn = pg_client
    product = create_product(client, business, stock="100")
    base = f"/api/v1/businesses/{business}"
    for index in range(1, 6):
        assert client.post(
            base + "/sales",
            json={
                "productId": product["id"],
                "saleDate": f"2026-01-0{index}",
                "quantity": "2",
            },
            headers={"Idempotency-Key": f"expiry-sale-{index}"},
        ).status_code == 201
    response = client.post(
        base + "/forecast-runs",
        json={
            "trainingStart": "2026-01-01",
            "trainingEnd": "2026-01-03",
            "validationStart": "2026-01-04",
            "validationEnd": "2026-01-04",
            "finalTestStart": "2026-01-05",
            "finalTestEnd": "2026-01-05",
            "forecastHorizonDays": 7,
        },
    )
    assert response.status_code == 202, response.text
    run_id = response.json()["data"]["id"]
    from app import worker

    assert worker.run_once()
    monkeypatch.setattr(Repository, "business_day", lambda *_: date(2026, 1, 12))
    final_day = client.get(base + "/forecast-dashboard").json()["data"]
    assert not final_day["expired"]
    assert final_day["recommendations"][0]["demandAvailable"]
    assert {point["predictionDate"] for point in final_day["predictions"]
            if point["datasetSplit"] == "future"} == {"2026-01-12"}
    monkeypatch.setattr(Repository, "business_day", lambda *_: date(2026, 1, 13))
    expired = client.get(base + "/forecast-dashboard").json()["data"]
    assert expired["expired"] and not expired["stale"]
    assert expired["forecastThrough"] == "2026-01-12"
    advice = expired["recommendations"][0]
    assert advice["forecastExpired"] and not advice["demandAvailable"]
    assert advice["daily_demand"] is None and advice["suggested_quantity"] == "0"
    assert not any(point["datasetSplit"] == "future" for point in expired["predictions"])
    archived = client.get(base + f"/forecast-runs/{run_id}/predictions").json()["data"]
    assert len([point for point in archived if point["datasetSplit"] == "future"]) == 7


def test_forecast_snapshot_uses_database_clock_for_classification_staleness(pg_client, monkeypatch):
    from datetime import UTC, datetime, timedelta
    from app import repository as repository_module

    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    classification = {"classificationDate": "2026-01-03", "productId": product["id"]}
    assert client.put(
        base + "/data-quality", json={**classification, "classification": "confirmed_zero"}
    ).status_code == 200

    class AheadClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(tz) + timedelta(days=2)

    monkeypatch.setattr(repository_module, "datetime", AheadClock)
    response = client.post(
        base + "/forecast-runs",
        json={
            "trainingStart": "2026-01-01", "trainingEnd": "2026-01-03",
            "validationStart": "2026-01-04", "validationEnd": "2026-01-04",
            "finalTestStart": "2026-01-05", "finalTestEnd": "2026-01-05",
            "forecastHorizonDays": 7,
        },
    )
    assert response.status_code == 202, response.text
    queued = response.json()["data"]
    captured = datetime.fromisoformat(queued["dataSnapshot"]["capturedAt"])
    assert abs(captured - datetime.now(UTC)) < timedelta(seconds=30)
    assert client.request("DELETE", base + "/data-quality", json=classification).status_code == 200
    from app import worker

    assert worker.run_once()
    dashboard = client.get(base + "/forecast-dashboard").json()["data"]
    assert dashboard["stale"]


def test_worker_uses_frozen_nondefault_forecast_settings(pg_client):
    from datetime import date, timedelta
    from app import worker

    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    start = date(2025, 1, 1)
    imported = client.post(
        base + "/data-imports",
        json={
            "source": "csv",
            "rows": [
                {
                    "sku": product["sku"],
                    "saleDate": str(start + timedelta(days=i)),
                    "quantity": str(12 + i % 7),
                }
                for i in range(160)
            ],
        },
    )
    assert imported.status_code == 201, imported.text
    current = client.get(base + "/settings").json()["data"]
    configured = {
        **current,
        "minimumNonzeroDays": 110,
        "timezone": "America/New_York",
        "cvFolds": 4,
    }
    saved = client.put(base + "/settings", json=configured)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["minimumNonzeroDays"] == 110
    assert saved.json()["data"]["timezone"] == "America/New_York"
    assert saved.json()["data"]["cvFolds"] == 4
    queued = client.post(
        base + "/forecast-runs",
        json={
            "trainingStart": str(start),
            "trainingEnd": str(start + timedelta(days=119)),
            "validationStart": str(start + timedelta(days=120)),
            "validationEnd": str(start + timedelta(days=139)),
            "finalTestStart": str(start + timedelta(days=140)),
            "finalTestEnd": str(start + timedelta(days=159)),
            "forecastHorizonDays": 7,
        },
    )
    assert queued.status_code == 202, queued.text
    run = queued.json()["data"]
    assert run["dataSnapshot"]["settings"]["cv_folds"] == 4
    # Live edits must not replace the settings captured for the queued run.
    changed = client.put(
        base + "/settings", json={**configured, "cvFolds": 2, "minimumNonzeroDays": 500}
    )
    assert changed.status_code == 200, changed.text
    assert worker.run_once()
    completed = client.get(base + f"/forecast-runs/{run['id']}").json()["data"]
    assert completed["status"] == "completed", completed["failureMessage"]
    configuration = completed["configuration"]
    assert configuration["cvFolds"] == 4
    assert configuration["cvValidationDays"] == 14
    summary = configuration["products"][product["id"]]
    assert summary["eligible"]
    assert summary["requestedFolds"] == summary["effectiveFolds"] == 4
    assert summary["selectionFallback"] is None
    assert client.get(base + "/settings").json()["data"]["cvFolds"] == 2



def test_sales_import_keys_deduplicate_overlaps_conflicts_and_reordered_batches(pg_client):
    client, business, dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    first_rows = [
        {"sku": "TEST-1", "saleDate": "2026-01-01", "quantity": "2", "sourceRecordKey": "sale-1"},
        {"sku": "TEST-1", "saleDate": "2026-01-02", "quantity": "3", "sourceRecordKey": "sale-2"},
    ]
    first = client.post(base + "/data-imports", json={"source": "csv", "rows": first_rows})
    assert first.status_code == 201, first.text
    assert first.json()["data"]["acceptedRows"] == 2
    reordered = [
        {**first_rows[1], "sku": " TEST-1 ", "quantity": "3.000"},
        {**first_rows[0], "sku": "TEST-1", "quantity": "2.0"},
    ]
    repeated = client.post(base + "/data-imports", json={"source": "csv", "rows": reordered})
    assert repeated.status_code == 409, repeated.text
    overlap = client.post(base + "/data-imports", json={
        "source": "pos_export",
        "rows": [
            *reordered,
            {"sku": "TEST-1", "saleDate": "2026-01-03", "quantity": "4", "sourceRecordKey": "sale-3"},
        ],
    })
    assert overlap.status_code == 201, overlap.text
    summary = overlap.json()["data"]
    assert (summary["acceptedRows"], summary["rejectedRows"]) == (1, 2)
    assert summary["errors"] == [
        {"row": 1, "code": "duplicate_source_record_key"},
        {"row": 2, "code": "duplicate_source_record_key"},
    ]
    second_product = client.post(base + "/products", json={
        "sku": "TEST-2", "name": "Other Product", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    })
    assert second_product.status_code == 201, second_product.text
    conflicts = client.post(base + "/data-imports", json={
        "source": "spreadsheet", "rows": [
            {**first_rows[0], "quantity": "5"},
            {**first_rows[1], "saleDate": "2026-01-05"},
            {**first_rows[0], "sku": "TEST-2"},
        ],
    })
    assert conflicts.status_code == 201, conflicts.text
    assert conflicts.json()["data"]["acceptedRows"] == 0
    assert conflicts.json()["data"]["errors"] == [
        {"row": index, "code": "source_record_key_conflict"} for index in range(1, 4)
    ]
    sales = client.get(base + "/sales").json()["data"]
    assert len(sales) == 3
    assert sorted(float(sale["quantity"]) for sale in sales) == [2, 3, 4]
    products = client.get(base + "/products").json()["data"]
    assert all(float(item["currentStock"]) == 20 for item in products)
    assert len(client.get(base + "/inventory-movements").json()["data"]) == 2
    with psycopg.connect(dsn) as conn:
        keys = conn.execute(
            "SELECT source_record_key FROM sales WHERE business_id=%s ORDER BY source_record_key",
            (business,),
        ).fetchall()
    assert keys == [("sale-1",), ("sale-2",), ("sale-3",)]
    assert product["id"] == sales[0]["productId"]


def test_sales_import_preserves_distinct_identical_sales_and_within_batch_diagnostics(pg_client):
    client, business, _dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    sale = {"sku": "TEST-1", "saleDate": "2026-01-01", "quantity": "2"}
    response = client.post(base + "/data-imports", json={"rows": [
        {**sale, "sourceRecordKey": " sale-1 \t"},
        {**sale, "sourceRecordKey": "sale-1", "quantity": "2.000"},
        {**sale, "sourceRecordKey": "sale-1", "quantity": "3"},
        {**sale, "sourceRecordKey": "sale-2"},
        {**sale, "sourceRecordKey": " \t"}, sale,
    ]})
    assert response.status_code == 201, response.text
    result = response.json()["data"]
    assert (result["totalRows"], result["acceptedRows"], result["rejectedRows"]) == (6, 4, 2)
    assert result["errors"] == [
        {"row": 2, "code": "duplicate_source_record_key"},
        {"row": 3, "code": "source_record_key_conflict"},
    ]
    assert len(client.get(base + "/sales").json()["data"]) == 4
    assert float(client.get(base + "/products").json()["data"][0]["currentStock"]) == 20


def test_historical_sales_import_preserves_inactive_product_and_live_sale_guard(pg_client):
    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    deactivated = client.patch(base + f"/products/{product['id']}", json={"isActive": False})
    assert deactivated.status_code == 200, deactivated.text
    before = client.get(base + "/products").json()["data"][0]
    movements_before = client.get(base + "/inventory-movements").json()["data"]
    data = {"rows": [
        {"sku": "TEST-1", "saleDate": "2026-01-01", "quantity": "2",
         "sourceRecordKey": "inactive-history-1"},
        {"sku": "test-1", "saleDate": "2026-01-02", "quantity": "3",
         "sourceRecordKey": "inactive-history-2"},
    ]}

    imported = client.post(base + "/data-imports", json=data)
    assert imported.status_code == 201, imported.text
    result = imported.json()["data"]
    assert (result["acceptedRows"], result["rejectedRows"]) == (2, 0)
    sales = client.get(base + "/sales").json()["data"]
    assert len(sales) == 2
    assert all(sale["productId"] == product["id"] for sale in sales)
    assert client.get(base + "/products").json()["data"][0] == before
    assert before["isActive"] is False
    assert float(before["currentStock"]) == 20
    assert client.get(base + "/inventory-movements").json()["data"] == movements_before

    live_sale = client.post(base + "/sales", json={
        "productId": product["id"], "saleDate": "2026-01-03", "quantity": "1",
    })
    assert live_sale.status_code == 404, live_sale.text
    assert len(client.get(base + "/sales").json()["data"]) == 2
    assert client.get(base + "/products").json()["data"][0] == before
    retry = client.post(base + "/data-imports", json=data)
    assert retry.status_code == 409, retry.text


def test_sales_import_source_keys_are_tenant_scoped(pg_client):
    client, business, dsn = pg_client
    create_product(client, business)
    rows = [{
        "sku": "TEST-1", "saleDate": "2026-01-01", "quantity": "2", "sourceRecordKey": "shared-sale",
    }]
    first = client.post(f"/api/v1/businesses/{business}/data-imports", json={"rows": rows})
    assert first.status_code == 201, first.text
    signed_up = signup_owner(client)
    other_business = signed_up.json()["data"]["businessId"]
    create_product(client, other_business)
    second = client.post(f"/api/v1/businesses/{other_business}/data-imports", json={"rows": rows})
    assert second.status_code == 201, second.text
    assert second.json()["data"]["acceptedRows"] == 1
    with psycopg.connect(dsn) as conn:
        counts = conn.execute(
            "SELECT business_id,count(*) FROM sales WHERE source_record_key=%s GROUP BY business_id",
            ("shared-sale",),
        ).fetchall()
    assert {str(tenant): count for tenant, count in counts} == {business: 1, other_business: 1}


def test_keyed_partial_sales_import_can_retry_after_catalog_correction(pg_client):
    client, business, _dsn = pg_client
    create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    data = {"rows": [
        {"sku": "TEST-1", "saleDate": "2026-01-01", "quantity": "2", "sourceRecordKey": "sale-1"},
        {"sku": "LATER", "saleDate": "2026-01-02", "quantity": "3", "sourceRecordKey": "sale-2"},
    ]}
    first = client.post(base + "/data-imports", json=data)
    assert first.status_code == 201, first.text
    assert first.json()["data"]["errors"] == [{"row": 2, "code": "unknown_sku", "sku": "LATER"}]
    created = client.post(base + "/products", json={
        "sku": "LATER", "name": "Later Product", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    })
    assert created.status_code == 201, created.text
    retried = client.post(base + "/data-imports", json=data)
    assert retried.status_code == 201, retried.text
    result = retried.json()["data"]
    assert (result["acceptedRows"], result["rejectedRows"]) == (1, 1)
    assert result["errors"] == [{"row": 1, "code": "duplicate_source_record_key"}]
    assert len(client.get(base + "/sales").json()["data"]) == 2
    assert all(float(product["currentStock"]) == 20 for product in client.get(base + "/products").json()["data"])


def test_concurrent_overlapping_sales_imports_write_each_source_key_once(pg_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from app.repository import Repository
    from app.schemas import SalesImportCreate
    from app.security import Principal

    client, business, dsn = pg_client
    create_product(client, business)
    with psycopg.connect(dsn) as conn:
        user_id = conn.execute(
            "SELECT id FROM users WHERE business_id=%s AND role='owner'", (business,),
        ).fetchone()[0]
    user = Principal(str(user_id), business, "owner@example.com", "Owner", "owner")
    barrier = Barrier(2)

    def submit(unique_key):
        with psycopg.connect(dsn) as conn:
            repository = Repository(conn)
            data = SalesImportCreate(rows=[
                {"sku": "TEST-1", "saleDate": "2026-01-01", "quantity": "2", "sourceRecordKey": "shared-sale"},
                {"sku": "TEST-1", "saleDate": "2026-01-02", "quantity": "3", "sourceRecordKey": unique_key},
            ])
            barrier.wait(timeout=10)
            return repository.create_sales_import(user, data)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(submit, key) for key in ["sale-a", "sale-b"]]
        results = [future.result(timeout=20) for future in futures]
    assert sorted((result["acceptedRows"], result["rejectedRows"]) for result in results) == [(1, 1), (2, 0)]
    with psycopg.connect(dsn) as conn:
        keys = conn.execute(
            "SELECT source_record_key,count(*) FROM sales WHERE business_id=%s GROUP BY source_record_key",
            (business,),
        ).fetchall()
    assert dict(keys) == {"shared-sale": 1, "sale-a": 1, "sale-b": 1}



def test_sales_import_case_distinct_exact_skus_remain_separate_and_folded_match_is_ambiguous(pg_client):
    client, business, dsn = pg_client
    first_product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    created = client.post(base + "/products", json={
        "sku": "test-1", "name": "Case Distinct Product", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    })
    assert created.status_code == 201, created.text
    second_product = created.json()["data"]
    sale = {"saleDate": "2026-01-01", "quantity": "2"}
    batches = []
    for sku in [" TEST-1 ", "test-1"]:
        response = client.post(base + "/data-imports", json={"rows": [{**sale, "sku": sku}]})
        assert response.status_code == 201, response.text
        batches.append(response.json()["data"])
    assert batches[0]["contentSha256"] != batches[1]["contentSha256"]
    assert all(batch["acceptedRows"] == 1 for batch in batches)
    ambiguous = client.post(base + "/data-imports", json={"rows": [{**sale, "sku": "TeSt-1"}]})
    assert ambiguous.status_code == 201, ambiguous.text
    result = ambiguous.json()["data"]
    assert (result["acceptedRows"], result["rejectedRows"]) == (0, 1)
    assert result["errors"] == [{"row": 1, "code": "ambiguous_sku", "sku": "TeSt-1"}]
    with psycopg.connect(dsn) as conn:
        quantities = conn.execute(
            "SELECT product_id,sum(quantity) FROM sales WHERE business_id=%s GROUP BY product_id",
            (business,),
        ).fetchall()
    assert {str(product): float(quantity) for product, quantity in quantities} == {
        first_product["id"]: 2, second_product["id"]: 2,
    }
    assert all(float(product["currentStock"]) == 20 for product in client.get(base + "/products").json()["data"])



@pytest.mark.parametrize("scope", ["store-wide", "product"])
@pytest.mark.parametrize("following_operation", ["update", "delete"])
def test_concurrent_classification_audit_keeps_prior_revision_and_clock_order(
    pg_client, scope, following_operation
):
    from concurrent.futures import ThreadPoolExecutor
    from datetime import date, datetime
    from queue import Queue
    from threading import Event
    from time import monotonic
    from uuid import UUID
    from app.repository import Repository
    from app.schemas import DataQualityDelete, DataQualityUpsert
    from app.security import Principal

    client, business, dsn = pg_client
    product = create_product(client, business)
    product_id = UUID(product["id"]) if scope == "product" else None
    day = date(2026, 1, 1)
    with psycopg.connect(dsn) as conn:
        user_id = conn.execute(
            "SELECT id FROM users WHERE business_id=%s AND role='owner'", (business,),
        ).fetchone()[0]
    user = Principal(str(user_id), business, "owner@example.com", "Owner", "owner")
    started = Queue()
    attempt_mutation = Event()

    def following_mutation():
        with psycopg.connect(dsn) as conn:
            with conn.transaction():
                # Begin this transaction before the first revision, reproducing
                # the old now() timestamp being earlier despite a later mutation.
                transaction_started = conn.execute("SELECT now()").fetchone()[0]
                started.put((conn.info.backend_pid, transaction_started))
                assert attempt_mutation.wait(timeout=10)
                repository = Repository(conn)
                if following_operation == "delete":
                    return repository.delete_data_quality(user, DataQualityDelete(
                        product_id=product_id, classification_date=day,
                    ))
                return repository.upsert_data_quality(user, DataQualityUpsert(
                    product_id=product_id, classification_date=day,
                    classification="business_closed", note="Second review",
                ))

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(following_mutation)
        waiter_pid, transaction_started = started.get(timeout=10)
        with psycopg.connect(dsn) as conn:
            repository = Repository(conn)
            with conn.transaction():
                first = repository.upsert_data_quality(user, DataQualityUpsert(
                    product_id=product_id, classification_date=day,
                    classification="confirmed_zero", note="First review",
                ))
                # Keep the newly created row uncommitted while the other writer
                # attempts the same key. An absent-row SELECT alone cannot lock it.
                attempt_mutation.set()
                deadline = monotonic() + 10
                pause = Event()
                with psycopg.connect(dsn, autocommit=True) as observer:
                    while True:
                        blockers = observer.execute(
                            "SELECT pg_blocking_pids(%s)", (waiter_pid,),
                        ).fetchone()[0]
                        if conn.info.backend_pid in blockers:
                            break
                        if future.done():
                            future.result()
                            raise AssertionError("Concurrent writer bypassed the pending classification revision")
                        assert monotonic() < deadline, "Concurrent classification writer did not wait"
                        pause.wait(0.01)
        following = future.result(timeout=10)

    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        audits = conn.execute(
            """SELECT quality_id,previous_classification,classification,previous_note,note,
                      action,changed_at FROM sales_day_quality_audit
               WHERE business_id=%s AND product_id IS NOT DISTINCT FROM %s
                 AND classification_date=%s ORDER BY id""",
            (business, product_id, day),
        ).fetchall()
        current = conn.execute(
            """SELECT classification,note,created_at,updated_at FROM sales_day_quality
               WHERE business_id=%s AND product_id IS NOT DISTINCT FROM %s
                 AND classification_date=%s""",
            (business, product_id, day),
        ).fetchone()
    assert len(audits) == 2
    assert [audit["action"] for audit in audits] == [
        "created", "deleted" if following_operation == "delete" else "updated",
    ]
    assert [audit["previous_classification"] for audit in audits] == [None, "confirmed_zero"]
    assert [audit["previous_note"] for audit in audits] == [None, "First review"]
    assert audits[0]["classification"] == "confirmed_zero"
    assert audits[0]["note"] == "First review"
    assert str(audits[0]["quality_id"]) == str(audits[1]["quality_id"]) == first["id"]
    assert transaction_started <= audits[0]["changed_at"] < audits[1]["changed_at"]
    assert datetime.fromisoformat(first["createdAt"]) == audits[0]["changed_at"]
    assert datetime.fromisoformat(first["updatedAt"]) == audits[0]["changed_at"]
    if following_operation == "delete":
        assert following == {"deleted": True}
        assert current is None
        assert audits[1]["classification"] is None
        assert audits[1]["note"] is None
    else:
        assert following["id"] == first["id"]
        assert following["classification"] == current["classification"] == "business_closed"
        assert current["created_at"] == audits[0]["changed_at"]
        assert current["updated_at"] == audits[1]["changed_at"]
        assert datetime.fromisoformat(following["updatedAt"]) == audits[1]["changed_at"]
        assert audits[1]["classification"] == "business_closed"
        assert audits[1]["note"] == current["note"] == "Second review"


def test_members_frontend_reads_and_owner_management_stay_tenant_scoped(pg_client):
    from app.auth_repository import AuthRepository
    from app.security import Principal, hash_password

    client, business, dsn = pg_client
    client.headers.pop("X-CSRF-Token")
    owner_csrf = client.cookies["stockcast_csrf"]
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        other_business = conn.execute(
            "INSERT INTO businesses(name,data_origin) VALUES('Synthetic Other Store','demo') "
            "RETURNING id"
        ).fetchone()["id"]
        members = []
        for tenant, email, role in [
            (business, "local.staff@example.test", "staff"),
            (other_business, "other.owner@example.test", "owner"),
            (other_business, "other.staff@example.test", "staff"),
        ]:
            members.append(conn.execute(
                """INSERT INTO users(business_id,email,display_name,role,password_hash)
                   VALUES(%s,%s,'Synthetic Member',%s,%s) RETURNING *""",
                (tenant, email, role, hash_password("synthetic-members-password")),
            ).fetchone())
        local_staff, other_owner, other_staff = members
        repository = AuthRepository(conn)
        staff_session, staff_csrf, _ = repository.issue_session(
            Principal(str(local_staff["id"]), business, local_staff["email"], "Staff", "staff"), 12,
        )
        other_session, other_csrf, _ = repository.issue_session(
            Principal(str(other_owner["id"]), str(other_business), other_owner["email"], "Owner", "owner"), 12,
        )

    # The frontend sends cookies on GET, with no custom CSRF or Origin header.
    response = client.get("/api/v1/auth/members")
    assert response.status_code == 200, response.text
    assert "X-CSRF-Token" not in response.request.headers
    listed = response.json()["data"]
    assert len(listed) == 2
    assert {row["email"] for row in listed} == {"owner@example.com", local_staff["email"]}
    assert {str(other_owner["id"]), str(other_staff["id"])}.isdisjoint(
        row["id"] for row in listed
    )
    assert client.get(
        f"/api/v1/auth/members?businessId={other_business}"
    ).json()["data"] == listed

    local_path = f"/api/v1/auth/members/{local_staff['id']}"
    assert client.patch(local_path, json={"isActive": False}).status_code == 403
    write_headers = {"X-CSRF-Token": owner_csrf}
    disabled = client.patch(local_path, json={"isActive": False}, headers=write_headers)
    assert disabled.status_code == 200
    assert disabled.json()["data"] == {"id": str(local_staff["id"]), "isActive": False}
    assert client.get(
        "/api/v1/auth/me",
        headers={"Cookie": f"stockcast_session={staff_session}; stockcast_csrf={staff_csrf}"},
    ).status_code == 401
    restored = client.patch(local_path, json={"isActive": True}, headers=write_headers)
    assert restored.status_code == 200
    assert restored.json()["data"]["isActive"] is True
    local_member = next(row for row in client.get("/api/v1/auth/members").json()["data"]
                        if row["id"] == str(local_staff["id"]))
    assert local_member["isActive"] is True

    foreign_path = f"/api/v1/auth/members/{other_staff['id']}"
    assert client.patch(foreign_path, json={"isActive": False}, headers=write_headers).status_code == 404
    foreign_list = client.get(
        "/api/v1/auth/members",
        headers={"Cookie": f"stockcast_session={other_session}; stockcast_csrf={other_csrf}"},
    )
    assert foreign_list.status_code == 200
    assert {row["id"] for row in foreign_list.json()["data"]} == {
        str(other_owner["id"]), str(other_staff["id"]),
    }
    assert all(row["isActive"] for row in foreign_list.json()["data"])

    # Reactivation requires a new staff session: disabling removed the old one.
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        staff_session, staff_csrf, _ = AuthRepository(conn).issue_session(
            Principal(str(local_staff["id"]), business, local_staff["email"], "Staff", "staff"), 12,
        )
    staff_headers = {"Cookie": f"stockcast_session={staff_session}; stockcast_csrf={staff_csrf}"}
    assert client.get("/api/v1/auth/members", headers=staff_headers).status_code == 403
    assert client.patch(
        local_path,
        json={"isActive": False},
        headers={**staff_headers, "X-CSRF-Token": staff_csrf},
    ).status_code == 403
    assert client.patch(
        foreign_path,
        json={"isActive": False},
        headers={**staff_headers, "X-CSRF-Token": staff_csrf},
    ).status_code == 403
