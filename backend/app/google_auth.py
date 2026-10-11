"""Google authorization-code flow; provider tokens never leave the backend."""
import base64
import hashlib
import hmac
from ipaddress import ip_address
from urllib.parse import urlencode, urlsplit

import requests
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from pydantic import EmailStr, TypeAdapter

from .config import Settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"


class GoogleAuthError(Exception):
    """Safe failure with no provider credentials or response details."""


def configured(config: Settings) -> bool:
    if not config.google_client_id.strip() or not config.google_client_secret.get_secret_value().strip():
        return False
    try:
        callback = urlsplit(config.google_redirect_uri)
        origin = urlsplit(config.cors_origin)
        def address(url):
            return (url.scheme, (url.hostname or "").lower(),
                    url.port if url.port is not None else (443 if url.scheme == "https" else 80))
        if address(callback) != address(origin) or not callback.hostname or not 1 <= address(callback)[2] <= 65535:
            return False
        if config.google_redirect_uri != config.google_redirect_uri.strip() or config.cors_origin != config.cors_origin.strip():
            return False
        if callback.username or callback.password or callback.query or callback.fragment:
            return False
        if origin.username or origin.password or origin.query or origin.fragment or origin.path not in ("", "/"):
            return False
        if callback.path != "/api/v1/auth/google/callback":
            return False
        try:
            if not ip_address(callback.hostname).is_loopback:
                return False
        except ValueError:
            pass  # A DNS hostname, rather than a raw IP address.
        if callback.scheme == "https":
            return True
        return (config.app_env == "development" and callback.scheme == "http"
                and callback.hostname.lower() in ("localhost", "127.0.0.1", "::1"))
    except ValueError:
        return False


class TimedRequest(Request):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 10
        return super().__call__(*args, **kwargs)


class GoogleClient:
    def __init__(self, config: Settings):
        if not configured(config):
            raise GoogleAuthError("Google sign-in is unavailable")
        self.config = config

    def authorization_url(self, state: str, verifier: str, nonce: str) -> str:
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode()
        return AUTH_URL + "?" + urlencode({
            "client_id": self.config.google_client_id,
            "redirect_uri": self.config.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })

    def exchange(self, code: str, verifier: str, nonce: str) -> dict[str, str]:
        try:
            response = requests.post(TOKEN_URL, data={
                "client_id": self.config.google_client_id,
                "client_secret": self.config.google_client_secret.get_secret_value(),
                "redirect_uri": self.config.google_redirect_uri,
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
            }, timeout=10, allow_redirects=False)
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("Unexpected token response status")
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("id_token"), str) or not payload["id_token"]:
                raise ValueError("Invalid token response")
            with requests.Session() as session:
                claims = id_token.verify_oauth2_token(
                    payload["id_token"], TimedRequest(session=session), self.config.google_client_id
                )
            subject = claims.get("sub")
            claimed_nonce = claims.get("nonce")
            if (not isinstance(subject, str) or not subject or len(subject) > 255 or not subject.isascii()
                or not isinstance(claimed_nonce, str) or not nonce
                or not hmac.compare_digest(claimed_nonce, nonce)
                or claims.get("email_verified") is not True
                or claims.get("azp", self.config.google_client_id) != self.config.google_client_id):
                raise ValueError("Invalid identity")
            email = str(TypeAdapter(EmailStr).validate_python(claims.get("email"))).lower()
            name = claims.get("name")
            display_name = name.strip() if isinstance(name, str) and name.strip() else email
            return {"subject": subject, "email": email, "display_name": display_name[:160]}
        except Exception as error:
            raise GoogleAuthError("Google sign-in could not be verified") from error
