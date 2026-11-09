"""A response that is still streaming (SSE) stops once its session is gone."""

import asyncio

from app import auth
from app.services.auth import Resolved


def _run(valid_after_first: bool):
    now = [1000.0]
    calls = []

    def fake_resolve(token):
        calls.append(token)
        ok = len(calls) == 1 or valid_after_first
        return (Resolved(1, "owner", False) if ok else None), False

    sent = []

    async def downstream_app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        for i in range(4):
            now[0] += 10  # well past the re-check interval
            await send({"type": "http.response.body", "body": b"x", "more_body": True})
            sent.append(i)
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    out = []

    async def send(message):
        out.append(message)

    async def receive():
        return {"type": "http.request"}

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/jobs/stream",
        "headers": [(b"cookie", b"parallax_session=abc")],
        "query_string": b"",
    }
    mw = auth.AuthMiddleware(downstream_app)
    return mw, scope, receive, send, out, sent, fake_resolve, now


def test_stream_continues_while_the_session_is_valid(monkeypatch):
    mw, scope, receive, send, out, sent, fake_resolve, now = _run(valid_after_first=True)
    monkeypatch.setattr(auth, "_resolve", fake_resolve)
    monkeypatch.setattr(auth, "_now", lambda: now[0])
    asyncio.run(mw(scope, receive, send))
    assert sent == [0, 1, 2, 3]
    assert out[-1]["more_body"] is False


def test_stream_stops_when_the_session_is_revoked(monkeypatch):
    mw, scope, receive, send, out, sent, fake_resolve, now = _run(valid_after_first=False)
    monkeypatch.setattr(auth, "_resolve", fake_resolve)
    monkeypatch.setattr(auth, "_now", lambda: now[0])
    asyncio.run(mw(scope, receive, send))  # ends quietly, no exception
    assert sent == []  # the very first chunk after the revocation is refused
    assert all(m.get("more_body") is not False for m in out[1:])  # never completes


def test_session_is_not_rechecked_on_every_chunk(monkeypatch):
    mw, scope, receive, send, out, sent, fake_resolve, now = _run(valid_after_first=True)
    calls = []

    def counting(token):
        calls.append(1)
        return fake_resolve(token)

    monkeypatch.setattr(auth, "_resolve", counting)
    # The clock never moves, so only the initial lookup happens.
    monkeypatch.setattr(auth, "_now", lambda: 1000.0)
    asyncio.run(mw(scope, receive, send))
    assert len(calls) == 1
