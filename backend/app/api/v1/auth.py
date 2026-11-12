"""Authentication endpoints.

Token strategy
* ``access_token`` (JSON body) — short-lived JWT, kept in memory by the SPA, sent as ``Authorization: Bearer``.
* refresh token — httpOnly, SameSite=Strict cookie scoped to ``/api/v1/auth``; rotated on every refresh.

Every endpoint that reads or sets the cookie requires the ``X-Astrion-Client`` header. Browsers cannot
send a custom header cross-origin without a CORS preflight, which the API only allows for configured
origins — this blocks cross-site request forgery against the cookie.
"""

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Header, Request, Response, status

from app.api.deps import AppSettings, CurrentUser, DbSession, client_meta
from app.core.config import Settings
from app.core.errors import ForbiddenError
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserRead
from app.schemas.common import ErrorResponse as ErrorResponseModel
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "astrion_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth"
CLIENT_HEADER = "X-Astrion-Client"


def require_client_header(x_astrion_client: Annotated[str | None, Header(alias=CLIENT_HEADER)] = None) -> None:
    if not x_astrion_client:
        raise ForbiddenError(f"Missing {CLIENT_HEADER} header.")


CsrfGuard = Depends(require_client_header)
ERRORS = {401: {"model": ErrorResponseModel}, 403: {"model": ErrorResponseModel}, 429: {"model": ErrorResponseModel}}


def _set_refresh_cookie(response: Response, settings: Settings, tokens: auth_service.IssuedTokens) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh_token,
        max_age=settings.refresh_token_ttl_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path=REFRESH_COOKIE_PATH,
    )
    response.headers["Cache-Control"] = "no-store"


def _clear_refresh_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH, secure=settings.cookie_secure, httponly=True, samesite="strict")


def _token_response(tokens: auth_service.IssuedTokens) -> TokenResponse:
    return TokenResponse(access_token=tokens.access_token, expires_in=tokens.expires_in, user=UserRead.model_validate(tokens.user))


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CsrfGuard],
    responses={409: {"model": ErrorResponseModel}, **ERRORS},
)
def register(payload: RegisterRequest, request: Request, response: Response, db: DbSession, settings: AppSettings) -> TokenResponse:
    ua, ip = client_meta(request)
    tokens = auth_service.register(db, settings, payload, user_agent=ua, ip=ip)
    _set_refresh_cookie(response, settings, tokens)
    return _token_response(tokens)


@router.post("/login", response_model=TokenResponse, dependencies=[CsrfGuard], responses=ERRORS)
def login(payload: LoginRequest, request: Request, response: Response, db: DbSession, settings: AppSettings) -> TokenResponse:
    ua, ip = client_meta(request)
    tokens = auth_service.login(db, settings, payload, user_agent=ua, ip=ip)
    _set_refresh_cookie(response, settings, tokens)
    return _token_response(tokens)


@router.post("/refresh", response_model=TokenResponse, dependencies=[CsrfGuard], responses=ERRORS)
def refresh(
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    astrion_refresh: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> TokenResponse:
    ua, ip = client_meta(request)
    try:
        tokens = auth_service.refresh(db, settings, astrion_refresh, user_agent=ua, ip=ip)
    except Exception:
        _clear_refresh_cookie(response, settings)
        raise
    _set_refresh_cookie(response, settings, tokens)
    return _token_response(tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfGuard], responses=ERRORS)
def logout(request: Request, user: CurrentUser, db: DbSession, settings: AppSettings) -> Response:
    auth_service.logout(db, request.state.session_id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response, settings)
    return response


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfGuard], responses=ERRORS)
def logout_all(user: CurrentUser, db: DbSession, settings: AppSettings) -> Response:
    auth_service.logout_all(db, user.id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response, settings)
    return response


@router.get("/me", response_model=UserRead, responses=ERRORS)
def me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)
