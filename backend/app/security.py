import hashlib
import hmac
import secrets
from dataclasses import dataclass


@dataclass(frozen=True)
class Principal:
    user_id: str
    business_id: str
    email: str
    display_name: str
    role: str


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters")
    actual_salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=actual_salt, n=2**14, r=8, p=1, dklen=64)
    return f"scrypt:{actual_salt.hex()}:{derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt_hex, expected_hex = stored.split(":", 2)
        if algorithm != "scrypt":
            return False
        actual = hash_password(password, salt=bytes.fromhex(salt_hex)).rsplit(":", 1)[1]
        return hmac.compare_digest(actual, expected_hex)
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
