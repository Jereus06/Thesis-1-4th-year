"""Auth-route request headers without PostgreSQL or external mail delivery."""

from unittest.mock import MagicMock
from uuid import UUID

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import auth_routes
from app.auth_repository import AuthRepository
from app.config import Settings, get_settings
from app.security import Principal, token_hash


OWNER = Principal(
    user_id="00000000-0000-4000-8000-000000000002",
    business_id="00000000-0000-4000-8000-000000000001",
    email="owner@example.test",
    display_name="Test Owner",
    role="owner",
)
STAFF_ID = "00000000-0000-4000-8000-000000000003"
SESSION = "synthetic-owner-session"
CSRF = "synthetic-csrf-token"


@pytest.fixture()
def members_client(monkeypatch):
    repository = MagicMock(spec=AuthRepository)
    repository.authenticate.return_value = (OWNER, token_hash(CSRF))
    repository.list_members.return_value = [
        {"id": STAFF_ID, "email": "staff@example.test", "displayName": "Test Staff",
         "role": "staff", "isActive": True},
    ]
    config = Settings(
        _env_file=None,
        database_url="postgresql://tester:tester@localhost:5432/test_stockcast",
        cors_origin="http://localhost:5173",
    )
    app = FastAPI()
    app.include_router(auth_routes.create_auth_router(lambda: repository))
    app.dependency_overrides[get_settings] = lambda: config
    monkeypatch.setattr(auth_routes, "limiter", auth_routes.AuthLimiter())
    with TestClient(app) as client:
        client.cookies.set("stockcast_session", SESSION)
        client.cookies.set("stockcast_csrf", CSRF)
        yield client, repository, config


@pytest.mark.parametrize("csrf_cookie", [True, False])
def test_members_read_matches_frontend_headers_and_needs_no_csrf_header(
    members_client, csrf_cookie
):
    client, repository, _config = members_client
    if not csrf_cookie:
        client.cookies.delete("stockcast_csrf")
    response = client.get("/api/v1/auth/members")
    assert "X-CSRF-Token" not in response.request.headers
    assert "Origin" not in response.request.headers
    assert response.status_code == 200
    assert response.json()["data"] == repository.list_members.return_value
    repository.authenticate.assert_called_once_with(SESSION)
    repository.list_members.assert_called_once_with(OWNER)


@pytest.mark.parametrize("session", ["missing", "invalid"])
def test_members_read_still_requires_an_authenticated_session(members_client, session):
    client, repository, _config = members_client
    if session == "missing":
        client.cookies.delete("stockcast_session")
    else:
        repository.authenticate.side_effect = HTTPException(401, "Session expired")
    assert client.get("/api/v1/auth/members").status_code == 401
    repository.list_members.assert_not_called()


@pytest.mark.parametrize("failure", ["no-header", "no-cookie", "mismatch", "wrong-hash", "no-hash"])
@pytest.mark.parametrize(
    ("method", "path", "payload", "repository_method"),
    [
        ("PATCH", f"/api/v1/auth/members/{STAFF_ID}", {"isActive": False}, "set_staff_active"),
        ("POST", "/api/v1/auth/password/change",
         {"currentPassword": "synthetic-current-password", "newPassword": "synthetic-new-password"},
         "change_password"),
        ("POST", "/api/v1/auth/staff/invitations",
         {"email": "synthetic.staff@example.com", "displayName": "Test Staff"}, "create_invitation"),
    ],
)
def test_state_changing_account_requests_keep_csrf_protection(
    members_client, failure, method, path, payload, repository_method
):
    client, repository, config = members_client
    headers = {"Origin": config.cors_origin, "X-CSRF-Token": CSRF}
    if failure == "no-header":
        del headers["X-CSRF-Token"]
    elif failure == "no-cookie":
        client.cookies.delete("stockcast_csrf")
    elif failure == "mismatch":
        headers["X-CSRF-Token"] = "different-synthetic-token"
    elif failure == "wrong-hash":
        repository.authenticate.return_value = (OWNER, token_hash("different-synthetic-token"))
    else:
        repository.authenticate.return_value = (OWNER, None)
    response = client.request(method, path, json=payload, headers=headers)
    assert response.status_code == 403
    assert response.json() == {"detail": "CSRF token is missing or invalid"}
    getattr(repository, repository_method).assert_not_called()


@pytest.mark.parametrize("active", [False, True])
def test_member_status_uses_authenticated_owner_with_valid_write_headers(members_client, active):
    client, repository, config = members_client
    repository.set_staff_active.return_value = {"id": STAFF_ID, "isActive": active}
    response = client.patch(
        f"/api/v1/auth/members/{STAFF_ID}",
        json={"isActive": active},
        headers={"Origin": config.cors_origin, "X-CSRF-Token": CSRF},
    )
    assert response.status_code == 200
    assert response.json()["data"] == {"id": STAFF_ID, "isActive": active}
    repository.set_staff_active.assert_called_once_with(OWNER, UUID(STAFF_ID), active)


def test_member_write_rejects_foreign_origin_even_with_valid_csrf(members_client):
    client, repository, _config = members_client
    response = client.patch(
        f"/api/v1/auth/members/{STAFF_ID}",
        json={"isActive": False},
        headers={"Origin": "https://foreign.example.test", "X-CSRF-Token": CSRF},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "This request must come from the StockCast website"}
    repository.authenticate.assert_not_called()
    repository.set_staff_active.assert_not_called()
