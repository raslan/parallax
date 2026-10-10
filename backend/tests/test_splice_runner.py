"""run_splice_job — the Job wrapper around perform_merge (status transitions, the GPU
marker landing in job.error, the watcher refresh)."""

import logging
import subprocess

import pytest
from sqlalchemy.orm import sessionmaker

import app.services.splice as sp
from app.models.file import File
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library


def _clip(path, size="320x240"):
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc=duration=1:size={size}:rate=25",
            "-f", "lavfi", "-i", "sine=duration=1:frequency=440:sample_rate=48000",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
        ],
        check=True,
    )  # fmt: skip


@pytest.fixture
def seeded(engine, tmp_path, monkeypatch):
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(sp, "SessionLocal", Session)
    db = Session()
    lib = Library(name="R", path=str(tmp_path))
    db.add(lib)
    db.commit()
    paths, ids = [], []
    for name, size in (("a.mp4", "320x240"), ("b.mp4", "160x120")):
        p = tmp_path / name
        _clip(p, size)
        f = File(
            library_id=lib.id, path=str(p), filename=name, extension="mp4", size=p.stat().st_size
        )
        db.add(f)
        db.commit()
        paths.append(str(p))
        ids.append(f.id)
    job = Job(type=JobType.SPLICE_MERGE, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    job_id, lib_id = job.id, lib.id
    db.close()
    yield Session, job_id, lib_id, ids, paths
    db = Session()
    db.query(Job).delete()
    db.query(File).delete()
    db.query(Library).delete()
    db.commit()
    db.close()


def _settings(**over):
    base = {
        "output_name": "joined",
        "chapters": False,
        "verdict": "reencode",
        "reencode": {"codec": "h264", "crf": 28, "speed": "fast", "reference_file_id": None},
        "reference_index": 0,
        "force_cpu": True,
    }
    return {**base, **over}


def _job(Session, job_id):
    db = Session()
    try:
        j = db.get(Job, job_id)
        return j.status, j.error, j.current_file, j.progress
    finally:
        db.close()


def test_success_completes_the_job_and_refreshes_the_library(seeded, monkeypatch, tmp_path):
    Session, job_id, lib_id, ids, paths = seeded
    applied = []
    monkeypatch.setattr(
        "app.services.fs_watcher._apply",
        lambda kind, lib, changed: applied.append((kind, lib, changed)),
    )
    sp.run_splice_job(job_id, ids, paths, _settings())
    status, error, current, progress = _job(Session, job_id)
    assert (status, error, current, progress) == (JobStatus.COMPLETED, None, "joined.mp4", 100.0)
    assert applied == [("video", lib_id, frozenset({str(tmp_path / "joined.mp4")}))]


def test_gpu_failure_marks_the_job_failed_with_the_retry_marker(seeded, monkeypatch):
    Session, job_id, _lib, ids, paths = seeded
    monkeypatch.setattr(sp, "_resolve_encoder", lambda codec: "h264_nvenc")

    def boom(cmd, total, progress_cb, is_cancelled):
        raise RuntimeError("no nvenc device")

    monkeypatch.setattr(sp, "_run_ffmpeg", boom)
    sp.run_splice_job(job_id, ids, paths, _settings(force_cpu=False))
    status, error, _cur, _p = _job(Session, job_id)
    assert status == JobStatus.FAILED and error.startswith(sp.GPU_FAILED_PREFIX)


def test_cancel_marks_the_job_cancelled_and_leaves_sources(seeded, monkeypatch, tmp_path):
    Session, job_id, _lib, ids, paths = seeded
    monkeypatch.setattr(sp, "should_cancel", lambda job_id: True)
    sp.run_splice_job(job_id, ids, paths, _settings())
    assert _job(Session, job_id)[0] == JobStatus.CANCELLED
    assert (tmp_path / "a.mp4").exists() and (tmp_path / "b.mp4").exists()


def test_a_failed_library_refresh_is_logged_not_swallowed(seeded, monkeypatch, caplog):
    Session, job_id, _lib, ids, paths = seeded

    def boom(kind, lib, changed):
        raise RuntimeError("watcher exploded")

    monkeypatch.setattr("app.services.fs_watcher._apply", boom)
    with caplog.at_level(logging.WARNING, logger="app.services.splice"):
        sp.run_splice_job(job_id, ids, paths, _settings())
    assert _job(Session, job_id)[0] == JobStatus.COMPLETED  # the merge itself still succeeded
    assert "watcher exploded" in caplog.text
