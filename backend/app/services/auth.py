"""Authentication use-cases: registration, login, refresh rotation, logout."""

import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ConflictError, TooManyRequestsError, UnauthorizedError
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_refresh_token,
    password_needs_rehash,
    verify_password,
)
from app.models import AuthSession, User
from app.models.enums import UserStatus
from app.schemas.auth import LoginRequest, RegisterRequest

logger = logging.getLogger("astrion.auth")

REUSE_GRACE_SECONDS = 10


@dataclass(frozen=True)
class IssuedTokens:
    user: User
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime


class LoginRateLimiter:
    """Sliding-window limiter for failed logins, keyed by (client IP, email).

    In-process only: adequate for a single API instance. Use a shared store (e.g. Redis) when
    running several replicas.
    """

    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, window: int) -> deque[float]:
        q = self._failures[key]
        cutoff = time.monotonic() - window
        while q and q[0] < cutoff:
            q.popleft()
        return q

    def check(self, key: str, max_failures: int, window: int) -> None:
        with self._lock:
            if len(self._prune(key, window)) >= max_failures:
                raise TooManyRequestsError("Too many failed sign-in attempts. Try again later.")

    def record_failure(self, key: str, window: int) -> None:
        with self._lock:
            self._prune(key, window).append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)


login_limiter = LoginRateLimiter()


def _normalise_email(email: str) -> str:
    return email.strip().lower()


def _issue(
    db: Session, settings: Settings, user: User, *, family_id: uuid.UUID | None, user_agent: str | None, ip: str | None
) -> tuple[AuthSession, IssuedTokens]:
    refresh = new_refresh_token()
    expires_at = datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days)
    session = AuthSession(
        user_id=user.id,
        family_id=family_id or uuid.uuid4(),
        refresh_token_hash=hash_token(refresh),
        expires_at=expires_at,
        user_agent=(user_agent or "")[:400] or None,
        ip_address=(ip or "")[:64] or None,
    )
    db.add(session)
    db.flush()
    access, ttl = create_access_token(settings, user.id, session.id)
    return session, IssuedTokens(user=user, access_token=access, expires_in=ttl, refresh_token=refresh, refresh_expires_at=expires_at)


def register(db: Session, settings: Settings, payload: RegisterRequest, *, user_agent: str | None, ip: str | None) -> IssuedTokens:
    email = _normalise_email(payload.email)
    if db.scalar(select(User.id).where(User.email == email)):
        raise ConflictError("An account with this email already exists.")
    user = User(email=email, display_name=payload.display_name, password_hash=hash_password(payload.password), last_login_at=datetime.now(UTC))
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:  # concurrent registration with the same email
        db.rollback()
        raise ConflictError("An account with this email already exists.") from exc
    _, tokens = _issue(db, settings, user, family_id=None, user_agent=user_agent, ip=ip)
    db.commit()
    logger.info("user registered", extra={"user_id": str(user.id)})
    return tokens


def login(db: Session, settings: Settings, payload: LoginRequest, *, user_agent: str | None, ip: str | None) -> IssuedTokens:
    email = _normalise_email(payload.email)
    key = f"{ip or '-'}|{email}"
    login_limiter.check(key, settings.login_max_failures, settings.login_window_seconds)
    user = db.scalar(select(User).where(User.email == email))
    # verify_password runs even when the user is missing, so response time does not leak existence.
    ok = verify_password(payload.password, user.password_hash if user else None)
    if not user or not ok or user.status != UserStatus.active:
        login_limiter.record_failure(key, settings.login_window_seconds)
        logger.info("login failed", extra={"reason": "invalid_credentials"})
        raise UnauthorizedError("Email or password is incorrect.")
    login_limiter.reset(key)
    if user.password_hash and password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    user.last_login_at = datetime.now(UTC)
    _, tokens = _issue(db, settings, user, family_id=None, user_agent=user_agent, ip=ip)
    db.commit()
    return tokens


def _revoke_family(db: Session, family_id: uuid.UUID, reason: str) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.family_id == family_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason=reason)
    )


def refresh(db: Session, settings: Settings, refresh_token: str | None, *, user_agent: str | None, ip: str | None) -> IssuedTokens:
    if not refresh_token:
        raise UnauthorizedError("Your session has expired. Please sign in again.")
    session = db.scalar(select(AuthSession).where(AuthSession.refresh_token_hash == hash_token(refresh_token)))
    if session is None:
        raise UnauthorizedError("Your session has expired. Please sign in again.")
    now = datetime.now(UTC)
    if session.revoked_at is not None:
        revoked_at = session.revoked_at.replace(tzinfo=session.revoked_at.tzinfo or UTC)
        # Two tabs refreshing at the same moment present the same token; tolerate that briefly.
        concurrent_refresh = session.revoked_reason == "rotated" and now - revoked_at < timedelta(seconds=REUSE_GRACE_SECONDS)
        if session.replaced_by_id is not None and not concurrent_refresh:
            # A rotated token was replayed: assume it was stolen and end every session in the chain.
            _revoke_family(db, session.family_id, "reuse_detected")
            db.commit()
            logger.warning("refresh token reuse detected", extra={"user_id": str(session.user_id)})
        raise UnauthorizedError("Your session has expired. Please sign in again.")
    if session.expires_at.replace(tzinfo=session.expires_at.tzinfo or UTC) <= now:
        session.revoked_at, session.revoked_reason = now, "expired"
        db.commit()
        raise UnauthorizedError("Your session has expired. Please sign in again.")
    user = db.get(User, session.user_id)
    if user is None or user.status != UserStatus.active:
        _revoke_family(db, session.family_id, "user_inactive")
        db.commit()
        raise UnauthorizedError("Your session has expired. Please sign in again.")
    new_session, tokens = _issue(db, settings, user, family_id=session.family_id, user_agent=user_agent, ip=ip)
    session.revoked_at, session.revoked_reason, session.replaced_by_id = now, "rotated", new_session.id
    db.commit()
    return tokens


def logout(db: Session, session_id: uuid.UUID) -> None:
    session = db.get(AuthSession, session_id)
    if session and session.revoked_at is None:
        _revoke_family(db, session.family_id, "logout")
        db.commit()


def logout_all(db: Session, user_id: uuid.UUID) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason="logout_all")
    )
    db.commit()


def resolve_session_user(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> User:
    """Validates that an access token's session is still live and returns its user."""
    session = db.get(AuthSession, session_id)
    now = datetime.now(UTC)
    if (
        session is None
        or session.user_id != user_id
        or session.revoked_at is not None
        or session.expires_at.replace(tzinfo=session.expires_at.tzinfo or UTC) <= now
    ):
        raise UnauthorizedError("Your session has expired. Please sign in again.")
    user = db.get(User, user_id)
    if user is None or user.status != UserStatus.active:
        raise UnauthorizedError("Your session has expired. Please sign in again.")
    return user
