from sqlalchemy.orm import sessionmaker

from app.models.file import File
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library
from app.services.compressor import _build_compress_cmd, _resolve_encoder
from app.services.gpu_pool import GPUDevice


def _nvidia(index="0"):
    return GPUDevice(vendor="nvidia", index=index, label="card", family="nvenc")


def _amd(index="/dev/dri/renderD128"):
    return GPUDevice(vendor="amd", index=index, label="renderD128", family="vaapi")


def test_resolve_encoder_picks_by_codec():
    assert _resolve_encoder("h264") in (
        "h264_nvenc",
        "h264_qsv",
        "h264_amf",
        "h264_vaapi",
        "libx264",
    )
    assert _resolve_encoder("hevc") in (
        "hevc_nvenc",
        "hevc_qsv",
        "hevc_amf",
        "hevc_vaapi",
        "libx265",
    )


def test_build_cmd_nvenc_no_gpu_omits_device_pinning(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "h264_nvenc", "hevc": "hevc_nvenc"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=None)

    assert "-hwaccel_device" not in cmd
    assert "-gpu" not in cmd
    assert cmd[cmd.index("-hwaccel") + 1] == "cuda"


def test_build_cmd_nvenc_pins_device(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "h264_nvenc", "hevc": "hevc_nvenc"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=_nvidia("1"))

    assert cmd[cmd.index("-hwaccel_device") + 1] == "1"
    assert cmd[cmd.index("-gpu") + 1] == "1"
    # -hwaccel_device must precede -i to affect decode
    assert cmd.index("-hwaccel_device") < cmd.index("-i")


def test_build_cmd_vaapi_pins_device(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "h264_vaapi", "hevc": "hevc_vaapi"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=_amd())

    assert cmd[cmd.index("-hwaccel") + 1] == "vaapi"
    assert cmd[cmd.index("-hwaccel_device") + 1] == "/dev/dri/renderD128"


def test_build_cmd_vaapi_no_gpu_omits_hwaccel_entirely(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "h264_vaapi", "hevc": "hevc_vaapi"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=None)

    assert "-hwaccel" not in cmd


def test_build_cmd_software_encoder_ignores_gpu_param(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "libx264", "hevc": "libx265"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=_nvidia())

    assert "-hwaccel" not in cmd
    assert "-gpu" not in cmd


def _seed_job(engine, tmp_path, n_files=1):
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
                codec_name="av1",
            )
        )
        paths.append(str(p))
    db.commit()
    job = Job(type=JobType.COMPRESS, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()
    return job_id, paths


def test_run_compress_job_retries_on_hwaccel_failure_then_succeeds(engine, tmp_path, monkeypatch):
    import app.services.compressor as c
    import app.services.gpu_pool as gp

    job_id, paths = _seed_job(engine, tmp_path)
    monkeypatch.setattr(c, "SessionLocal", sessionmaker(bind=engine))

    dev_a = GPUDevice(vendor="nvidia", index="0", label="card0", family="nvenc")
    dev_b = GPUDevice(vendor="nvidia", index="1", label="card1", family="nvenc")
    monkeypatch.setattr(gp, "detect_gpus", lambda: [dev_a, dev_b])
    monkeypatch.setattr(c, "_resolve_encoder", lambda codec: "hevc_nvenc")

    calls = []

    def fake_compress_one(
        path, codec, crf, speed, job_id, progress_cb=None, keep_original=True, gpu=None
    ):
        calls.append(gpu.index if gpu else None)
        if len(calls) == 1:
            return False, "Error initializing CUDA device: no CUDA-capable device", None
        return True, None, path

    monkeypatch.setattr(c, "_compress_one", fake_compress_one)
    monkeypatch.setattr(c, "_rescan_after_job", lambda *a, **k: None)

    c.run_compress_job(job_id, paths, "hevc", 28, "medium", keep_original=False)

    db = sessionmaker(bind=engine)()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED
    assert job.processed_files == 1
    db.close()
    assert len(calls) == 2
    assert calls[0] != calls[1]  # retried on the other device


def test_run_compress_job_scales_total_workers_by_gpu_count(engine, tmp_path, monkeypatch):
    # max_concurrent_transcodes now means "per GPU" — with capacity 2 and 2
    # GPUs, up to 4 files must run truly simultaneously (not capped at 2,
    # the old "total across all GPUs" meaning).
    import threading

    import app.services.compressor as c
    import app.services.gpu_pool as gp
    from app.models.settings import set_setting

    job_id, paths = _seed_job(engine, tmp_path, n_files=4)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(c, "SessionLocal", Session)

    seed_db = Session()
    set_setting(seed_db, "max_concurrent_transcodes", "2")
    seed_db.close()

    dev_a = GPUDevice(vendor="nvidia", index="0", label="card0", family="nvenc")
    dev_b = GPUDevice(vendor="nvidia", index="1", label="card1", family="nvenc")
    monkeypatch.setattr(gp, "detect_gpus", lambda: [dev_a, dev_b])
    monkeypatch.setattr(c, "_resolve_encoder", lambda codec: "hevc_nvenc")

    barrier = threading.Barrier(4, timeout=5)

    def fake_compress_one(
        path, codec, crf, speed, job_id, progress_cb=None, keep_original=True, gpu=None
    ):
        barrier.wait()  # only returns once all 4 workers are running at once
        return True, None, path

    monkeypatch.setattr(c, "_compress_one", fake_compress_one)
    monkeypatch.setattr(c, "_rescan_after_job", lambda *a, **k: None)

    c.run_compress_job(job_id, paths, "hevc", 28, "medium", keep_original=False)

    db = Session()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED
    assert job.processed_files == 4
    db.close()


def test_run_compress_job_zero_gpus_behaves_like_before(engine, tmp_path, monkeypatch):
    import app.services.compressor as c
    import app.services.gpu_pool as gp

    job_id, paths = _seed_job(engine, tmp_path)
    monkeypatch.setattr(c, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(gp, "detect_gpus", lambda: [])
    monkeypatch.setattr(c, "_resolve_encoder", lambda codec: "libx265")

    calls = []

    def fake_compress_one(
        path, codec, crf, speed, job_id, progress_cb=None, keep_original=True, gpu=None
    ):
        calls.append(gpu)
        return True, None, path

    monkeypatch.setattr(c, "_compress_one", fake_compress_one)
    monkeypatch.setattr(c, "_rescan_after_job", lambda *a, **k: None)

    c.run_compress_job(job_id, paths, "hevc", 28, "medium", keep_original=False)

    assert calls == [None]
