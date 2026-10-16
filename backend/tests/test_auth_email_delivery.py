"""Account email response contracts without PostgreSQL or real SMTP delivery."""

import logging
import smtplib
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import auth_routes
from app.config import Settings, get_settings
from app.security import Principal, token_hash


@pytest.fixture()
def auth_client(monkeypatch):
    repository = MagicMock()
    config = Settings(
        _env_file=None,
        database_url="postgresql://tester:tester@localhost:5432/test_stockcast",
        cors_origin="http://localhost:5173",
        public_app_url="http://localhost:5173",
        smtp_host="smtp.test",
        smtp_from="noreply@test.invalid",
        smtp_username="smtp-user",
        smtp_password="smtp-password",
    )
    app = FastAPI()
    app.include_router(auth_routes.create_auth_router(lambda: repository))
    app.dependency_overrides[get_settings] = lambda: config
    monkeypatch.setattr(auth_routes, "limiter", auth_routes.AuthLimiter())
    with TestClient(app) as client:
        client.headers["Origin"] = config.cors_origin
        yield client, repository, config


@pytest.mark.parametrize("delivery", ["unconfigured", "smtp-rejected", "network-failure", "success"])
def test_recovery_response_is_account_neutral_when_email_delivery_fails(
    auth_client, caplog, delivery
):
    client, repository, config = auth_client
    repository.create_reset.side_effect = [True, False]
    smtp_client = MagicMock()
    smtp_context = MagicMock()
    smtp_context.__enter__.return_value = smtp_client
    if delivery == "unconfigured":
        config.smtp_host = ""
    elif delivery == "smtp-rejected":
        smtp_client.send_message.side_effect = smtplib.SMTPRecipientsRefused(
            {"existing@example.com": (550, b"private provider diagnostics")}
        )
    elif delivery == "network-failure":
        smtp_client.send_message.side_effect = TimeoutError("private network diagnostics")

    caplog.set_level(logging.WARNING, logger=auth_routes.__name__)
    with patch("app.mailer.smtplib.SMTP", return_value=smtp_context) as smtp:
        responses = [
            client.post("/api/v1/auth/password/recovery", json={"email": email})
            for email in ["existing@example.com", "nonexistent@example.com"]
        ]

    assert [(response.status_code, response.json()) for response in responses] == [
        (200, {"data": {"accepted": True}}),
        (200, {"data": {"accepted": True}}),
    ]
    assert [call.args[0] for call in repository.create_reset.call_args_list] == [
        "existing@example.com",
        "nonexistent@example.com",
    ]
    if delivery == "unconfigured":
        smtp.assert_not_called()
    else:
        smtp.assert_called_once_with("smtp.test", 587, timeout=10)
        smtp_client.send_message.assert_called_once()
    warnings = [record for record in caplog.records if record.name == auth_routes.__name__]
    if delivery == "success":
        assert not warnings
    else:
        assert [record.getMessage() for record in warnings] == [
            "Password recovery email delivery unavailable"
        ]
        assert not warnings[0].exc_info
        assert "existing@example.com" not in caplog.text
        assert repository.create_reset.call_args_list[0].args[1] not in caplog.text
        assert "private" not in caplog.text


@pytest.mark.parametrize("failure", ["smtp-rejected", "network-failure"])
def test_invitation_transport_failure_uses_generic_service_unavailable(auth_client, failure):
    client, repository, _config = auth_client
    owner = Principal(
        user_id="00000000-0000-4000-8000-000000000002",
        business_id="00000000-0000-4000-8000-000000000001",
        email="owner@example.com",
        display_name="Owner",
        role="owner",
    )
    repository.authenticate.return_value = (owner, token_hash("csrf-token"))
    client.cookies.set("stockcast_session", "existing-session")
    client.cookies.set("stockcast_csrf", "csrf-token")
    client.headers["X-CSRF-Token"] = "csrf-token"
    smtp_client = MagicMock()
    smtp_context = MagicMock()
    smtp_context.__enter__.return_value = smtp_client
    if failure == "smtp-rejected":
        smtp_client.send_message.side_effect = smtplib.SMTPRecipientsRefused(
            {"staff@example.com": (550, b"private provider diagnostics")}
        )
    else:
        smtp_client.send_message.side_effect = ConnectionResetError("private network diagnostics")

    with patch("app.mailer.smtplib.SMTP", return_value=smtp_context):
        response = client.post(
            "/api/v1/auth/staff/invitations",
            json={"email": "staff@example.com", "displayName": "Staff"},
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "Email delivery is temporarily unavailable"}
    repository.create_invitation.assert_called_once()
    assert repository.create_invitation.call_args.args[:3] == (owner, "staff@example.com", "Staff")
