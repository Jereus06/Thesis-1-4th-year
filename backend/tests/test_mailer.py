from types import SimpleNamespace
from unittest.mock import MagicMock, patch


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
        try:
            Mailer(config(smtp_host="")).send("nobody@example.invalid", "x", "x")
        except MailUnavailable:
            pass
        else:
            raise AssertionError("missing configuration must fail")
    smtp.assert_not_called()
