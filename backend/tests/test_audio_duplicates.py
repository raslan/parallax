import json

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.job import Job, JobLog, JobStatus, JobType
from app.services import audio_duplicates as ad


@pytest.fixture
def seeded(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = AudioLibrary(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()

    def mk(name: str, duration: float) -> int:
        p = tmp_path / name
        p.write_bytes(b"x")
        row = AudioFile(
            library_id=lib.id,
            path=str(p),
            filename=name,
            extension=".mp3",
            size=1,
            duration=duration,
        )
        db.add(row)
        db.commit()
        return row.id

    a = mk("a.mp3", 60.0)
    b = mk("b.mp3", 61.0)
    c = mk("c.mp3", 300.0)
    job = Job(type=JobType.AUDIO_DUPLICATES, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    out = (lib.id, job.id, a, b, c)
    db.close()
    return out


CRITERIA = {"use_duration": True, "duration_tolerance": 2.0, "use_audio": True}


def test_writes_shared_audio_for_files_in_a_funnel_group(seeded, engine, monkeypatch):
    lib_id, job_id, a, b, c = seeded
    monkeypatch.setattr(ad, "SessionLocal", sessionmaker(bind=engine))
    seen = {}

    def fake(groups, **kwargs):
        seen["groups"] = [sorted(fid for fid, _ in g) for g in groups]
        seen.update(kwargs)
        kwargs["on_progress"](0.25)
        # What the Jobs page would show right now, from a separate connection.
        other = sessionmaker(bind=engine)()
        mid = other.get(Job, job_id)
        seen["mid"] = (mid.total_files, mid.processed_files, mid.progress)
        other.close()
        kwargs["on_progress"](0.5)
        return {a: [[b, 0.97]], b: [[a, 0.97]]}

    monkeypatch.setattr(ad, "compute_shared_audio", fake)

    ad.find_audio_duplicates(
        lib_id, job_id, {**CRITERIA, "audio_similarity": 0.7, "audio_min_stretch": 12.0}
    )

    # Only the two tracks within 2 s of each other form a group; the 5-minute one is left out.
    assert seen["groups"] == [sorted([a, b])]
    assert (seen["similarity"], seen["min_stretch_s"], seen["kind"]) == (0.7, 12.0, "audio")
    # Mid-run the job counts the 2 tracks being compared (not the library's 3), one of them
    # fingerprinted at a quarter of the way through.
    assert seen["mid"] == (2, 1, 25.0)
    db = sessionmaker(bind=engine)()
    assert json.loads(db.get(AudioFile, a).shared_audio) == [[b, 0.97]]
    assert json.loads(db.get(AudioFile, b).shared_audio) == [[a, 0.97]]
    assert db.get(AudioFile, c).shared_audio is None
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED
    assert job.progress == 100.0
    assert job.processed_files == 2
    db.close()


def test_does_nothing_when_the_audio_criterion_is_off(seeded, engine, monkeypatch):
    lib_id, job_id, *_ = seeded
    monkeypatch.setattr(ad, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(
        ad, "compute_shared_audio", lambda *a, **k: pytest.fail("should not be called")
    )

    ad.find_audio_duplicates(lib_id, job_id, {**CRITERIA, "use_audio": False})

    db = sessionmaker(bind=engine)()
    assert db.get(Job, job_id).status == JobStatus.COMPLETED
    db.close()


def test_a_cancelled_scan_is_marked_cancelled_and_writes_nothing(seeded, engine, monkeypatch):
    lib_id, job_id, a, *_ = seeded
    monkeypatch.setattr(ad, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(ad, "compute_shared_audio", lambda *a, **k: None)

    ad.find_audio_duplicates(lib_id, job_id, CRITERIA)

    db = sessionmaker(bind=engine)()
    assert db.get(Job, job_id).status == JobStatus.CANCELLED
    assert db.get(AudioFile, a).shared_audio is None
    db.close()


def test_a_file_deleted_during_the_run_does_not_fail_it(seeded, engine, monkeypatch):
    lib_id, job_id, a, b, _c = seeded
    monkeypatch.setattr(ad, "SessionLocal", sessionmaker(bind=engine))

    def fake(groups, **kwargs):
        other = sessionmaker(bind=engine)()
        other.delete(other.get(AudioFile, b))  # pruned by the watcher, or deleted by the user
        other.commit()
        other.close()
        return {a: [[b, 0.9]], b: [[a, 0.9]]}

    monkeypatch.setattr(ad, "compute_shared_audio", fake)

    ad.find_audio_duplicates(lib_id, job_id, CRITERIA)

    db = sessionmaker(bind=engine)()
    assert db.get(Job, job_id).status == JobStatus.COMPLETED
    assert json.loads(db.get(AudioFile, a).shared_audio) == [[b, 0.9]]
    assert db.get(AudioFile, b) is None
    db.close()


def test_each_run_replaces_what_the_last_one_measured(seeded, engine, monkeypatch):
    lib_id, job_id, a, b, c = seeded
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(ad, "SessionLocal", Session)
    db = Session()
    db.get(AudioFile, c).shared_audio = "[[1, 0.4]]"  # left by an earlier run, outside every group
    db.get(AudioFile, a).shared_audio = "[[999, 0.5]]"
    db.commit()
    db.close()
    monkeypatch.setattr(ad, "compute_shared_audio", lambda groups, **k: {a: [], b: []})

    ad.find_audio_duplicates(lib_id, job_id, CRITERIA)

    db = Session()
    assert db.get(AudioFile, a).shared_audio == "[]"
    assert db.get(AudioFile, c).shared_audio is None
    db.close()


def test_the_dials_are_recorded_on_the_job_and_the_plan_is_logged(seeded, engine, monkeypatch):
    lib_id, job_id, a, b, _c = seeded
    monkeypatch.setattr(ad, "SessionLocal", sessionmaker(bind=engine))

    def fake(groups, **kwargs):
        kwargs["on_plan"](2, 1, 1)
        return {a: [], b: []}

    monkeypatch.setattr(ad, "compute_shared_audio", fake)

    ad.find_audio_duplicates(lib_id, job_id, {**CRITERIA, "audio_min_stretch": 15.0})

    db = sessionmaker(bind=engine)()
    assert json.loads(db.get(Job, job_id).settings) == {
        "audio_similarity": 0.75,
        "audio_min_stretch": 15.0,
    }
    (entry,) = db.query(JobLog).filter(JobLog.job_id == job_id).all()
    assert (entry.level, entry.message) == (
        "info",
        "Shared audio: 2 files in 1 group(s), 1 pairs to compare.",
    )
    db.close()


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

    r = client.post(f"/api/audio-libraries/{fresh_id}/find-duplicates", json={"use_audio": True})
    assert r.status_code == 202
    assert "job_id" in r.json()
