"""Google OAuth checks with real signed tokens and completely mocked provider HTTP."""

import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlsplit

import pytest
import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from app.config import Settings
from app.google_auth import AUTH_URL, TOKEN_URL, GoogleAuthError, GoogleClient, configured


CLIENT_ID = "test-client.apps.googleusercontent.com"
CLIENT_SECRET = "not-a-real-client-secret"
NONCE = "one-use-test-nonce"
CALLBACK = "http://localhost:5173/api/v1/auth/google/callback"
CERT_URL = "https://www.googleapis.com/oauth2/v1/certs"


def make_config(**changes):
    values = {
        "database_url": "postgresql://tester:tester@localhost:5432/test_stockcast",
        "app_env": "development",
        "cors_origin": "http://localhost:5173",
        "google_client_id": CLIENT_ID,
        "google_client_secret": CLIENT_SECRET,
        "google_redirect_uri": CALLBACK,
    }
    values.update(changes)
    return Settings(_env_file=None, **values)


@pytest.fixture(autouse=True)
def prevent_real_network(monkeypatch):
    def reject_request(*args, **kwargs):
        raise AssertionError("Google tests must never make a real HTTP request")

    monkeypatch.setattr(requests.sessions.Session, "request", reject_request)


@pytest.fixture(scope="module")
def key_pair():
    # Test-only keys using google-auth\'s required cryptography dependency.
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private.public_key(), private


