"""Password hashing and token primitives.

* Passwords: Argon2id (argon2-cffi defaults, RFC 9106 low-memory profile).
* Access tokens: short-lived HS256 JWTs bound to a server-side session (``sid``), so logout and
  revocation take effect immediately.
* Refresh tokens: 384-bit random opaque strings. Only their SHA-256 digest is stored.
"""

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings

_hasher = PasswordHasher()
# Used when the email is unknown so login timing does not reveal which accounts exist.
_DUMMY_HASH = _hasher.hash("astrion-timing-equaliser")

ACCESS_AUDIENCE = "astrion-web"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def tokens_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


@dataclass(frozen=True)
class AccessClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID
    expires_at: datetime


def create_access_token(settings: Settings, user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, int]:
    now = datetime.now(UTC)
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "iss": settings.jwt_issuer,
        "aud": ACCESS_AUDIENCE,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "typ": "access",
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.jwt_signing_key, algorithm="HS256"), int(ttl.total_seconds())


class InvalidTokenError(Exception):
    pass


def decode_access_token(settings: Settings, token: str) -> AccessClaims:
    try:
        data = jwt.decode(
            token,
            settings.jwt_signing_key,
            algorithms=["HS256"],  # pinned: never accept "none" or asymmetric confusion
            audience=ACCESS_AUDIENCE,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "sid", "aud", "iss"]},
        )
        if data.get("typ") != "access":
            raise InvalidTokenError("wrong token type")
        return AccessClaims(
            user_id=uuid.UUID(data["sub"]),
            session_id=uuid.UUID(data["sid"]),
            expires_at=datetime.fromtimestamp(data["exp"], UTC),
        )
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise InvalidTokenError(str(exc)) from exc
