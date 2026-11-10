"""Account access history against disposable, synthetic PostgreSQL schemas."""

import base64
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from app.auth_repository import AuthRepository
from app.security import Principal, hash_password, token_hash
from test_postgres_integration import (  # noqa: F401
    callback_query,
    fresh_auth_limiter,
    google_callback,
    google_exchange,
    pg_client,
    sign_out_owner,
    signup_owner,
    start_google,
)


PATH = "/api/v1/auth/activity"


def activity(client, **params):
    response = client.get(PATH, params=params)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()["data"]


def saved_events(dsn):
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT * FROM account_activity_events ORDER BY occurred_at,id"
        ).fetchall()


def owner_principal(dsn, business):
    with psycopg.connect(dsn) as conn:
        repository = AuthRepository(conn)
        row = conn.execute(
            "SELECT * FROM users WHERE business_id=%s AND role='owner'", (business,)
        ).fetchone()
        return repository._principal(row)


def staff_session(dsn, business, email="staff@example.test", name="Synthetic Staff"):
    with psycopg.connect(dsn) as conn:
        repository = AuthRepository(conn)
        row = conn.execute(
            """INSERT INTO users(business_id,email,display_name,role,password_hash)
               VALUES(%s,%s,%s,'staff',%s) RETURNING *""",
            (business, email, name, hash_password("synthetic-staff-password")),
        ).fetchone()
        return repository.issue_session(repository._principal(row), 12)


