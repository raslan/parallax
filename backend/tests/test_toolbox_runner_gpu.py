"""Covers GPU distribution in `run_toolbox_job` — the runner's own device
acquire/release/retry wiring, as opposed to the pure `_build_toolbox_cmd`
argv shape covered in test_toolbox.py."""

from sqlalchemy.orm import sessionmaker

from app.models.file import File
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library


def _seed_job(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = Library(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()
    p = tmp_path / "v0.mp4"
    p.write_bytes(b"x")
    db.add(
        File(
            library_id=lib.id,
            path=str(p),
            filename=p.name,
            extension=".mp4",
            size=1,
            codec_name="h264",
        )
    )
    db.commit()
    job = Job(type=JobType.TOOLBOX_FIX, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()
    return job_id, str(p)


def _seed_multi(engine, tmp_path, n_files):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = Library(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()
    paths = []
    for i in range(n_files):
        p = tmp_path / f"v{i}.mp4"
        p.write_bytes(b"x")
        db.add(
            File(
                library_id=lib.id,
                path=str(p),
                filename=p.name,
                extension=".mp4",
                size=1,
                codec_name="h264",
            )
        )
        paths.append(str(p))
    db.commit()
    job = Job(type=JobType.TOOLBOX_FIX, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()
    return job_id, paths


def test_run_toolbox_job_scales_total_workers_by_gpu_count(engine, tmp_path, monkeypatch):
    # max_concurrent_transcodes now means "per GPU" — with capacity 2 and 2
    # GPUs, up to 4 files must run truly simultaneously.
    import threading

    import app.services.gpu_pool as gp
    import app.services.toolbox as tb
    from app.models.settings import set_setting
    from app.services.gpu_pool import GPUDevice

    job_id, paths = _seed_multi(engine, tmp_path, 4)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(tb, "SessionLocal", Session)

    seed_db = Session()
    set_setting(seed_db, "max_concurrent_transcodes", "2")
    seed_db.close()

    dev_a = GPUDevice(vendor="nvidia", index="0", label="card0", family="nvenc")
    dev_b = GPUDevice(vendor="nvidia", index="1", label="card1", family="nvenc")
    monkeypatch.setattr(gp, "detect_gpus", lambda: [dev_a, dev_b])
    monkeypatch.setattr(tb, "encoder_for_codec", lambda codec: "hevc_nvenc")

    barrier = threading.Barrier(4, timeout=5)

    def fake_fix_one(
        file_path,
        settings,
        job_id,
        progress_cb=None,
        note_cb=None,
        keep_original=True,
        gpu_pools=None,
    ):
        barrier.wait()  # only returns once all 4 workers are running at once
        return True, None, file_path

    monkeypatch.setattr(tb, "_toolbox_fix_one", fake_fix_one)
    monkeypatch.setattr(tb, "_rescan_after_job", lambda *a, **k: None)

    tb.run_toolbox_job(job_id, paths, {"rotate_deg": 90}, keep_original=False)

    db = Session()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED
    assert job.processed_files == 4
    db.close()


def test_run_toolbox_job_retries_on_hwaccel_failure_then_succeeds(engine, tmp_path, monkeypatch):
    import app.services.gpu_pool as gp
    import app.services.toolbox as tb
    from app.services.gpu_pool import GPUDevice

    job_id, path = _seed_job(engine, tmp_path)
    monkeypatch.setattr(tb, "SessionLocal", sessionmaker(bind=engine))

    dev_a = GPUDevice(vendor="nvidia", index="0", label="card0", family="nvenc")
    dev_b = GPUDevice(vendor="nvidia", index="1", label="card1", family="nvenc")
    monkeypatch.setattr(gp, "detect_gpus", lambda: [dev_a, dev_b])
    monkeypatch.setattr(tb, "encoder_for_codec", lambda codec: "hevc_nvenc")

    calls = []

    def fake_fix_one(
        file_path,
        settings,
        job_id,
        progress_cb=None,
        note_cb=None,
        keep_original=True,
        gpu_pools=None,
    ):
        pool = gpu_pools["nvenc"]
        gpu = pool.acquire_any()
        calls.append(gpu.index if gpu else None)
        if len(calls) == 1:
            pool.mark_degraded(gpu)
            pool.release(gpu)
            gpu2 = pool.acquire_any(exclude=frozenset({gpu.index}))
            calls.append(gpu2.index if gpu2 else None)
            pool.release(gpu2)
            return True, None, file_path
        pool.release(gpu)
        return True, None, file_path

    monkeypatch.setattr(tb, "_toolbox_fix_one", fake_fix_one)
    monkeypatch.setattr(tb, "_rescan_after_job", lambda *a, **k: None)

    tb.run_toolbox_job(job_id, [path], {"rotate_deg": 90}, keep_original=False)

    db = sessionmaker(bind=engine)()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED
    db.close()
    assert calls[0] != calls[1]
