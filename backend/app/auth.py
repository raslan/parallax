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
from http.cookies import SimpleCookie

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


def _from_foreign_site(conn: HTTPConnection) -> bool:
    """True when the browser says a request came from another site (or another origin of the
    same site, e.g. a sibling subdomain).

    Browsers label every request with `Sec-Fetch-Site`: `same-origin` for our own pages, `none`
    for the address bar, `same-site`/`cross-site` otherwise. The label is set by the browser,
    so it does not depend on the Host header, which reverse proxies (a stock nginx `proxy_pass`)
    often rewrite. Curl and scripts send no label and pass. Defence in depth on top of the
    cookie's SameSite=Lax."""
    return conn.headers.get("sec-fetch-site") in ("cross-site", "same-site")


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


def _session_cookie_header(token: str, secure: bool) -> bytes:
    cookie = SimpleCookie()
    cookie[SESSION_COOKIE] = token
    morsel = cookie[SESSION_COOKIE]
    morsel["path"] = "/"
    morsel["max-age"] = str(svc.SESSION_DAYS * 24 * 3600)
    morsel["httponly"] = True
    morsel["samesite"] = "lax"
    if secure:
        morsel["secure"] = True
    return morsel.OutputString().encode("latin-1")


def _is_https(scope: Scope) -> bool:
    forwarded = ""
    for name, value in scope.get("headers", []):
        if name == b"x-forwarded-proto":
            forwarded = value.decode("latin-1").split(",")[0].strip().lower()
    return scope.get("scheme") == "https" or forwarded == "https"


def _guard_response(send: Send, scope: Scope, token: str | None, reissue: bool) -> Send:
    """Wrap `send` for a signed-in request.

    - `reissue`: the server just slid the session's expiry, so hand the browser a fresh cookie
      too, or it would drop the cookie 30 days after sign-in however often it is used.
    - While a response keeps streaming (SSE), re-check every few seconds that the session still
      exists, and end the response when it is gone.
    """
    last_check = _now()

    async def guarded(message):
        nonlocal last_check
        if message["type"] == "http.response.start" and reissue and token:
            headers = list(message.get("headers", []))
            headers.append((b"set-cookie", _session_cookie_header(token, _is_https(scope))))
            message = {**message, "headers": headers}
        elif message["type"] == "http.response.body" and message.get("more_body"):
            current = _now()
            if current - last_check >= RECHECK_SECONDS:
                last_check = current
                resolved, _ = await run_in_threadpool(_resolve, token)
                if resolved is None:
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
        if kind == "http" and method in _UNSAFE_METHODS and _from_foreign_site(conn):
            await _send_json(send, 403, {"detail": "Cross-site request refused"})
            return

        # Not read from the request's own state before this point, so a client cannot forge it.
        state = scope.setdefault("state", {})
        state.pop("auth_user", None)
        state.pop("auth_session_id", None)
        token = conn.cookies.get(SESSION_COOKIE)
        # In the threadpool: the lookup can wait on the connection pool or SQLite's write lock,
        # and must never freeze the event loop (every request and stream shares it).
        resolved, needs_touch = await run_in_threadpool(_resolve, token)
        if resolved is not None:
            state["auth_user"] = resolved.username
            state["auth_session_id"] = resolved.session_id
            if needs_touch:
                await run_in_threadpool(_touch, resolved.session_id)
            if kind == "http":
                send = _guard_response(send, scope, token, reissue=needs_touch)
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
        except BaseExceptionGroup as group:
            # Some Starlette versions run a streaming response in a task group, which wraps
            # what `send` raised.
            _, rest = group.split(SessionRevoked)
            if rest is not None:
                raise rest from None


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
