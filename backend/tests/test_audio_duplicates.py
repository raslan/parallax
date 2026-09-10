import json

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.job import Job, JobStatus, JobType
from app.services import audio_duplicates as ad


@pytest.fixture
def seeded(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = AudioLibrary(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()

    def mk(name: str, fp: str | None) -> int:
        p = tmp_path / name
        p.write_bytes(b"x")
        row = AudioFile(
            library_id=lib.id,
            path=str(p),
            filename=name,
            extension=".mp3",
            size=1,
            duration=60.0,
            audio_fingerprint=fp,
        )
        db.add(row)
        db.commit()
        return row.id

    a = mk("a.mp3", None)
    b = mk("b.mp3", None)
    already = mk("c.mp3", "[9, 9, 9]")
    job = Job(type=JobType.AUDIO_DUPLICATES, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    out = (lib.id, job.id, a, b, already)
    db.close()
    return out


def test_extract_only_touches_null_rows(seeded, engine, monkeypatch):
    lib_id, job_id, a, b, already = seeded
    monkeypatch.setattr(ad, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(ad, "compute_audio_fingerprint", lambda path, job_id=None: [1, 2, 3])

    ad.extract_audio_fingerprints(lib_id, job_id)

    Session = sessionmaker(bind=engine)
    db = Session()
    assert json.loads(db.get(AudioFile, a).audio_fingerprint) == [1, 2, 3]
    assert json.loads(db.get(AudioFile, b).audio_fingerprint) == [1, 2, 3]
    assert db.get(AudioFile, already).audio_fingerprint == "[9, 9, 9]"  # untouched
    assert db.get(Job, job_id).status == JobStatus.COMPLETED
    db.close()


def test_extract_leaves_null_on_none_result(seeded, engine, monkeypatch):
    lib_id, job_id, a, b, _already = seeded
    monkeypatch.setattr(ad, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(ad, "compute_audio_fingerprint", lambda path, job_id=None: None)

    ad.extract_audio_fingerprints(lib_id, job_id)

    Session = sessionmaker(bind=engine)
    db = Session()
    assert db.get(AudioFile, a).audio_fingerprint is None
    assert db.get(AudioFile, b).audio_fingerprint is None
    db.close()


def test_extract_honours_cancel(seeded, engine, monkeypatch):
    lib_id, job_id, a, b, _already = seeded
    calls = {"n": 0}
    monkeypatch.setattr(ad, "SessionLocal", sessionmaker(bind=engine))

    def fake_fp(path, job_id=None):
        calls["n"] += 1
        return [1]

    monkeypatch.setattr(ad, "compute_audio_fingerprint", fake_fp)
    monkeypatch.setattr(ad, "should_cancel", lambda jid: calls["n"] >= 1)

    ad.extract_audio_fingerprints(lib_id, job_id)

    Session = sessionmaker(bind=engine)
    db = Session()
    assert db.get(Job, job_id).status == JobStatus.CANCELLED
    db.close()
    assert calls["n"] == 1


def test_find_duplicates_endpoint_guards(client, seeded, engine, tmp_path):
    lib_id, _job_id, *_ = seeded

    # 404 for a missing library
    assert client.post("/api/audio-libraries/999999/find-duplicates").status_code == 404

    # 409 — the seeded library already has a PENDING AUDIO_DUPLICATES job
    assert client.post(f"/api/audio-libraries/{lib_id}/find-duplicates").status_code == 409

    # happy path: a fresh library with a file and no active job → 202 + job id
    Session = sessionmaker(bind=engine)
    db = Session()
    fresh = AudioLibrary(name="fresh", path=str(tmp_path / "fresh"))
    db.add(fresh)
    db.commit()
    p = tmp_path / "fresh.mp3"
    p.write_bytes(b"x")
    db.add(
        AudioFile(
            library_id=fresh.id,
            path=str(p),
            filename="fresh.mp3",
            extension=".mp3",
            size=1,
            duration=60.0,
        )
    )
    db.commit()
    fresh_id = fresh.id
    db.close()

    r = client.post(f"/api/audio-libraries/{fresh_id}/find-duplicates")
    assert r.status_code == 202
    assert "job_id" in r.json()
