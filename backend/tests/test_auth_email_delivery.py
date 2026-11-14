"""Account email response contracts without PostgreSQL or real SMTP delivery."""

import logging
import smtplib
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import auth_routes
from app.config import Settings, get_settings
from app.mailer import Mailer, MailUnavailable
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
    recovery_token = "synthetic-single-use-recovery-token"
    repository.create_store_resets.side_effect = [
        [{"businessName": "Synthetic Store", "token": recovery_token}], []
    ]
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
    assert [call.args[0] for call in repository.create_store_resets.call_args_list] == [
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
        assert recovery_token not in caplog.text
        assert "private" not in caplog.text


@pytest.mark.parametrize("failure", ["smtp-rejected", "network-failure"])
def test_invitation_transport_failure_shows_safe_actionable_error(auth_client, failure):
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
    expected = (
        "The email server rejected this address. Check the recipient email."
        if failure == "smtp-rejected"
        else "Email could not be sent. Please try again later."
    )
    assert response.json() == {"detail": expected}
    repository.create_invitation.assert_called_once()
    assert repository.create_invitation.call_args.args[:3] == (owner, "staff@example.com", "Staff")


def test_mailer_uses_advertised_login_and_checks_tls_certificate(auth_client):
    _client, _repository, config = auth_client
    smtp = MagicMock()
    smtp.esmtp_features = {"auth": "PLAIN LOGIN"}
    with patch("app.mailer.smtplib.SMTP") as transport:
        transport.return_value.__enter__.return_value = smtp
        Mailer(config).send("staff@example.com", "Invitation", "Synthetic invitation")

    tls_context = smtp.starttls.call_args.kwargs["context"]
    assert tls_context.check_hostname
    smtp.ehlo_or_helo_if_needed.assert_called_once()
    smtp.auth.assert_called_once_with("LOGIN", smtp.auth_login, initial_response_ok=False)
    smtp.login.assert_not_called()
    assert smtp.user == config.smtp_username
    assert smtp.password == config.smtp_password.get_secret_value()
    smtp.send_message.assert_called_once()


def test_mailer_auth_rejection_does_not_send_or_expose_provider_details(auth_client):
    _client, _repository, config = auth_client
    smtp = MagicMock()
    smtp.esmtp_features = {"auth": "LOGIN"}
    smtp.auth.side_effect = smtplib.SMTPAuthenticationError(535, b"private credential diagnostics")
    with patch("app.mailer.smtplib.SMTP") as transport:
        transport.return_value.__enter__.return_value = smtp
        with pytest.raises(MailUnavailable) as failure:
            Mailer(config).send("staff@example.com", "Invitation", "Synthetic invitation")
    assert str(failure.value) == "Email server sign-in failed. Check the sender email settings."
    smtp.send_message.assert_not_called()


@pytest.mark.parametrize(
    ("elapsed", "retry_after", "duration"),
    [(0, "3600", "60 minutes"), (3539.1, "61", "2 minutes"), (3540, "60", "1 minute"),
     (3599.2, "1", "1 second")],
)
def test_rate_limit_reports_actual_wait_without_extending_window(monkeypatch, elapsed, retry_after, duration):
    clock = [100.0]
    monkeypatch.setattr(auth_routes.time, "monotonic", lambda: clock[0])
    limiter = auth_routes.AuthLimiter()
    for _ in range(5):
        limiter.check("synthetic-register", 5, 3600)
    clock[0] += elapsed
    for _ in range(2):
        with pytest.raises(auth_routes.HTTPException) as failure:
            limiter.check("synthetic-register", 5, 3600)
        assert failure.value.status_code == 429
        assert failure.value.detail == f"Too many attempts. Try again in {duration}."
        assert failure.value.headers == {"Retry-After": retry_after}
    clock[0] = 3700.0
    limiter.check("synthetic-register", 5, 3600)