@pytest.fixture()
def signed_token(key_pair):
    _public, private = key_pair

    def encode_part(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=")

    def mint(changes=None, remove=(), tamper=False):
        now = int(time.time())
        claims = {
            "iss": "https://accounts.google.com",
            "aud": CLIENT_ID,
            "sub": "123456789012345678901",
            "iat": now - 60,
            "exp": now + 3600,
            "nonce": NONCE,
            "email": "Retail.Owner@example.com",
            "email_verified": True,
            "name": "  Retail Owner  ",
        }
        claims.update(changes or {})
        for field in remove:
            claims.pop(field, None)
        header = encode_part({"alg": "RS256", "typ": "JWT", "kid": "test-key"})
        payload = encode_part(claims)
        message = header + b"." + payload
        signature = private.sign(message, padding.PKCS1v15(), hashes.SHA256())
        if tamper:
            claims["sub"] = "attacker-changed-subject"
            payload = encode_part(claims)
            message = header + b"." + payload
        return (message + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")).decode()

    return mint


@pytest.fixture()
def provider(monkeypatch, key_pair, signed_token):
    public, _private = key_pair
    state = {
        "payload": {"id_token": signed_token()},
        "status": 200,
        "raw_body": None,
        "token_error": None,
        "certificate_error": None,
        "calls": [],
    }

    def fake_request(_session, method, url, **kwargs):
        state["calls"].append((method.upper(), url, kwargs))
        if url == TOKEN_URL and method.upper() == "POST":
            if state["token_error"]:
                raise state["token_error"]
            payload = state["payload"]
            status = state["status"]
            raw_body = state["raw_body"]
        elif url == CERT_URL and method.upper() == "GET":
            if state["certificate_error"]:
                raise state["certificate_error"]
            certificate = public.public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            ).decode()
            payload = {"test-key": certificate}
            status = 200
            raw_body = None
        else:
            raise AssertionError(f"Unexpected mocked provider endpoint: {method} {url}")
        response = requests.Response()
        response.status_code = status
        response.url = url
        response.encoding = "utf-8"
        response.headers["Content-Type"] = "application/json"
        response._content = raw_body if raw_body is not None else json.dumps(payload).encode()
        return response

    monkeypatch.setattr(requests.sessions.Session, "request", fake_request)
    return state


@pytest.mark.parametrize(
    ("origin", "callback", "environment"),
    [
        ("http://localhost:5173", CALLBACK, "development"),
        ("http://127.0.0.1:8080", "http://127.0.0.1:8080/api/v1/auth/google/callback", "development"),
        ("http://[::1]:8080", "http://[::1]:8080/api/v1/auth/google/callback", "development"),
        ("https://stockcast.example.com", "https://stockcast.example.com/api/v1/auth/google/callback", "production"),
        ("https://stockcast.example.com:443", "https://stockcast.example.com/api/v1/auth/google/callback", "production"),
        ("https://StockCast.example.com/", "https://stockcast.example.com/api/v1/auth/google/callback", "production"),
    ],
)
def test_configuration_accepts_same_origin_and_local_development(origin, callback, environment):
    assert configured(make_config(cors_origin=origin, google_redirect_uri=callback, app_env=environment))


@pytest.mark.parametrize(
    ("origin", "callback", "environment"),
    [
        ("http://localhost:5173", CALLBACK, "production"),
        ("http://retail.example.com", "http://retail.example.com/api/v1/auth/google/callback", "development"),
        ("https://retail.example.com", "https://retail.example.com.attacker.test/api/v1/auth/google/callback", "production"),
        ("https://retail.example.com", "https://retail.example.com:8443/api/v1/auth/google/callback", "production"),
        ("https://retail.example.com", "https://retail.example.com:0/api/v1/auth/google/callback", "production"),
        ("https://retail.example.com", "https://retail.example.com/api/v1/auth/google/callback/", "production"),
        ("https://retail.example.com", "https://retail.example.com/api/v1/auth/google/callback?next=outside", "production"),
        ("https://retail.example.com", "https://retail.example.com/api/v1/auth/google/callback#fragment", "production"),
        ("https://retail.example.com", "https://user@retail.example.com/api/v1/auth/google/callback", "production"),
        ("https://retail.example.com/store", "https://retail.example.com/api/v1/auth/google/callback", "production"),
        ("https://user@retail.example.com", "https://retail.example.com/api/v1/auth/google/callback", "production"),
        ("https://retail.example.com?x=1", "https://retail.example.com/api/v1/auth/google/callback", "production"),
        ("https://retail.example.com", "https://retail.example.com:invalid/api/v1/auth/google/callback", "production"),
        ("https://retail.example.com", "/api/v1/auth/google/callback", "production"),
    ],
)
def test_configuration_rejects_insecure_or_mismatched_callbacks(origin, callback, environment):
    config = make_config(cors_origin=origin, google_redirect_uri=callback, app_env=environment)
    assert not configured(config)
    with pytest.raises(GoogleAuthError, match="unavailable"):
        GoogleClient(config)


@pytest.mark.parametrize(
    "changes",
    [
        {"google_client_id": ""},
        {"google_client_secret": ""},
        {"google_redirect_uri": ""},
        {"google_client_id": "   "},
        {"google_client_secret": "   "},
    ],
)
def test_configuration_requires_complete_credentials(changes):
    assert not configured(make_config(**changes))


def test_authorization_request_uses_pkce_and_keeps_server_secrets_private():
    verifier = "a-high-entropy-server-only-verifier-" * 2
    url = GoogleClient(make_config()).authorization_url("random-state", verifier, NONCE)
    parts = urlsplit(url)
    assert parts.scheme + "://" + parts.netloc + parts.path == AUTH_URL
    query = parse_qs(parts.query)
    assert query["client_id"] == [CLIENT_ID]
    assert query["redirect_uri"] == [CALLBACK]
    assert query["response_type"] == ["code"]
    assert query["scope"] == ["openid email profile"]
    assert query["state"] == ["random-state"]
    assert query["nonce"] == [NONCE]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert query["code_challenge"] == [challenge]
    assert query["code_challenge_method"] == ["S256"]
    assert verifier not in url
    assert CLIENT_SECRET not in url
    assert "client_secret" not in query
    assert "code_verifier" not in query


def test_exchange_verifies_signed_token_and_sends_bounded_server_requests(provider):
    identity = GoogleClient(make_config()).exchange("one-use-code", "server-verifier", NONCE)
    assert identity == {
        "subject": "123456789012345678901",
        "email": "retail.owner@example.com",
        "display_name": "Retail Owner",
    }
    token_request, cert_request = provider["calls"]
    assert token_request[:2] == ("POST", TOKEN_URL)
    assert token_request[2]["data"] == {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": CALLBACK,
        "grant_type": "authorization_code",
        "code": "one-use-code",
        "code_verifier": "server-verifier",
    }
    assert token_request[2]["timeout"] == 10
    assert token_request[2]["allow_redirects"] is False
    assert cert_request[:2] == ("GET", CERT_URL)
    assert cert_request[2]["timeout"] == 10
    assert "id_token" not in identity
    assert "access_token" not in identity


@pytest.mark.parametrize(
    "changes",
    [
        {"iss": "https://attacker.example.com"},
        {"aud": "different-client.apps.googleusercontent.com"},
        {"iat": 1, "exp": 2},
        {"iat": 4102444800, "exp": 4102448400},
        {"nonce": "another-browser-nonce"},
        {"nonce": None},
        {"email_verified": False},
        {"email_verified": "true"},
        {"email_verified": 1},
        {"sub": ""},
        {"sub": None},
        {"sub": 12345},
        {"sub": "x" * 256},
        {"sub": "non-ascii-\u00f1"},
        {"email": "not-an-email-address"},
        {"email": None},
        {"azp": "another-authorized-party"},
    ],
)
def test_exchange_rejects_untrusted_identity_claims(provider, signed_token, changes):
    provider["payload"] = {"id_token": signed_token(changes)}
    with pytest.raises(GoogleAuthError, match="could not be verified"):
        GoogleClient(make_config()).exchange("code", "verifier", NONCE)


@pytest.mark.parametrize("field", ["iss", "aud", "iat", "exp", "sub", "nonce", "email_verified", "email"])
def test_exchange_rejects_missing_required_identity_claims(provider, signed_token, field):
    provider["payload"] = {"id_token": signed_token(remove=(field,))}
    with pytest.raises(GoogleAuthError):
        GoogleClient(make_config()).exchange("code", "verifier", NONCE)


def test_exchange_rejects_signature_tampering(provider, signed_token):
    provider["payload"] = {"id_token": signed_token(tamper=True)}
    with pytest.raises(GoogleAuthError):
        GoogleClient(make_config()).exchange("code", "verifier", NONCE)


@pytest.mark.parametrize("payload", [None, [], {}, {"id_token": None}, {"id_token": ""}, {"id_token": 1}, {"id_token": "not-a-jwt"}])
def test_exchange_rejects_malformed_provider_response(provider, payload):
    provider["payload"] = payload
    with pytest.raises(GoogleAuthError):
        GoogleClient(make_config()).exchange("code", "verifier", NONCE)


@pytest.mark.parametrize("status", [302, 400, 401, 500])
def test_exchange_rejects_provider_http_failure_including_redirect(provider, status):
    provider["status"] = status
    with pytest.raises(GoogleAuthError):
        GoogleClient(make_config()).exchange("code", "verifier", NONCE)


def test_exchange_rejects_non_json_response(provider):
    provider["raw_body"] = b"<html>upstream unavailable</html>"
    with pytest.raises(GoogleAuthError):
        GoogleClient(make_config()).exchange("code", "verifier", NONCE)


@pytest.mark.parametrize("stage", ["token_error", "certificate_error"])
def test_provider_outage_is_safe_and_does_not_expose_provider_details(provider, stage):
    provider[stage] = requests.Timeout("sensitive-provider-details-and-client-secret")
    with pytest.raises(GoogleAuthError) as error:
        GoogleClient(make_config()).exchange("private-code", "private-verifier", NONCE)
    assert str(error.value) == "Google sign-in could not be verified"
    assert "sensitive-provider" not in str(error.value)
    assert CLIENT_SECRET not in str(error.value)


@pytest.mark.parametrize("name", [None, "", "   ", 42])
def test_exchange_uses_validated_email_when_profile_name_is_missing(provider, signed_token, name):
    provider["payload"] = {"id_token": signed_token({"name": name})}
    identity = GoogleClient(make_config()).exchange("code", "verifier", NONCE)
    assert identity["display_name"] == "retail.owner@example.com"


@pytest.mark.parametrize("host", ["192.0.2.10", "[2001:db8::10]"])
def test_configuration_rejects_nonlocal_ip_even_with_matching_https_origin(host):
    origin = f"https://{host}"
    config = make_config(
        cors_origin=origin,
        google_redirect_uri=origin + "/api/v1/auth/google/callback",
        app_env="production",
    )
    assert not configured(config)
    with pytest.raises(GoogleAuthError, match="unavailable"):
        GoogleClient(config)


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]"])
def test_configuration_accepts_https_loopback_origin(host):
    origin = f"https://{host}"
    assert configured(
        make_config(
            cors_origin=origin,
            google_redirect_uri=origin + "/api/v1/auth/google/callback",
            app_env="production",
        )
    )
