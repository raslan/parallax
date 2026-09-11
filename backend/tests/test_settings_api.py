def test_get_settings_includes_detected_gpus_empty(client, monkeypatch):
    import app.api.settings as settings_api

    monkeypatch.setattr(settings_api, "detect_gpus", lambda: [])

    r = client.get("/api/settings")

    assert r.status_code == 200
    assert r.json()["detected_gpus"] == []


def test_get_settings_includes_detected_gpus_populated(client, monkeypatch):
    import app.api.settings as settings_api
    from app.services.gpu_pool import GPUDevice

    monkeypatch.setattr(
        settings_api,
        "detect_gpus",
        lambda: [
            GPUDevice(vendor="nvidia", index="0", label="RTX 5060 Ti", family="nvenc"),
            GPUDevice(vendor="nvidia", index="1", label="RTX 5060 Ti", family="nvenc"),
        ],
    )

    r = client.get("/api/settings")

    assert r.status_code == 200
    assert r.json()["detected_gpus"] == [
        {"vendor": "nvidia", "label": "RTX 5060 Ti"},
        {"vendor": "nvidia", "label": "RTX 5060 Ti"},
    ]


def test_patch_settings_accepts_concurrency_above_old_ceiling(client):
    r = client.patch("/api/settings", json={"max_concurrent_transcodes": 12})

    assert r.status_code == 200
    assert r.json()["max_concurrent_transcodes"] == 12


def test_patch_settings_rejects_above_new_ceiling(client):
    r = client.patch("/api/settings", json={"max_concurrent_transcodes": 33})

    assert r.status_code == 422
