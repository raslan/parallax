import json
import os

import pytest

from app.services import subtitle_sync as ss

SRT = "1\n00:00:01,000 --> 00:00:02,000\nHi.\n\n"


def touch(path, text=SRT):
    with open(path, "w") as f:
        f.write(text)
    return str(path)


@pytest.fixture
def movie(tmp_path):
    video = touch(tmp_path / "Movie.mkv", "video")
    sub = touch(tmp_path / "Movie.en.srt", "first bytes")
    return video, sub


def fake_engine(monkeypatch, text="synced"):
    calls = []

    def run(video_path, sub_path):
        calls.append(sub_path)
        with open(sub_path, "w") as f:
            f.write(text)
        return True

    monkeypatch.setattr(ss, "sync_alass", run)
    monkeypatch.setattr(ss, "sync_ffsubsync", run)
    return calls


def test_first_sync_creates_original_second_does_not_overwrite(movie, monkeypatch):
    video, sub = movie
    calls = fake_engine(monkeypatch)

    assert ss.sync_subtitle(video, sub) is True
    backup = sub.replace(".en.srt", ".en.original.srt")
    assert open(backup).read() == "first bytes"
    assert open(sub).read() == "synced"

    assert ss.sync_subtitle(video, sub) is True
    assert open(backup).read() == "first bytes"
    assert len(calls) == 2
    assert [n for n in os.listdir(os.path.dirname(sub)) if n.endswith(".tmp")] == []


def test_ensure_original_returns_path_then_none(movie):
    _, sub = movie
    assert ss.ensure_original(sub) == sub.replace(".en.srt", ".en.original.srt")
    assert ss.ensure_original(sub) is None


def test_failed_backup_aborts_sync(movie, monkeypatch):
    video, sub = movie
    calls = fake_engine(monkeypatch)

    def boom(src, dst):
        raise OSError("read-only file system")

    monkeypatch.setattr(ss.shutil, "copyfile", boom)
    with pytest.raises(OSError):
        ss.sync_subtitle(video, sub)
    assert calls == []
    assert open(sub).read() == "first bytes"
    assert not os.path.exists(sub.replace(".en.srt", ".en.original.srt"))


def test_restore_original_swaps_back(movie, monkeypatch):
    video, sub = movie
    fake_engine(monkeypatch)
    ss.sync_subtitle(video, sub)
    backup = sub.replace(".en.srt", ".en.original.srt")

    assert ss.restore_original(video, sub) is True
    assert open(sub).read() == "first bytes"
    assert not os.path.exists(backup)


def test_restore_original_refuses_foreign_and_missing_backup(movie, tmp_path):
    from app.services.subtitle_files import SubtitleFileError

    video, sub = movie
    with pytest.raises(SubtitleFileError):
        ss.restore_original(video, sub)  # no backup yet
    with pytest.raises(SubtitleFileError):
        ss.restore_original(video, "/etc/passwd")
    with pytest.raises(SubtitleFileError):
        ss.restore_original(video, video)


def test_engine_defaults_to_setting_and_override_wins(client, engine, movie, monkeypatch):
    video, sub = movie
    seen = []

    async def fake_enqueue(job_id, fn, *args):
        seen.append(args)

    monkeypatch.setattr("app.api.subtitles.enqueue", fake_enqueue)
    client.patch("/api/settings", json={"subtitle_sync_engine": "ffsubsync"})

    r = client.post("/api/subtitles/sync-file", json={"file_path": video})
    assert r.status_code == 200
    assert seen[-1][1] == [(video, sub)] and seen[-1][2] == "ffsubsync"

    r = client.post(
        "/api/subtitles/sync-file",
        json={"file_path": video, "subtitle_path": sub, "engine": "alass"},
    )
    assert r.status_code == 200
    assert seen[-1][2] == "alass"

    from sqlalchemy.orm import sessionmaker

    from app.models.job import Job

    db = sessionmaker(bind=engine)()
    try:
        job = db.get(Job, r.json()["job_id"])
        assert json.loads(job.settings) == {"path": os.path.dirname(video)}
    finally:
        db.close()

    r = client.post(
        "/api/subtitles/sync-file",
        json={"file_path": video, "subtitle_path": "/etc/passwd"},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "That is not a subtitle of this video."
    r = client.post("/api/subtitles/sync-file", json={"file_path": video, "engine": "nope"})
    assert r.status_code == 422


def test_restore_original_route(client, movie, monkeypatch):
    video, sub = movie
    fake_engine(monkeypatch)
    ss.sync_subtitle(video, sub)
    r = client.post(
        "/api/subtitles/restore-original", json={"video_path": video, "subtitle_path": sub}
    )
    assert r.status_code == 200
    assert open(sub).read() == "first bytes"
    r = client.post(
        "/api/subtitles/restore-original", json={"video_path": video, "subtitle_path": sub}
    )
    assert r.status_code == 404


def test_settings_no_longer_has_auto_sync(client):
    assert "subtitle_auto_sync" not in client.get("/api/settings").json()
    r = client.patch("/api/settings", json={"subtitle_auto_sync": True})
    assert r.status_code == 200  # unknown fields are ignored by the model
    assert "subtitle_auto_sync" not in r.json()
