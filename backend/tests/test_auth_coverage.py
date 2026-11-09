"""The default-deny invariant: nothing but the allowlist answers an anonymous request."""

import re

import pytest

from app import auth
from app.main import app, safe_static_file

_PARAM = re.compile(r"\{[^}]+\}")


def _flatten(routes):
    """Every concrete route. Newer FastAPI keeps an included router as one nested entry in
    `app.routes` instead of copying its routes in, so unwrap those."""
    for r in routes:
        if hasattr(r, "effective_candidates"):
            yield from _flatten(r.effective_candidates())
        elif hasattr(r, "starlette_route"):
            yield r.starlette_route
        else:
            yield r


def _protected_routes():
    seen = set()
    for route in _flatten(app.routes):
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if path and methods and auth.is_protected_path(path):
            seen.update((m, path) for m in methods - {"HEAD", "OPTIONS"})
    # Cross-check against the OpenAPI document, which is built independently of the above.
    for path, ops in app.openapi()["paths"].items():
        seen.update((m.upper(), path) for m in ops if auth.is_protected_path(path))
    return sorted(seen)


def _concrete(path: str) -> str:
    return _PARAM.sub("1", path)


def test_the_walk_actually_finds_routes():
    assert len(list(_protected_routes())) > 100


def test_every_route_but_the_allowlist_is_401_anonymously(anon_client):
    # One loop, not one test per route: each test would start the whole app.
    wrong = []
    for method, path in _protected_routes():
        status = anon_client.request(method, _concrete(path)).status_code
        public = (method, path) in auth.PUBLIC_ROUTES
        if (status == 401) == public:
            wrong.append(f"{method} {path} -> {status} ({'public' if public else 'protected'})")
    assert not wrong


def test_the_allowlist_names_real_routes_only():
    real = set(_protected_routes())
    assert auth.PUBLIC_ROUTES <= real


@pytest.mark.parametrize(
    "path",
    [
        "/api/nope",
        "/api",
        "/api/",
        "/api/files/../files",
        "/docs",
        "/docs/oauth2-redirect",
        "/redoc",
        "/openapi.json",
        "/api/jobs/stream",
        "/api/files/1/thumbnail",
        "/api/images/1/thumbnail",
        "/api/stream/hls/abcd1234/master.m3u8",
        "/api/stream/hls/abcd1234/seg_00001.m4s",
        "/api/downloads/1/thumbnail",
        "/api/organize/file?path=/etc/passwd",
    ],
)
def test_sensitive_paths_are_401_anonymously(anon_client, path):
    # Absolute URL, so a leading "//" is a path and not a host.
    r = anon_client.get("http://testserver" + path)
    assert r.status_code == 401
    assert r.json() == {"detail": "Not authenticated"}


def test_signed_in_reaches_docs_and_spec(client):
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 200


def test_spa_shell_is_not_behind_auth(anon_client):
    assert anon_client.get("/").status_code != 401
    assert anon_client.get("/login").status_code != 401
    assert anon_client.get("/some/spa/route").status_code != 401


def test_unknown_api_path_looks_the_same_as_a_real_one(anon_client):
    assert anon_client.get("/api/nope").content == anon_client.get("/api/files").content


def test_bogus_cookie_is_401(anon_client):
    anon_client.cookies.set("parallax_session", "not-a-real-token")
    assert anon_client.get("/api/libraries").status_code == 401


def test_expired_cookie_is_401(client, engine):
    from datetime import timedelta

    from sqlalchemy.orm import sessionmaker

    from app.models.auth import AuthSession
    from app.services.common import now

    s = sessionmaker(bind=engine)()
    s.query(AuthSession).update({"expires_at": now() - timedelta(seconds=1)})
    s.commit()
    s.close()
    assert client.get("/api/libraries").status_code == 401


def test_openapi_describes_cookie_auth(client):
    spec = client.get("/openapi.json").json()
    scheme = spec["components"]["securitySchemes"]["cookieAuth"]
    assert scheme == {"type": "apiKey", "in": "cookie", "name": "parallax_session"}
    assert spec["security"] == [{"cookieAuth": []}]
    assert spec["paths"]["/api/health"]["get"]["security"] == []
    assert spec["paths"]["/api/auth/login"]["post"]["security"] == []


def test_safe_static_file_never_leaves_the_static_dir(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("shell")
    (static / "logo.svg").write_text("svg")
    (tmp_path / "secret.txt").write_text("secret")
    assert safe_static_file(str(static), "logo.svg") == str(static / "logo.svg")
    assert safe_static_file(str(static), "") is None
    assert safe_static_file(str(static), "nope.txt") is None
    assert safe_static_file(str(static), "../secret.txt") is None
    assert safe_static_file(str(static), "/../secret.txt") is None
    assert safe_static_file(str(static), "..%2fsecret.txt") is None
    assert safe_static_file(str(static), str(tmp_path / "secret.txt")) is None
