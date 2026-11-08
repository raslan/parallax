"""The video Extract job (`duplicates.find_duplicates`) with Shared audio on: grouping, progress
accounting, cancellation, stale values, files deleted mid-run. Only the audio matching and the
byte-hash are faked; the database, the funnel and the job bookkeeping are real."""

import json

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.file import File
from app.models.job import Job, JobLog, JobStatus, JobType
from app.models.library import Library
from app.schemas import DuplicateCriteriaRequest
from app.services import duplicates as dup


def criteria(**over) -> dict:
    """Every chip off except shared audio, unless a test turns more on."""
    base = {
        **DuplicateCriteriaRequest().model_dump(),
        "use_size": False,
        "use_duration": False,
        "use_phash": False,
        "use_audio": True,
    }
    return {**base, **over}


@pytest.fixture
def seeded(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = Library(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()

    def mk(name: str, duration: float, shared: str | None = None) -> int:
        row = File(
            library_id=lib.id,
            path=str(tmp_path / name),
            filename=name,
            size=1,
            duration=duration,
            shared_audio=shared,
        )
        db.add(row)
        db.commit()
        return row.id

    # a and b are 1 s apart (one duration group); c is 5 minutes long, on its own.
    a = mk("a.mp4", 60.0, shared="[[999, 0.5]]")  # left over from an earlier run
    b = mk("b.mp4", 61.0)
    c = mk("c.mp4", 300.0, shared="[[1, 0.4]]")  # also left over, and outside every group
    job = Job(type=JobType.DUPLICATES, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    out = (lib.id, job.id, a, b, c)
    db.close()
    return out


def run(engine, monkeypatch, seeded, crit, fake):
    lib_id, job_id, *_ = seeded
    monkeypatch.setattr(dup, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(dup, "compute_shared_audio", fake)
    dup.find_duplicates(lib_id, job_id, crit)


def read(engine):
    return sessionmaker(bind=engine)()


DURATION = {"use_duration": True, "duration_tolerance": 2.0}


def test_shared_audio_alone_gets_the_whole_bar_and_counts_its_own_files(
    seeded, engine, monkeypatch
):
    _lib, job_id, a, b, c = seeded
    seen = {}

    def fake(groups, **kw):
        seen["groups"] = [sorted(fid for fid, _ in g) for g in groups]
        seen["dials"] = (kw["similarity"], kw["min_stretch_s"])
        kw["on_progress"](0.25)
        other = read(engine)
        mid = other.get(Job, job_id)
        seen["mid"] = (mid.total_files, mid.processed_files, mid.progress)
        other.close()
        return {a: [[b, 0.93]], b: [[a, 0.93]]}

    run(
        engine,
        monkeypatch,
        seeded,
        criteria(**DURATION, audio_similarity=0.7, audio_min_stretch=12.0),
        fake,
    )

    assert seen["groups"] == [sorted([a, b])]  # the 5-minute file is not in a group
    assert seen["dials"] == (0.7, 12.0)
    # Nothing else to extract, so a quarter of the audio phase is 25% of the bar (not 40 + ...),
    # and the counts are the two files compared, not the library's three.
    assert seen["mid"] == (2, 1, 25.0)
    db = read(engine)
    job = db.get(Job, job_id)
    assert (job.status, job.progress) == (JobStatus.COMPLETED, 100.0)
    assert json.loads(db.get(File, a).shared_audio) == [[b, 0.93]]
    assert json.loads(db.get(File, b).shared_audio) == [[a, 0.93]]
    db.close()


def test_with_other_extraction_to_do_the_audio_phase_takes_the_last_60_percent(
    seeded, engine, monkeypatch
):
    _lib, job_id, a, b, _c = seeded
    monkeypatch.setattr(dup, "compute_byte_hash", lambda path: "h")
    seen = {}

    def fake(groups, **kw):
        kw["on_progress"](0.5)
        other = read(engine)
        seen["progress"] = other.get(Job, job_id).progress
        other.close()
        return {a: [], b: []}

    run(engine, monkeypatch, seeded, criteria(**DURATION, use_byte_hash=True), fake)

    assert seen["progress"] == pytest.approx(40 + 0.5 * 60)
    db = read(engine)
    assert db.get(File, a).byte_hash == "h"  # the byte-hash pool ran first
    db.close()


def test_each_run_replaces_what_the_last_one_measured(seeded, engine, monkeypatch):
    _lib, _job, a, b, c = seeded

    run(engine, monkeypatch, seeded, criteria(**DURATION), lambda groups, **kw: {a: [], b: []})

    db = read(engine)
    # a's value from the earlier run is gone, and so is c's, which was outside every group.
    assert db.get(File, a).shared_audio == "[]"
    assert db.get(File, c).shared_audio is None
    db.close()


def test_a_cancelled_run_changes_nothing(seeded, engine, monkeypatch):
    _lib, job_id, a, _b, c = seeded

    run(engine, monkeypatch, seeded, criteria(**DURATION), lambda groups, **kw: None)

    db = read(engine)
    assert db.get(Job, job_id).status == JobStatus.CANCELLED
    assert db.get(File, a).shared_audio == "[[999, 0.5]]"
    assert db.get(File, c).shared_audio is not None
    db.close()


def test_a_file_deleted_during_the_run_does_not_fail_it(seeded, engine, monkeypatch):
    _lib, job_id, a, b, _c = seeded

    def fake(groups, **kw):
        other = read(engine)
        other.delete(other.get(File, b))  # the watcher pruned it, or the user deleted it
        other.commit()
        other.close()
        return {a: [[b, 0.9]], b: [[a, 0.9]]}

    run(engine, monkeypatch, seeded, criteria(**DURATION), fake)

    db = read(engine)
    assert db.get(Job, job_id).status == JobStatus.COMPLETED
    assert json.loads(db.get(File, a).shared_audio) == [[b, 0.9]]
    assert db.get(File, b) is None
    db.close()


def test_the_dials_are_recorded_on_the_job_and_the_plan_is_logged(seeded, engine, monkeypatch):
    _lib, job_id, a, b, _c = seeded

    def fake(groups, **kw):
        kw["on_plan"](2, 1, 1)
        return {a: [], b: []}

    run(engine, monkeypatch, seeded, criteria(**DURATION, audio_min_stretch=15.0), fake)

    db = read(engine)
    assert json.loads(db.get(Job, job_id).settings) == {
        "audio_similarity": 0.75,
        "audio_min_stretch": 15.0,
    }
    logs = db.query(JobLog).filter(JobLog.job_id == job_id).all()
    assert [(entry.level, entry.message) for entry in logs] == [
        ("info", "Shared audio: 2 files in 1 group(s), 1 pairs to compare.")
    ]
    db.close()


def test_a_big_plan_is_logged_as_a_warning(seeded, engine, monkeypatch):
    _lib, job_id, a, b, _c = seeded

    def fake(groups, **kw):
        kw["on_plan"](1000, 1, 499_500)
        return {a: [], b: []}

    run(engine, monkeypatch, seeded, criteria(**DURATION), fake)

    db = read(engine)
    (entry,) = db.query(JobLog).filter(JobLog.job_id == job_id).all()
    assert entry.level == "warning" and "499,500" in entry.message
    db.close()


def test_with_shared_audio_off_nothing_is_measured_or_cleared(seeded, engine, monkeypatch):
    _lib, job_id, a, _b, _c = seeded
    monkeypatch.setattr(dup, "compute_byte_hash", lambda path: "h")

    run(
        engine,
        monkeypatch,
        seeded,
        criteria(use_audio=False, use_byte_hash=True),
        lambda *a, **k: pytest.fail("shared audio must not run"),
    )

    db = read(engine)
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED and job.settings is None
    assert db.get(File, a).shared_audio == "[[999, 0.5]]"  # left exactly as it was
    db.close()