def insert_events(dsn, user, specs):
    """Insert controlled timestamps/identity snapshots for read-contract fixtures."""
    with psycopg.connect(dsn) as conn:
        for spec in specs:
            conn.execute(
                """INSERT INTO account_activity_events
                   (id,business_id,user_id,display_name,email,role,event,occurred_at)
                   VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    spec.get("id", uuid4()), user.business_id, user.user_id,
                    spec.get("name", user.display_name), spec.get("email", user.email),
                    user.role, spec.get("event", "signed_in"), spec["at"],
                ),
            )


def all_pages(client, **params):
    rows = []
    cursor = None
    while True:
        page = activity(client, **params, **({"before": cursor} if cursor else {}))
        rows.extend(page["events"])
        cursor = page["nextCursor"]
        if cursor is None:
            return rows
        assert len(rows) < 1000, "Activity pagination did not terminate"


def test_password_sign_in_records_once_and_read_contract_contains_no_secrets(pg_client):
    client, business, dsn = pg_client
    principal = client.get("/api/v1/auth/me").json()["data"]
    events = activity(client)["events"]
    assert len(events) == 1
    event = events[0]
    assert set(event) == {
        "id", "businessId", "userId", "displayName", "email", "role", "event", "occurredAt",
    }
    assert {key: event[key] for key in principal} == principal
    assert event["businessId"] == business
    assert event["event"] == "signed_in"
    recorded = datetime.fromisoformat(event["occurredAt"])
    assert recorded.utcoffset() == timedelta(0)
    assert abs(datetime.now(UTC) - recorded) < timedelta(minutes=1)
    activity(client)
    assert len(saved_events(dsn)) == 1, "Reading activity must not create another sign-in"
    with psycopg.connect(dsn) as conn:
        columns = conn.execute(
            """SELECT column_name FROM information_schema.columns
               WHERE table_schema=current_schema() AND table_name='account_activity_events'"""
        ).fetchall()
    assert {column[0] for column in columns} == {
        "id", "business_id", "user_id", "display_name", "email", "role", "event", "occurred_at",
    }
    raw = json.dumps(events)
    assert client.cookies["stockcast_session"] not in raw
    assert client.cookies["stockcast_csrf"] not in raw


def test_failed_credentials_do_not_create_account_activity(pg_client):
    client, business, dsn = pg_client
    before = saved_events(dsn)
    response = client.post("/api/v1/auth/sign-in", json={
        "businessId": business, "email": "owner@example.com", "password": "wrong-password",
    })
    assert response.status_code == 401
    assert saved_events(dsn) == before


def test_explicit_sign_out_is_csrf_protected_durable_and_not_duplicated(pg_client):
    client, _business, dsn = pg_client
    raw = client.cookies["stockcast_session"]
    csrf = client.headers.pop("X-CSRF-Token")
    assert client.post("/api/v1/auth/sign-out").status_code == 403
    assert len(saved_events(dsn)) == 1
    response = client.post("/api/v1/auth/sign-out", headers={"X-CSRF-Token": csrf})
    assert response.status_code == 200, response.text
    with psycopg.connect(dsn) as conn:
        assert conn.execute(
            "SELECT count(*) FROM sessions WHERE token_hash=%s", (token_hash(raw),)
        ).fetchone()[0] == 0
        AuthRepository(conn).sign_out(raw)
    events = saved_events(dsn)
    assert [event["event"] for event in events] == ["signed_in", "signed_out"]
    for field in ["user_id", "business_id", "display_name", "email", "role"]:
        assert events[0][field] == events[1][field]
    assert client.post("/api/v1/auth/sign-out").status_code == 401
    assert saved_events(dsn) == events


def test_concurrent_sign_out_writes_one_event_for_the_removed_session(pg_client):
    client, _business, dsn = pg_client
    raw = client.cookies["stockcast_session"]
    barrier = Barrier(2)

    def sign_out():
        with psycopg.connect(dsn) as conn:
            repository = AuthRepository(conn)
            barrier.wait(timeout=10)
            repository.sign_out(raw)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(sign_out) for _ in range(2)]
        for future in futures:
            future.result(timeout=15)
    assert [row["event"] for row in saved_events(dsn)] == ["signed_in", "signed_out"]


@pytest.mark.parametrize("operation", ["sign_in", "sign_out"])
def test_session_and_event_changes_roll_back_together_on_event_failure(
    pg_client, monkeypatch, operation
):
    client, business, dsn = pg_client
    user = owner_principal(dsn, business)
    original = AuthRepository._record_account_activity

    def record_then_fail(repository, principal, event):
        original(repository, principal, event)
        raise RuntimeError("Synthetic event-write failure")

    before = saved_events(dsn)
    with psycopg.connect(dsn, autocommit=True) as conn:
        repository = AuthRepository(conn)
        sessions_before = conn.execute("SELECT * FROM sessions ORDER BY id").fetchall()
        monkeypatch.setattr(AuthRepository, "_record_account_activity", record_then_fail)
        with pytest.raises(RuntimeError, match="Synthetic event-write failure"):
            if operation == "sign_in":
                repository.issue_session(user, 12)
            else:
                repository.sign_out(client.cookies["stockcast_session"])
        assert conn.execute("SELECT * FROM sessions ORDER BY id").fetchall() == sessions_before
    assert saved_events(dsn) == before


@pytest.mark.parametrize("operation", ["expiration", "password_change", "deactivation"])
def test_session_expiration_and_forced_revocation_are_not_explicit_sign_outs(pg_client, operation):
    client, business, dsn = pg_client
    if operation == "deactivation":
        raw, _csrf, staff = staff_session(dsn, business)
        response = client.patch(f"/api/v1/auth/members/{staff.user_id}", json={"isActive": False})
        assert response.status_code == 200, response.text
        assert client.get(PATH, headers={"Cookie": f"stockcast_session={raw}"}).status_code == 401
    else:
        with psycopg.connect(dsn) as conn:
            if operation == "expiration":
                conn.execute(
                    "UPDATE sessions SET created_at=now()-interval '13 hours', "
                    "expires_at=now()-interval '1 second'"
                )
            else:
                AuthRepository(conn).change_password(
                    owner_principal(dsn, business), "test-owner-password", "new-owner-password",
                )
        assert client.get(PATH).status_code == 401
    assert all(row["event"] == "signed_in" for row in saved_events(dsn))


def test_owner_reads_only_their_business_and_staff_cannot_read_activity(pg_client):
    client, business, dsn = pg_client
    owner_cookie = client.cookies["stockcast_session"]
    _staff_cookie, _csrf, staff = staff_session(dsn, business)
    other = signup_owner(client).json()["data"]
    other_page = activity(client)
    assert {event["businessId"] for event in other_page["events"]} == {other["businessId"]}
    # A client-supplied tenant selector cannot change authenticated owner scope.
    local = client.get(PATH, params={"businessId": other["businessId"]}, headers={
        "Cookie": f"stockcast_session={owner_cookie}",
    })
    assert local.status_code == 200, local.text
    local_events = local.json()["data"]["events"]
    assert {event["businessId"] for event in local_events} == {business}
    assert staff.user_id in {event["userId"] for event in local_events}
    with psycopg.connect(dsn) as conn:
        raw, _csrf, _user = AuthRepository(conn).issue_session(staff, 12)
    assert client.get(PATH, headers={"Cookie": f"stockcast_session={raw}"}).status_code == 403
    assert client.get(PATH, headers={"Cookie": ""}).status_code == 401


def test_saved_identity_survives_profile_changes_and_deactivation(pg_client):
    client, business, dsn = pg_client
    raw, _csrf, staff = staff_session(dsn, business, name="Original Staff")
    with psycopg.connect(dsn) as conn:
        conn.execute(
            "UPDATE users SET display_name='Renamed Staff',email='renamed@example.test' WHERE id=%s",
            (staff.user_id,),
        )
        AuthRepository(conn).sign_out(raw)
    assert client.patch(
        f"/api/v1/auth/members/{staff.user_id}", json={"isActive": False},
    ).status_code == 200
    history = [event for event in activity(client)["events"] if event["userId"] == staff.user_id]
    assert [(row["event"], row["displayName"], row["email"], row["role"]) for row in history] == [
        ("signed_out", "Renamed Staff", "renamed@example.test", "staff"),
        ("signed_in", "Original Staff", "staff@example.test", "staff"),
    ]


def test_keyset_pages_keep_timestamp_ties_and_exclude_newer_insertions(pg_client):
    client, business, dsn = pg_client
    user = owner_principal(dsn, business)
    at = datetime(2026, 1, 1, tzinfo=UTC)
    insert_events(dsn, user, [{"id": UUID(int=i), "at": at} for i in range(1, 8)])
    expected = activity(client, limit=100)["events"]
    first = activity(client, limit=2)
    insert_events(dsn, user, [{"at": datetime.now(UTC) + timedelta(minutes=1)}])
    gathered = first["events"]
    cursor = first["nextCursor"]
    while cursor:
        page = activity(client, limit=2, before=cursor)
        gathered.extend(page["events"])
        cursor = page["nextCursor"]
    assert gathered == expected
    tied = [row["id"] for row in gathered if datetime.fromisoformat(row["occurredAt"]) == at]
    assert tied == [str(UUID(int=i)) for i in range(7, 0, -1)]
    assert len({row["id"] for row in gathered}) == len(gathered)
    # A valid cursor from one store still cannot expose that store to another owner.
    signup_owner(client)
    foreign_page = activity(client, before=first["nextCursor"])
    assert foreign_page == {"events": [], "nextCursor": None}


def test_actor_and_event_filters_search_full_history_before_pagination(pg_client):
    client, business, dsn = pg_client
    user = owner_principal(dsn, business)
    at = datetime(2026, 1, 1, tzinfo=UTC)
    insert_events(dsn, user, [
        {"name": "Unrelated Actor", "email": "unrelated@example.test", "at": at + timedelta(days=1)}
        for _ in range(65)
    ] + [
        {"name": "Needle Actor", "email": "saved@example.test", "event": "signed_in", "at": at},
        {"name": "Changed Name", "email": "needle@example.test", "event": "signed_out", "at": at},
        {"name": "Needle Actor", "email": "saved@example.test", "event": "signed_in", "at": at},
        {"name": "Literal %_\\ Actor", "email": "literal@example.test", "at": at},
    ])
    matching = all_pages(client, limit=1, search="  nEeDlE  ")
    assert len(matching) == 3
    assert {row["event"] for row in matching} == {"signed_in", "signed_out"}
    assert len(all_pages(client, limit=1, search="needle", event="signed_in")) == 2
    assert len(all_pages(client, limit=1, search="needle", event="signed_out")) == 1
    for literal in ["%", "_", "\\", "%_\\"]:
        rows = all_pages(client, limit=1, search=literal)
        assert len(rows) == 1
        assert rows[0]["displayName"] == "Literal %_\\ Actor"
    assert len(all_pages(client, limit=100, search="   ")) == 70


def encoded_cursor(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


@pytest.mark.parametrize("params", [
    {"limit": 0}, {"limit": 101}, {"limit": "1.5"}, {"limit": "many"},
    {"event": "expired"}, {"search": "x" * 161}, {"before": "not a cursor"},
    {"before": encoded_cursor([])},
    {"before": encoded_cursor({"occurredAt": "2026-01-01T00:00:00", "id": str(uuid4())})},
    {"before": encoded_cursor({"occurredAt": "not a timestamp", "id": str(uuid4())})},
    {"before": encoded_cursor({"occurredAt": "2026-01-01T00:00:00+00:00", "id": "bad"})},
    {"before": encoded_cursor({"occurredAt": 123, "id": str(uuid4())})},
])
def test_activity_rejects_invalid_read_filters_without_writing(pg_client, params):
    client, _business, dsn = pg_client
    before = saved_events(dsn)
    response = client.get(PATH, params=params)
    assert response.status_code == 422, response.text
    assert saved_events(dsn) == before


def test_events_use_wall_clock_and_return_utc_independently_of_database_timezone(pg_client):
    client, business, dsn = pg_client
    user = owner_principal(dsn, business)
    with psycopg.connect(dsn) as conn:
        conn.execute("SET TIME ZONE 'Pacific/Auckland'")
        conn.execute("UPDATE business_settings SET timezone='Pacific/Honolulu' WHERE business_id=%s", (business,))
        started = conn.execute("SELECT now()").fetchone()[0]
        conn.execute("SELECT pg_sleep(0.01)")
        AuthRepository(conn).issue_session(user, 12)
    latest = activity(client)["events"][0]
    timestamp = datetime.fromisoformat(latest["occurredAt"])
    assert timestamp.utcoffset() == timedelta(0)
    assert timestamp > started


def test_reapplying_migrations_does_not_fabricate_activity_for_existing_sessions(pg_client):
    from app.migrate import migrate

    client, _business, dsn = pg_client
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM account_activity_events")
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 1
    migrate()
    assert activity(client) == {"events": [], "nextCursor": None}
    assert saved_events(dsn) == []


def test_password_signup_and_invitation_acceptance_record_the_new_account(pg_client):
    client, _business, dsn = pg_client
    signup = signup_owner(client).json()["data"]
    assert [event["event"] for event in activity(client)["events"]] == ["signed_in"]
    assert activity(client)["events"][0]["userId"] == signup["userId"]
    raw = "synthetic-invitation-token-for-account-history"
    owner = owner_principal(dsn, signup["businessId"])
    with psycopg.connect(dsn) as conn:
        AuthRepository(conn).create_invitation(owner, "invited@example.test", "Invited Staff", raw)
    accepted = client.post("/api/v1/auth/staff/invitations/accept", json={
        "token": raw, "password": "invited-staff-password",
    })
    assert accepted.status_code == 201, accepted.text
    member = accepted.json()["data"]
    events = [event for event in saved_events(dsn) if str(event["user_id"]) == member["userId"]]
    assert len(events) == 1
    assert (events[0]["event"], events[0]["role"], events[0]["display_name"]) == (
        "signed_in", "staff", "Invited Staff",
    )


def test_google_link_refresh_is_not_a_sign_in_but_known_google_login_is(pg_client, google_exchange):
    client, _business, dsn = pg_client
    before = saved_events(dsn)
    state, _browser, _query = start_google(client, "link")
    assert callback_query(google_callback(client, state))["auth"] == "google-linked"
    assert saved_events(dsn) == before
    sign_out_owner(client)
    state, _browser, _query = start_google(client)
    assert callback_query(google_callback(client, state))["auth"] == "google"
    assert [row["event"] for row in saved_events(dsn)] == ["signed_in", "signed_out", "signed_in"]


def test_google_store_registration_records_only_after_completion(pg_client, google_exchange):
    client, old_business, dsn = pg_client
    sign_out_owner(client)
    before = saved_events(dsn)
    state, _browser, _query = start_google(client)
    assert callback_query(google_callback(client, state))["auth"] == "google-register"
    assert saved_events(dsn) == before
    completed = client.post("/api/v1/auth/google/complete", json={
        "businessName": "Synthetic Google Store", "dataOrigin": "demo",
    })
    assert completed.status_code == 201, completed.text
    user = completed.json()["data"]
    assert user["businessId"] != old_business
    rows = activity(client)["events"]
    assert len(rows) == 1
    assert rows[0]["event"] == "signed_in"
    assert rows[0]["userId"] == user["userId"]


@pytest.mark.parametrize("failure", ["denied", "exchange"])
def test_failed_google_flow_does_not_create_account_activity(pg_client, google_exchange, failure):
    from app.google_auth import GoogleAuthError

    client, _business, dsn = pg_client
    before = saved_events(dsn)
    state, _browser, _query = start_google(client)
    query = {"error": "access_denied"} if failure == "denied" else {}
    if failure == "exchange":
        google_exchange["error"] = GoogleAuthError("Synthetic provider failure")
    assert "auth_error" in callback_query(google_callback(client, state, **query))
    assert saved_events(dsn) == before
