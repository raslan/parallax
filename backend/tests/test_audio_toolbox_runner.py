"""Covers `run_audio_toolbox_job` — the job runner (as opposed to the pure
command builders in `test_audio_toolbox.py`):

* progress is reported on the 0–100 scale and ends at exactly 100.0
* the per-file `progress_cb` is wired through and `job.current_file` is set
  while a file is in flight
"""

import json
import subprocess
import threading
import time

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.job import Job, JobStatus, JobType
from app.services import audio_toolbox as tb


def _make_sine_mp3(path, seconds=1):
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={seconds}",
            "-c:a",
            "libmp3lame",
            "-y",
            str(path),
        ],
        check=True,
    )


@pytest.fixture
def seeded(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = AudioLibrary(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()
    ids = []
    for name in ("a.mp3", "b.mp3"):
        p = tmp_path / name
        p.write_bytes(b"x")
        row = AudioFile(
            library_id=lib.id,
            path=str(p),
            filename=name,
            extension=".mp3",
            size=1,
            duration=1.0,
            codec_name="mp3",
            bitrate=128000,
        )
        db.add(row)
        db.commit()
        ids.append(row.id)
    job = Job(type=JobType.AUDIO_TOOLBOX, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    out = (job.id, ids)
    db.close()
    return out


def test_runner_finishes_on_0_100_scale(seeded, engine, tmp_path, monkeypatch):
    job_id, file_ids = seeded
    monkeypatch.setattr(tb, "SessionLocal", sessionmaker(bind=engine))

    for name in ("a.mp3", "b.mp3"):
        _make_sine_mp3(tmp_path / name)

    tb.run_audio_toolbox_job(job_id, file_ids, {"trim_start": 0.2, "trim_end": 0.2}, False)

    db = sessionmaker(bind=engine)()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED
    assert 0 < job.progress <= 100
    assert job.progress == 100.0
    assert job.processed_files == 2
    results = json.loads(job.settings)["results"]
    assert [r["ok"] for r in results] == [True, True]
    db.close()


def test_runner_wires_progress_cb_and_sets_current_file(seeded, engine, monkeypatch):
    job_id, file_ids = seeded
    monkeypatch.setattr(tb, "SessionLocal", sessionmaker(bind=engine))

    release = threading.Event()
    state = {"blocked_once": False, "cb_called": False}

    def fake_fix_one(src, settings, keep_original, job_id, progress_cb=None):
        assert callable(progress_cb), "runner must pass a progress_cb"
        state["cb_called"] = True
        progress_cb(0.5)  # fold a fractional progress into the aggregate
        if not state["blocked_once"]:
            state["blocked_once"] = True
            release.wait(timeout=15)
        progress_cb(0.99)
        return True, None

    monkeypatch.setattr(tb, "_toolbox_fix_one", fake_fix_one)

    worker = threading.Thread(
        target=tb.run_audio_toolbox_job,
        args=(job_id, file_ids, {"normalize": True}, True),
    )
    worker.start()

    Session = sessionmaker(bind=engine)
    mid_current = None
    mid_progress = None
    deadline = time.time() + 12
    while time.time() < deadline:
        try:
            db = Session()
            job = db.get(Job, job_id)
            cur, prog = job.current_file, job.progress
            db.close()
        except OperationalError:
            time.sleep(0.2)
            continue
        if cur:
            mid_current, mid_progress = cur, prog
            break
        time.sleep(0.25)

    release.set()
    worker.join(timeout=20)

    assert state["cb_called"]
    assert mid_current == "a.mp3"
    assert mid_progress is not None and 0 < mid_progress < 100

    db = Session()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED
    assert job.progress == 100.0
    assert job.processed_files == 2
    assert job.current_file is None
    db.close()
