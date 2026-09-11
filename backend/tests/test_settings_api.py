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


def test_max_concurrent_jobs_is_independent_of_video_transcodes(client, monkeypatch):
    # max_concurrent_transcodes now means "per GPU" for Compress/Toolbox file
    # scheduling — it must not drive the app-wide job dispatcher anymore.
    import app.api.settings as settings_api

    calls = []
    monkeypatch.setattr(settings_api, "update_max_concurrent", lambda n: calls.append(n))

    r = client.patch("/api/settings", json={"max_concurrent_transcodes": 4})
    assert r.status_code == 200
    assert calls == []

    r2 = client.patch("/api/settings", json={"max_concurrent_jobs": 7})
    assert r2.status_code == 200
    assert r2.json()["max_concurrent_jobs"] == 7
    assert calls == [7]


def test_max_concurrent_audio_transcodes_is_independent(client):
    # Audio Compress/Toolbox always run on CPU — this setting must be
    # separate from the GPU-oriented video transcode concurrency.
    r = client.patch("/api/settings", json={"max_concurrent_audio_transcodes": 5})
    assert r.status_code == 200
    assert r.json()["max_concurrent_audio_transcodes"] == 5

    r2 = client.patch("/api/settings", json={"max_concurrent_transcodes": 9})
    assert r2.status_code == 200
    assert r2.json()["max_concurrent_audio_transcodes"] == 5
