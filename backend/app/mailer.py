"""Small SMTP adapter; tests replace this transport and never contact real recipients."""

import smtplib
import ssl
from typing import TYPE_CHECKING, Any
from email.message import EmailMessage

if TYPE_CHECKING:
    from .config import Settings
else:
    Settings = Any


class MailUnavailable(RuntimeError):
    pass


class Mailer:
    def __init__(self, config: Settings):
        self.config = config

    def send(self, recipient: str, subject: str, text: str) -> None:
        if not self.config.smtp_host or not self.config.smtp_from:
            raise MailUnavailable("Email is not set up. Check the sender email settings.")
        message = EmailMessage()
        message["From"] = self.config.smtp_from
        message["To"] = recipient
        message["Subject"] = subject
        message.set_content(text)
        try:
            with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port, timeout=10) as client:
                if self.config.smtp_starttls:
                    client.starttls(context=ssl.create_default_context())
                if self.config.smtp_username:
                    client.ehlo_or_helo_if_needed()
                    # Some providers close PLAIN authentication without a response.
                    # LOGIN uses the same credentials over the verified TLS connection.
                    methods = client.esmtp_features.get("auth", "").upper().split()
                    if "LOGIN" in methods:
                        client.user = self.config.smtp_username
                        client.password = self.config.smtp_password.get_secret_value()
                        client.auth("LOGIN", client.auth_login, initial_response_ok=False)
                    else:
                        client.login(
                            self.config.smtp_username, self.config.smtp_password.get_secret_value()
                        )
                client.send_message(message)
        except smtplib.SMTPAuthenticationError as error:
            raise MailUnavailable(
                "Email server sign-in failed. Check the sender email settings."
            ) from error
        except smtplib.SMTPRecipientsRefused as error:
            raise MailUnavailable(
                "The email server rejected this address. Check the recipient email."
            ) from error
        except (smtplib.SMTPException, OSError) as error:
            raise MailUnavailable("Email could not be sent. Please try again later.") from error
