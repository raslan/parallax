import pytest

from app.services import auth as svc

# The account the `client` fixture (conftest.py) creates and signs in.
TEST_USERNAME = "tester"
TEST_PASSWORD = "test-password-123"
PASSPHRASE = "correct horse battery staple"


def _setup(c, username="owner", password=PASSPHRASE, **kw):
    return c.post("/api/auth/setup", json={"username": username, "password": password}, **kw)


def test_status_before_setup(anon_client):
    r = anon_client.get("/api/auth/status")
    assert r.status_code == 200
    assert r.json() == {
        "enabled": True,
        "configured": False,
        "authenticated": False,
        "username": None,
    }


def test_setup_signs_in_and_sets_cookie(anon_client):
    r = _setup(anon_client)
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "parallax_session=" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "max-age=2592000" in cookie
    assert "path=/" in cookie
    assert "secure" not in cookie
    status = anon_client.get("/api/auth/status").json()
    assert status["authenticated"] is True and status["username"] == "owner"
    assert anon_client.get("/api/libraries").status_code == 200


def test_cookie_is_secure_behind_https_proxy(anon_client):
    r = _setup(anon_client, headers={"X-Forwarded-Proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_second_setup_is_409(anon_client):
    assert _setup(anon_client).status_code == 200
    assert _setup(anon_client, username="mallory").status_code == 409


def test_lowercase_passphrase_is_accepted(anon_client):
    assert _setup(anon_client, password="four plain lowercase words").status_code == 200


@pytest.mark.parametrize(
    "username,password",
    [("owner", "a" * 7), ("owner", "a" * 129), ("", PASSPHRASE), ("   ", PASSPHRASE)]
    + [("x" * 65, PASSPHRASE)],
)
def test_setup_validates_lengths(anon_client, username, password):
    assert _setup(anon_client, username=username, password=password).status_code == 422


def test_login_success_and_generic_failure(anon_client):
    _setup(anon_client)
    anon_client.cookies.clear()
    bad_user = anon_client.post("/api/auth/login", json={"username": "x", "password": PASSPHRASE})
    bad_pw = anon_client.post(
        "/api/auth/login", json={"username": "owner", "password": "nope nope"}
    )
    assert bad_user.status_code == bad_pw.status_code == 401
    assert bad_user.json() == bad_pw.json() == {"detail": "Incorrect username or password"}
    ok = anon_client.post("/api/auth/login", json={"username": "OWNER", "password": PASSPHRASE})
    assert ok.status_code == 200
    assert anon_client.get("/api/auth/status").json()["authenticated"] is True


def test_login_throttle_returns_429_with_retry_after(anon_client):
    _setup(anon_client)
    anon_client.cookies.clear()
    for _ in range(svc.LoginThrottle.FREE_FAILURES):
        anon_client.post("/api/auth/login", json={"username": "owner", "password": "wrong wrong"})
    r = anon_client.post("/api/auth/login", json={"username": "owner", "password": PASSPHRASE})
    assert r.status_code == 429
    assert r.headers["retry-after"] == "1"
    assert "Try again" in r.json()["detail"]


def test_logout_ends_only_this_session(client):
    from fastapi.testclient import TestClient

    from app.main import app

    other = TestClient(app)
    login = other.post(
        "/api/auth/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/libraries").status_code == 401
    assert other.get("/api/libraries").status_code == 200


def test_logout_all(client):
    r = client.post("/api/auth/logout-all")
    assert r.status_code == 204
    assert client.get("/api/libraries").status_code == 401


def test_account_wrong_current_password_is_403_not_401(client):
    r = client.patch(
        "/api/auth/account", json={"current_password": "nope nope", "new_username": "zed"}
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Current password is incorrect"


def test_account_needs_a_change(client):
    r = client.patch("/api/auth/account", json={"current_password": TEST_PASSWORD})
    assert r.status_code == 422


def test_account_username_change(client):
    r = client.patch(
        "/api/auth/account", json={"current_password": TEST_PASSWORD, "new_username": "zed"}
    )
    assert r.status_code == 200
    assert client.get("/api/auth/status").json()["username"] == "zed"


def test_password_change_keeps_this_session_and_drops_others(client):
    from fastapi.testclient import TestClient

    from app.main import app

    other = TestClient(app)
    other_cookie = other.post(
        "/api/auth/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD}
    ).cookies["parallax_session"]
    r = client.patch(
        "/api/auth/account",
        json={"current_password": TEST_PASSWORD, "new_password": "a brand new passphrase"},
    )
    assert r.status_code == 200
    assert client.get("/api/libraries").status_code == 200
    other.cookies.set("parallax_session", other_cookie)
    assert other.get("/api/libraries").status_code == 401


@pytest.mark.parametrize("site", ["cross-site", "same-site"])
def test_csrf_a_foreign_site_is_refused(client, site):
    r = client.post("/api/auth/logout-all", headers={"Sec-Fetch-Site": site})
    assert r.status_code == 403
    assert client.get("/api/libraries").status_code == 200  # not signed out


@pytest.mark.parametrize("site", ["same-origin", "none"])
def test_csrf_our_own_pages_pass(client, site):
    r = client.patch(
        "/api/auth/account",
        json={"current_password": TEST_PASSWORD, "new_username": "a"},
        headers={"Sec-Fetch-Site": site},
    )
    assert r.status_code == 200


def test_csrf_scripts_without_the_header_pass(client):
    assert client.post("/api/auth/logout-all").status_code == 204


def test_csrf_does_not_depend_on_host_or_origin_so_default_nginx_works(client):
    # A proxy that rewrites Host to the upstream name and sends no X-Forwarded-Host: the
    # browser's Origin then never matches Host, which must not matter.
    r = client.post(
        "/api/auth/logout-all",
        headers={
            "Origin": "https://parallax.example",
            "Host": "parallax:7899",
            "Sec-Fetch-Site": "same-origin",
        },
    )
    assert r.status_code == 204


def test_csrf_does_not_block_reads(client):
    r = client.get("/api/libraries", headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 200
