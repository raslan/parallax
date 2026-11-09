"""Fixes from the whole-branch review: sliding cookie, no blocking DB on the event loop,
serialised logins, throttled account changes, clean stream shutdown, bounded password."""

import asyncio
import threading
from datetime import timedelta

import pytest
from sqlalchemy.orm import sessionmaker
from starlette.responses import StreamingResponse

from app import auth
from app.models.auth import AuthSession, User
from app.services import auth as svc
from app.services.common import now

# ── 1. the browser cookie slides along with the server-side expiry ─────────────────────────


def test_cookie_is_reissued_when_the_session_is_extended(client, engine):
    token = client.cookies.get("parallax_session")
    s = sessionmaker(bind=engine)()
    s.query(AuthSession).update({"last_seen_at": now() - timedelta(hours=2)})
    s.commit()
    s.close()
    r = client.get("/api/libraries")
    assert r.status_code == 200
    header = r.headers["set-cookie"].lower()
    assert f"parallax_session={token}".lower() in header
    assert "max-age=2592000" in header
    assert "httponly" in header and "samesite=lax" in header


def test_cookie_is_not_resent_on_every_request(client):
    r = client.get("/api/libraries")
    assert "set-cookie" not in r.headers


def test_reissued_cookie_is_secure_behind_https_proxy(client, engine):
    s = sessionmaker(bind=engine)()
    s.query(AuthSession).update({"last_seen_at": now() - timedelta(hours=2)})
    s.commit()
    s.close()
    r = client.get("/api/libraries", headers={"X-Forwarded-Proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()


# ── 2. the session lookup never runs on the event loop ─────────────────────────────────────


def test_session_lookup_runs_off_the_event_loop(monkeypatch):
    loop_thread = threading.get_ident()
    seen = []
    now_value = [1000.0]

    def fake_resolve(token):
        seen.append(threading.get_ident())
        return svc.Resolved(1, "owner", False), False

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        now_value[0] += 10
        await send({"type": "http.response.body", "body": b"x", "more_body": True})
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    async def receive():
        return {"type": "http.request"}

    async def send(_m):
        pass

    monkeypatch.setattr(auth, "_resolve", fake_resolve)
    monkeypatch.setattr(auth, "_now", lambda: now_value[0])
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/jobs/stream",
        "headers": [(b"cookie", b"parallax_session=abc")],
        "query_string": b"",
    }
    asyncio.run(auth.AuthMiddleware(app)(scope, receive, send))
    assert len(seen) == 2  # on arrival, and once more mid-stream
    assert all(t != loop_thread for t in seen)


# ── 3 + 4. logins and account changes are serialised and share the throttle ───────────────


@pytest.fixture
def account(engine):
    Session = sessionmaker(bind=engine)
    s = Session()
    s.add(User(id=1, username="alice", password_hash=svc.hash_password("the right passphrase")))
    s.commit()
    s.close()
    yield Session
    s = Session()
    s.query(AuthSession).delete()
    s.query(User).delete()
    s.commit()
    s.close()


def test_concurrent_logins_cannot_outrun_the_throttle(account):
    results = []

    def attempt():
        db = account()
        try:
            svc.login(db, "alice", "a wrong passphrase")
            results.append("ok")
        except svc.Throttled:
            results.append("throttled")
        except svc.InvalidCredentials:
            results.append("invalid")
        finally:
            db.close()

    threads = [threading.Thread(target=attempt) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 0
    assert results.count("invalid") == svc.LoginThrottle.FREE_FAILURES
    assert results.count("throttled") == 12 - svc.LoginThrottle.FREE_FAILURES


def test_account_changes_are_throttled_too(account):
    db = account()
    sid = svc.resolve_session(db, svc.create_session(db)).session_id
    for _ in range(svc.LoginThrottle.FREE_FAILURES):
        with pytest.raises(svc.WrongPassword):
            svc.update_account(db, sid, "not the passphrase", "bob", None)
    with pytest.raises(svc.Throttled):
        svc.update_account(db, sid, "the right passphrase", "bob", None)  # even the right one
    db.close()


def test_a_right_current_password_resets_the_throttle(account):
    db = account()
    sid = svc.resolve_session(db, svc.create_session(db)).session_id
    for _ in range(3):
        with pytest.raises(svc.WrongPassword):
            svc.update_account(db, sid, "nope nope nope", "bob", None)
    svc.update_account(db, sid, "the right passphrase", "bob", None)
    assert svc.THROTTLE.failures == 0
    db.close()


# ── 6. a revoked real streaming response ends without an error ─────────────────────────────


def test_revoked_streaming_response_ends_quietly(monkeypatch):
    now_value = [1000.0]
    calls = []

    def fake_resolve(token):
        calls.append(1)
        return (svc.Resolved(1, "owner", False) if len(calls) == 1 else None), False

    async def chunks():
        for i in range(5):
            now_value[0] += 10
            yield f"data: {i}\n\n".encode()
            await asyncio.sleep(0)

    async def app(scope, receive, send):
        await StreamingResponse(chunks(), media_type="text/event-stream")(scope, receive, send)

    sent = []

    async def send(m):
        sent.append(m)

    async def receive():
        await asyncio.sleep(3600)  # a client that stays connected

    monkeypatch.setattr(auth, "_resolve", fake_resolve)
    monkeypatch.setattr(auth, "_now", lambda: now_value[0])
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/jobs/stream",
        "headers": [(b"cookie", b"parallax_session=abc")],
        "query_string": b"",
    }
    asyncio.run(auth.AuthMiddleware(app)(scope, receive, send))  # must not raise
    bodies = [m for m in sent if m["type"] == "http.response.body" and m.get("body")]
    assert len(bodies) < 5


# ── 10. a login password has an upper bound ───────────────────────────────────────────────


def test_login_rejects_an_absurdly_long_password(anon_client):
    r = anon_client.post("/api/auth/login", json={"username": "owner", "password": "x" * 5000})
    assert r.status_code == 422
