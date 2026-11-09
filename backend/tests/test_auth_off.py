def test_auth_off_opens_everything(anon_client, monkeypatch):
    monkeypatch.setenv("PARALLAX_AUTH", "off")
    assert anon_client.get("/api/libraries").status_code == 200
    assert anon_client.get("/openapi.json").status_code == 200
    r = anon_client.get("/api/auth/status")
    assert r.json()["enabled"] is False
    assert r.json()["authenticated"] is False


def test_auth_off_makes_account_routes_409(anon_client, monkeypatch):
    monkeypatch.setenv("PARALLAX_AUTH", "off")
    creds = {"username": "owner", "password": "correct horse battery"}
    assert anon_client.post("/api/auth/setup", json=creds).status_code == 409
    assert anon_client.post("/api/auth/login", json=creds).status_code == 409
    r = anon_client.patch("/api/auth/account", json={"current_password": "x", "new_username": "y"})
    assert r.status_code == 409


def test_auth_off_skips_the_cross_site_check(anon_client, monkeypatch):
    monkeypatch.setenv("PARALLAX_AUTH", "off")
    r = anon_client.post("/api/auth/logout", headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 204


def test_anything_but_off_means_on(anon_client, monkeypatch):
    monkeypatch.setenv("PARALLAX_AUTH", "yes")
    assert anon_client.get("/api/libraries").status_code == 401
