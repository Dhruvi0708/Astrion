"""Registration, login, token refresh rotation, logout and session invalidation."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import ACCESS_AUDIENCE, create_access_token, hash_password, verify_password
from app.models import AuthSession, User
from tests.conftest import CLIENT_HEADERS, DEFAULT_PASSWORD, bearer, register_user

REFRESH = "astrion_refresh"


def test_register_returns_tokens_and_cookie(client, db_session):
    body = register_user(client, "  Ada@Example.ORG ", name="Ada")
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 15 * 60
    assert body["user"]["email"] == "ada@example.org"  # normalised
    assert "password" not in str(body) and "hash" not in str(body)
    cookie = client.cookies.get(REFRESH)
    assert cookie and len(cookie) > 40
    user = db_session.scalar(select(User).where(User.email == "ada@example.org"))
    assert user.password_hash.startswith("$argon2id$")
    assert DEFAULT_PASSWORD not in user.password_hash
    # Only a digest of the refresh token is stored.
    session = db_session.scalar(select(AuthSession).where(AuthSession.user_id == user.id))
    assert session.refresh_token_hash != cookie and len(session.refresh_token_hash) == 64


def test_refresh_cookie_flags(client):
    r = client.post("/api/v1/auth/register", json={"email": "c@example.org", "password": DEFAULT_PASSWORD, "display_name": "C"}, headers=CLIENT_HEADERS)
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie
    assert "path=/api/v1/auth" in set_cookie
    assert r.headers["cache-control"] == "no-store"


def test_duplicate_email_rejected_case_insensitively(client):
    register_user(client, "dup@example.org")
    r = client.post("/api/v1/auth/register", json={"email": "DUP@example.org", "password": DEFAULT_PASSWORD, "display_name": "X"}, headers=CLIENT_HEADERS)
    assert r.status_code == 409


@pytest.mark.parametrize("password", ["short", "aaaaaaaaaaaaaaaa", " leading-space-password-1"])
def test_weak_passwords_rejected(client, password):
    r = client.post("/api/v1/auth/register", json={"email": "w@example.org", "password": password, "display_name": "W"}, headers=CLIENT_HEADERS)
    assert r.status_code == 422


def test_login_success_and_failure(client):
    register_user(client, "eve@example.org")
    ok = client.post("/api/v1/auth/login", json={"email": "EVE@example.org", "password": DEFAULT_PASSWORD}, headers=CLIENT_HEADERS)
    assert ok.status_code == 200
    bad = client.post("/api/v1/auth/login", json={"email": "eve@example.org", "password": "wrong password 123"}, headers=CLIENT_HEADERS)
    unknown = client.post("/api/v1/auth/login", json={"email": "nobody@example.org", "password": "wrong password 123"}, headers=CLIENT_HEADERS)
    # Same response for wrong password and unknown account: no user enumeration.
    assert bad.status_code == unknown.status_code == 401
    assert bad.json()["error"]["message"] == unknown.json()["error"]["message"]
    assert bad.headers["www-authenticate"].startswith("Bearer")


def test_login_rate_limited(client):
    register_user(client, "rl@example.org")
    for _ in range(8):
        client.post("/api/v1/auth/login", json={"email": "rl@example.org", "password": "nope nope nope 1"}, headers=CLIENT_HEADERS)
    r = client.post("/api/v1/auth/login", json={"email": "rl@example.org", "password": DEFAULT_PASSWORD}, headers=CLIENT_HEADERS)
    assert r.status_code == 429


def test_cookie_endpoints_require_client_header(client):
    r = client.post("/api/v1/auth/register", json={"email": "h@example.org", "password": DEFAULT_PASSWORD, "display_name": "H"})
    assert r.status_code == 403
    assert client.post("/api/v1/auth/refresh").status_code == 403


def test_me_requires_valid_token(client):
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401
    body = register_user(client, "me@example.org", name="Me")
    me = client.get("/api/v1/auth/me", headers=bearer(body))
    assert me.status_code == 200 and me.json()["display_name"] == "Me"


def test_tampered_and_foreign_tokens_rejected(client, db_session):
    body = register_user(client, "t@example.org")
    claims = jwt.decode(body["access_token"], options={"verify_signature": False})
    forged = jwt.encode({**claims, "sub": claims["sub"]}, "attacker-secret", algorithm="HS256")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    none_alg = jwt.encode(claims, key=None, algorithm="none") if hasattr(jwt, "encode") else ""
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {none_alg}"}).status_code == 401
    expired = jwt.encode({**claims, "exp": int((datetime.now(UTC) - timedelta(minutes=1)).timestamp())}, get_settings().jwt_signing_key, algorithm="HS256")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    wrong_aud = jwt.encode({**claims, "aud": "other"}, get_settings().jwt_signing_key, algorithm="HS256")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {wrong_aud}"}).status_code == 401
    assert claims["aud"] == ACCESS_AUDIENCE


def test_refresh_rotates_and_detects_reuse(client, db_session, monkeypatch):
    import app.services.auth as auth_service

    monkeypatch.setattr(auth_service, "REUSE_GRACE_SECONDS", 0)
    register_user(client, "rot@example.org")
    first_cookie = client.cookies.get(REFRESH)
    r1 = client.post("/api/v1/auth/refresh", headers=CLIENT_HEADERS)
    assert r1.status_code == 200
    second_cookie = client.cookies.get(REFRESH)
    assert second_cookie != first_cookie

    # Replaying the rotated (stolen) token revokes the whole session family...
    client.cookies.set(REFRESH, first_cookie, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh", headers=CLIENT_HEADERS).status_code == 401
    # ...so the legitimate newer token stops working too.
    client.cookies.set(REFRESH, second_cookie, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh", headers=CLIENT_HEADERS).status_code == 401
    assert client.get("/api/v1/auth/me", headers=bearer(r1.json())).status_code == 401


def test_logout_invalidates_access_and_refresh(client):
    body = register_user(client, "out@example.org")
    headers = {**bearer(body), **CLIENT_HEADERS}
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    # The access token is bound to the revoked session, so it is rejected immediately.
    assert client.get("/api/v1/auth/me", headers=bearer(body)).status_code == 401
    assert client.post("/api/v1/auth/refresh", headers=CLIENT_HEADERS).status_code == 401


def test_logout_all_ends_every_session(client):
    first = register_user(client, "all@example.org")
    second = client.post("/api/v1/auth/login", json={"email": "all@example.org", "password": DEFAULT_PASSWORD}, headers=CLIENT_HEADERS).json()
    assert client.post("/api/v1/auth/logout-all", headers={**bearer(second), **CLIENT_HEADERS}).status_code == 204
    assert client.get("/api/v1/auth/me", headers=bearer(first)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=bearer(second)).status_code == 401


def test_expired_refresh_session_rejected(client, db_session):
    register_user(client, "exp@example.org")
    session = db_session.scalar(select(AuthSession))
    session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    assert client.post("/api/v1/auth/refresh", headers=CLIENT_HEADERS).status_code == 401


def test_access_token_for_missing_session_rejected(client, db_session):
    import uuid

    body = register_user(client, "ghost@example.org")
    user_id = uuid.UUID(body["user"]["id"])
    token, _ = create_access_token(get_settings(), user_id, uuid.uuid4())
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_password_helpers():
    h = hash_password("a very good passphrase")
    assert verify_password("a very good passphrase", h)
    assert not verify_password("wrong", h)
    assert not verify_password("anything", None)
    assert not verify_password("anything", "not-a-hash")


def test_protected_endpoints_require_auth(client):
    for method, path in [
        ("get", "/api/v1/workspaces"),
        ("post", "/api/v1/workspaces"),
        ("get", "/api/v1/sources/00000000-0000-0000-0000-000000000000"),
        ("get", "/api/v1/documents/00000000-0000-0000-0000-000000000000/content"),
    ]:
        r = getattr(client, method)(path, **({"json": {"name": "x"}} if method == "post" else {}))
        assert r.status_code == 401, path
    assert client.get("/api/v1/health").status_code == 200  # health stays public
