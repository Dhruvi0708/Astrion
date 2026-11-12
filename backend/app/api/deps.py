from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.errors import UnauthorizedError
from app.core.security import InvalidTokenError, decode_access_token
from app.db.session import get_db
from app.graph.client import GraphClient, get_graph_client
from app.models import User
from app.services.auth import resolve_session_user
from app.storage import StorageBackend, get_storage

DbSession = Annotated[Session, Depends(get_db)]
Graph = Annotated[GraphClient, Depends(get_graph_client)]
AppSettings = Annotated[Settings, Depends(get_settings)]
Storage = Annotated[StorageBackend, Depends(get_storage)]
Limit = Annotated[int, Query(ge=1, le=100, description="Page size (1–100)")]
Offset = Annotated[int, Query(ge=0, description="Items to skip")]

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    db: DbSession,
    settings: AppSettings,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """Identity comes only from a verified access token — never from client-supplied ids."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthorizedError("Sign in to continue.")
    try:
        claims = decode_access_token(settings, credentials.credentials)
    except InvalidTokenError as exc:
        raise UnauthorizedError("Your session has expired. Please sign in again.") from exc
    user = resolve_session_user(db, claims.user_id, claims.session_id)
    request.state.session_id = claims.session_id
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def client_meta(request: Request) -> tuple[str | None, str | None]:
    return request.headers.get("user-agent"), request.client.host if request.client else None
