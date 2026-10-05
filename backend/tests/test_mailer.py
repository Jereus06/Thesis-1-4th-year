import smtplib
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.mailer import MailUnavailable, Mailer


def config(**changes):
    values = {
        "smtp_host": "smtp.test",
        "smtp_port": 587,
        "smtp_from": "noreply@test.invalid",
        "smtp_starttls": True,
        "smtp_username": "user",
        "smtp_password": SimpleNamespace(get_secret_value=lambda: "secret"),
    }
    values.update(changes)
    return SimpleNamespace(**values)


def test_mock_smtp_transport_uses_tls_auth_and_message():
    client = MagicMock()
    context = MagicMock()
    context.__enter__.return_value = client
    with patch("app.mailer.smtplib.SMTP", return_value=context) as smtp:
        Mailer(config()).send(
            "synthetic@example.invalid", "Test invitation", "single-use test link"
        )
    smtp.assert_called_once_with("smtp.test", 587, timeout=10)
    client.starttls.assert_called_once()
    client.login.assert_called_once_with("user", "secret")
    assert client.send_message.call_args.args[0]["To"] == "synthetic@example.invalid"


def test_unconfigured_mail_never_attempts_delivery():
    with patch("app.mailer.smtplib.SMTP") as smtp:
        with pytest.raises(MailUnavailable, match="Email delivery is not configured"):
            Mailer(config(smtp_host="")).send("nobody@example.invalid", "x", "x")
    smtp.assert_not_called()


@pytest.mark.parametrize("stage", ["connect", "enter", "starttls", "login", "send", "exit"])
@pytest.mark.parametrize("error_type", [smtplib.SMTPException, OSError])
def test_smtp_and_network_failures_become_mail_unavailable(stage, error_type):
    error = error_type("private transport diagnostics")
    client = MagicMock()
    context = MagicMock()
    context.__enter__.return_value = client
    with patch("app.mailer.smtplib.SMTP", return_value=context) as smtp:
        failing_call = {
            "connect": smtp,
            "enter": context.__enter__,
            "starttls": client.starttls,
            "login": client.login,
            "send": client.send_message,
            "exit": context.__exit__,
        }[stage]
        failing_call.side_effect = error
        with pytest.raises(MailUnavailable) as raised:
            Mailer(config()).send("synthetic@example.invalid", "Test", "single-use link")

    assert str(raised.value) == "Email delivery is temporarily unavailable"
    assert raised.value.__cause__ is error
