"""Authentication enforcement: one default-deny ASGI middleware, one allowlist.

Every path under `/api`, plus `/docs`, `/redoc` and `/openapi.json`, needs a valid session
cookie unless `(method, path)` is in `PUBLIC_ROUTES`. A router added next year is protected
without anyone remembering to protect it; `tests/test_auth_coverage.py` walks every route to
prove it. Do not add exceptions: the allowlist below is the only place one can live.

The static SPA shell (anything outside the protected prefixes) stays public, or the login page
could not load.

Pure ASGI on purpose: `BaseHTTPMiddleware` interferes with streaming responses and SSE.
"""

import json
import os
import time
from urllib.parse import urlsplit

from starlette.concurrency import run_in_threadpool
from starlette.requests import HTTPConnection
from starlette.types import ASGIApp, Receive, Scope, Send

from app.database import SessionLocal
from app.services import auth as svc

SESSION_COOKIE = "parallax_session"

# The ONLY unauthenticated API routes: liveness plus the bootstrap routes the login page needs.
PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/health"),
        ("GET", "/api/auth/status"),
        ("POST", "/api/auth/setup"),
        ("POST", "/api/auth/login"),
    }
)

_PROTECTED_PREFIXES = ("/api", "/docs", "/redoc", "/openapi.json")
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_COOKIE_SCHEME = {"type": "apiKey", "in": "cookie", "name": SESSION_COOKIE}


def auth_enabled() -> bool:
    """`PARALLAX_AUTH=off` turns authentication off; anything else (or unset) leaves it on.
    Read on every call so a test or an operator's restart picks the change up."""
    return os.environ.get("PARALLAX_AUTH", "on").strip().lower() != "off"


def is_protected_path(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in _PROTECTED_PREFIXES)


def _same_origin(conn: HTTPConnection) -> bool:
    """A state-changing request that names an Origin must name this host. No Origin (curl,
    scripts, same-origin GET-like navigations) passes. Defence in depth on top of SameSite=Lax."""
    origin = conn.headers.get("origin")
    if origin is None:
        return True
    expected = (conn.headers.get("x-forwarded-host") or conn.headers.get("host") or "").split(",")[
        0
    ]
    return urlsplit(origin).netloc.casefold() == expected.strip().casefold()


def _resolve(token: str | None) -> tuple[svc.Resolved | None, bool]:
    """Look the cookie up in a short-lived session (closed before the request proceeds)."""
    if not token:
        return None, False
    with SessionLocal() as db:
        resolved = svc.resolve_session(db, token)
    return resolved, bool(resolved and resolved.needs_touch)


def _touch(session_id: int) -> None:
    with SessionLocal() as db:
        svc.touch_session(db, session_id)


async def _send_json(send: Send, status: int, body: dict) -> None:
    payload = json.dumps(body).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": payload})


_now = time.monotonic
# How often a response that is still streaming re-checks that its session exists. A stream
# (SSE) is checked when it connects, so without this it would outlive a sign-out.
RECHECK_SECONDS = 5.0


class SessionRevoked(Exception):
    """Raised inside a streaming response when its session no longer exists."""


def _stop_when_revoked(send: Send, token: str | None) -> Send:
    last_check = _now()

    async def guarded(message):
        nonlocal last_check
        if message["type"] == "http.response.body" and message.get("more_body"):
            current = _now()
            if current - last_check >= RECHECK_SECONDS:
                last_check = current
                if _resolve(token)[0] is None:
                    raise SessionRevoked
        await send(message)

    return guarded


class AuthMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope["type"]
        if kind not in ("http", "websocket") or not auth_enabled():
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        if not is_protected_path(path):
            await self.app(scope, receive, send)
            return

        conn = HTTPConnection(scope)
        method = scope.get("method", "GET")
        if kind == "http" and method in _UNSAFE_METHODS and not _same_origin(conn):
            await _send_json(
                send,
                403,
                {
                    "detail": "Cross-origin request refused. Behind a reverse proxy, "
                    "make it pass the original Host header."
                },
            )
            return

        # Not read from the request's own state before this point, so a client cannot forge it.
        state = scope.setdefault("state", {})
        state.pop("auth_user", None)
        state.pop("auth_session_id", None)
        token = conn.cookies.get(SESSION_COOKIE)
        resolved, needs_touch = _resolve(token)
        if resolved is not None:
            state["auth_user"] = resolved.username
            state["auth_session_id"] = resolved.session_id
            if needs_touch:
                await run_in_threadpool(_touch, resolved.session_id)
            if kind == "http":
                send = _stop_when_revoked(send, token)
        elif (method, path) not in PUBLIC_ROUTES:
            if kind == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                await _send_json(send, 401, {"detail": "Not authenticated"})
            return
        try:
            await self.app(scope, receive, send)
        except SessionRevoked:
            # A live stream whose session ended: the response just stops. The browser's
            # EventSource errors, reconnects, gets a 401 and the app shows the login page.
            return


def install_openapi_security(app) -> None:
    """Describe the cookie in the generated spec (and so in the public API reference)."""
    original = app.openapi

    def openapi():
        schema = original()
        schema.setdefault("components", {}).setdefault("securitySchemes", {})["cookieAuth"] = (
            _COOKIE_SCHEME
        )
        schema["security"] = [{"cookieAuth": []}]
        for method, path in PUBLIC_ROUTES:
            op = schema.get("paths", {}).get(path, {}).get(method.lower())
            if op is not None:
                op["security"] = []
        return schema

    app.openapi = openapi
