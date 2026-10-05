"""Small SMTP adapter; tests replace this transport and never contact real recipients."""

import smtplib
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
            raise MailUnavailable("Email delivery is not configured")
        message = EmailMessage()
        message["From"] = self.config.smtp_from
        message["To"] = recipient
        message["Subject"] = subject
        message.set_content(text)
        try:
            with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port, timeout=10) as client:
                if self.config.smtp_starttls:
                    client.starttls()
                if self.config.smtp_username:
                    client.login(
                        self.config.smtp_username, self.config.smtp_password.get_secret_value()
                    )
                client.send_message(message)
        except (smtplib.SMTPException, OSError) as error:
            raise MailUnavailable("Email delivery is temporarily unavailable") from error
