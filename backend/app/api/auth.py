"""Account routes. Thin: validation here, logic in `services/auth.py`, enforcement in
`app/auth.py` (which also decides which of these routes are public)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE, auth_enabled
from app.database import get_db
from app.services import auth as svc

router = APIRouter(prefix="/auth", tags=["auth"])

Username = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
Password = Annotated[str, Field(min_length=svc.PASSWORD_MIN, max_length=svc.PASSWORD_MAX)]


class Credentials(BaseModel):
    username: Username
    password: Password


class LoginRequest(BaseModel):
    # Not held to the 8-128 rule (a wrong-length guess is just a wrong password), but bounded
    # so nobody can feed megabytes to the hash.
    username: str = Field(max_length=256)
    password: str = Field(max_length=1024)


class AccountUpdate(BaseModel):
    current_password: str = Field(max_length=1024)
    new_username: Username | None = None
    new_password: Password | None = None

    @model_validator(mode="after")
    def _needs_a_change(self):
        if self.new_username is None and self.new_password is None:
            raise ValueError("Give a new username, a new password, or both")
        return self


class AuthStatus(BaseModel):
    enabled: bool
    configured: bool
    authenticated: bool
    username: str | None


async def auth_error_handler(_request: Request, exc: svc.AuthError) -> JSONResponse:
    headers = {"Retry-After": str(exc.retry_after)} if isinstance(exc, svc.Throttled) else None
    return JSONResponse({"detail": exc.message}, status_code=exc.status_code, headers=headers)


def require_enabled() -> None:
    if not auth_enabled():
        raise svc.AuthDisabled()


def _is_https(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return request.url.scheme == "https" or forwarded == "https"


def _set_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=svc.SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=_is_https(request),
        path="/",
    )


def _status(request: Request, db: Session) -> AuthStatus:
    enabled = auth_enabled()
    username = getattr(request.state, "auth_user", None)
    return AuthStatus(
        enabled=enabled,
        configured=svc.get_user(db) is not None,
        authenticated=enabled and username is not None,
        username=username if enabled else None,
    )


@router.get("/status", summary="Who is signed in")
def status(request: Request, db: Session = Depends(get_db)) -> AuthStatus:
    """Public. Tells the web app whether to show the app, the login page or the setup page."""
    return _status(request, db)


@router.post("/setup", dependencies=[Depends(require_enabled)], summary="Create the account")
def setup(
    body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)
) -> AuthStatus:
    """Public, once. The first visitor to a fresh instance creates the one and only account and
    is signed in. Every later call is a 409."""
    svc.create_user(db, body.username, body.password)
    _set_cookie(request, response, svc.create_session(db))
    request.state.auth_user = body.username
    return _status(request, db)


@router.post("/login", dependencies=[Depends(require_enabled)], summary="Sign in")
def login(
    body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> AuthStatus:
    """Public. Sets the `parallax_session` cookie. Scripts keep the cookie and send it back."""
    _set_cookie(request, response, svc.login(db, body.username, body.password))
    user = svc.get_user(db)
    request.state.auth_user = user.username if user else None
    return _status(request, db)


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.post("/logout", status_code=204, summary="Sign out this browser")
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    session_id = getattr(request.state, "auth_session_id", None)
    if session_id is not None:
        svc.delete_session(db, session_id)
    response = Response(status_code=204)
    _clear_cookie(response)
    return response


@router.post("/logout-all", status_code=204, summary="Sign out everywhere")
def logout_all(db: Session = Depends(get_db)) -> Response:
    svc.delete_all_sessions(db)
    response = Response(status_code=204)
    _clear_cookie(response)
    return response


@router.patch(
    "/account", dependencies=[Depends(require_enabled)], summary="Change username or password"
)
def update_account(
    body: AccountUpdate, request: Request, db: Session = Depends(get_db)
) -> AuthStatus:
    """Always needs the current password. A new password signs every other browser out."""
    session_id = getattr(request.state, "auth_session_id", None)
    user = svc.update_account(
        db, session_id, body.current_password, body.new_username, body.new_password
    )
    request.state.auth_user = user.username
    return _status(request, db)
