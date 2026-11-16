"""`POST /subtitles/sync-files`: many videos, one sync job."""

import json
import os

import pytest

from app.models.job import Job, JobStatus, JobType
from app.services import subtitle_sync as ss
from app.services.common import request_cancel

SRT = "1\n00:00:01,000 --> 00:00:02,000\nHi.\n\n"


def make(folder, name, subs=("en",)):
    video = folder / f"{name}.mkv"
    video.write_bytes(b"v")
    for tag in subs:
        (folder / f"{name}.{tag}.srt").write_text(SRT)
    return str(video)


@pytest.fixture
def queued(monkeypatch):
    calls = []

    async def fake_enqueue(*a):
        calls.append(a)

    monkeypatch.setattr("app.api.subtitles.enqueue", fake_enqueue)
    return calls


def test_sync_files_creates_one_job(client, tmp_path, queued):
    a = make(tmp_path, "A")
    b = make(tmp_path, "B", subs=("en", "ar.generated"))
    r = client.post(
        "/api/subtitles/sync-files",
        json={"video_paths": [a, b, a], "path": str(tmp_path), "engine": "ffsubsync"},
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert len(queued) == 1
    assert queued[0][0] == job_id
    assert queued[0][2:] == (job_id, [a, b], "ffsubsync")
    jobs = client.get("/api/jobs").json()
    job = next(j for j in jobs if j["id"] == job_id)
    assert job["type"] == JobType.SUBTITLE_SYNC
    settings = json.loads(job["settings"])
    assert settings == {"path": str(tmp_path), "video_paths": [a, b], "engine": "ffsubsync"}


def test_sync_files_engine_defaults_to_setting(client, tmp_path, queued):
    a = make(tmp_path, "A")
    client.patch("/api/settings", json={"subtitle_sync_engine": "ffsubsync"})
    r = client.post("/api/subtitles/sync-files", json={"video_paths": [a]})
    assert r.status_code == 200
    assert queued[0][-1] == "ffsubsync"


def test_sync_files_rejects_non_video(client, tmp_path, queued):
    a = make(tmp_path, "A")
    notes = tmp_path / "notes.txt"
    notes.write_text("x")
    for paths in ([str(notes)], [a, str(tmp_path / "Gone.mkv")], [str(tmp_path)]):
        r = client.post("/api/subtitles/sync-files", json={"video_paths": paths})
        assert r.status_code == 400, paths
    r = client.post("/api/subtitles/sync-files", json={"video_paths": []})
    assert r.status_code == 422
    r = client.post("/api/subtitles/sync-files", json={"video_paths": [a] * 1} | {"path": a})
    assert r.status_code == 400  # `path` must be a folder
    many = [make(tmp_path, f"V{i}", subs=()) for i in range(501)]
    r = client.post("/api/subtitles/sync-files", json={"video_paths": many})
    assert r.status_code == 400
    bare = make(tmp_path, "Bare", subs=())
    r = client.post("/api/subtitles/sync-files", json={"video_paths": [bare]})
    assert r.status_code == 422  # nothing to sync at all
    assert queued == []


def _job(fs_db, settings) -> int:
    db = fs_db()
    job = Job(type=JobType.SUBTITLE_SYNC, status=JobStatus.PENDING, settings=json.dumps(settings))
    db.add(job)
    db.commit()
    jid = job.id
    db.close()
    return jid


def _state(fs_db, jid):
    db = fs_db()
    job = db.get(Job, jid)
    out = (job.status, job.current_file, job.error, json.loads(job.settings or "{}"))
    db.close()
    return out


def test_sync_files_cancel_and_isolated_failure(tmp_path, fs_db, monkeypatch):
    a = make(tmp_path, "A", subs=("en", "ar.translated"))
    b = make(tmp_path, "B")
    c = make(tmp_path, "C")
    d = make(tmp_path, "D")
    seen = []

    def fake_sync(video_path, sub_path, engine="alass"):
        seen.append((sub_path, engine))
        if video_path == b:
            raise RuntimeError("alass could not read the audio")
        return True

    monkeypatch.setattr(ss, "sync_subtitle", fake_sync)
    jid = _job(fs_db, {"path": str(tmp_path)})
    ss.run_sync_files_job(jid, [a, b, c], "alass")
    status, current, _err, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED
    assert current == "2 synced, 1 failed"
    results = settings["results"]
    assert [r["status"] for r in results] == ["synced", "failed", "synced"]
    assert results[0]["synced"] == 2  # every subtitle of the video, machine-made too
    assert results[1]["error"] == "alass could not read the audio"
    assert settings["path"] == str(tmp_path)
    assert all(e == "alass" for _, e in seen)

    def cancel_after_first(video_path, sub_path, engine="alass"):
        request_cancel(jid2)
        return True

    monkeypatch.setattr(ss, "sync_subtitle", cancel_after_first)
    jid2 = _job(fs_db, {"path": str(tmp_path)})
    ss.run_sync_files_job(jid2, [c, d], "alass")
    status, current, _err, settings = _state(fs_db, jid2)
    assert status == JobStatus.CANCELLED
    assert current == "1 of 2 done before cancel"
    assert [r["status"] for r in settings["results"]] == ["synced", "skipped"]


def _logs(fs_db, jid):
    from app.models.job import JobLog

    db = fs_db()
    rows = [
        (r.level, r.message) for r in db.query(JobLog).filter_by(job_id=jid).order_by(JobLog.id)
    ]
    db.close()
    return rows


def test_sync_files_logs_each_subtitle_and_keeps_every_error(tmp_path, fs_db, monkeypatch):
    a = make(tmp_path, "A", subs=("en", "ar", "fr"))

    def half(video_path, sub_path, engine="alass"):
        if sub_path.endswith(".en.srt"):
            return True
        raise RuntimeError(f"no speech found for {os.path.basename(sub_path)}")

    monkeypatch.setattr(ss, "sync_subtitle", half)
    jid = _job(fs_db, {"path": str(tmp_path)})
    ss.run_sync_files_job(jid, [a], "alass")
    logs = _logs(fs_db, jid)
    assert ("info", "Synced: A.en.srt") in logs
    assert ("error", "Sync failed: A.ar.srt — no speech found for A.ar.srt") in logs
    assert ("error", "Sync failed: A.fr.srt — no speech found for A.fr.srt") in logs
    result = _state(fs_db, jid)[3]["results"][0]
    assert result["synced"] == 1 and result["failed"] == 2
    assert result["errors"] == [
        "A.ar.srt: no speech found for A.ar.srt",
        "A.fr.srt: no speech found for A.fr.srt",
    ]


def test_sync_files_video_without_subtitles_is_skipped(tmp_path, fs_db, monkeypatch):
    a = make(tmp_path, "A")
    bare = make(tmp_path, "Bare", subs=())
    monkeypatch.setattr(ss, "sync_subtitle", lambda v, s, engine="alass": True)
    jid = _job(fs_db, {"path": str(tmp_path)})
    ss.run_sync_files_job(jid, [a, bare], "alass")
    status, current, _err, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED
    assert [r["status"] for r in settings["results"]] == ["synced", "skipped"]
    assert settings["results"][1]["reason"] == "no subtitle"
    assert current == "1 synced, 1 skipped"
    assert ("info", "Skipped: Bare.mkv — no subtitle") in _logs(fs_db, jid)


def test_sync_files_every_video_failing_fails_the_job(tmp_path, fs_db, monkeypatch):
    a = make(tmp_path, "A")

    def boom(video_path, sub_path, engine="alass"):
        raise RuntimeError("no audio stream")

    monkeypatch.setattr(ss, "sync_subtitle", boom)
    jid = _job(fs_db, {"path": None})
    ss.run_sync_files_job(jid, [a], "alass")
    status, _cur, err, settings = _state(fs_db, jid)
    assert status == JobStatus.FAILED
    assert err == "no audio stream"
    assert settings["results"][0]["status"] == "failed"
