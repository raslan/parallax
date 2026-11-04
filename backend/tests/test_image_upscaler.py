"""Upscale loop + job runner, with a fake tile function (nearest-neighbour) so ncnn isn't needed."""

import json
import os
import stat

import numpy as np
import pytest
from PIL import Image
from sqlalchemy.orm import sessionmaker

from app.models.image import ImageFile
from app.models.image_library import ImageLibrary
from app.models.job import Job, JobStatus, JobType
from app.models.stats import StatEvent
from app.services import common, stats, upscale_plan
from app.services import image_upscaler as up
from app.services import upscale_runtime as runtime
from app.services.upscale_models import get_tier


def fake_tile(tier, device, tile):
    n = tier.scale
    return np.repeat(np.repeat(tile, n, axis=1), n, axis=2)


def _gradient(h, w):
    y = np.linspace(0, 255, h, dtype=np.float32)[:, None]
    x = np.linspace(0, 255, w, dtype=np.float32)[None, :]
    g = y * 0.5 + x * 0.5
    return np.stack([g, 255 - g, np.full_like(g, 90)], axis=-1).astype(np.uint8)


def _nearest(rgb, n):
    return np.repeat(np.repeat(rgb, n, axis=0), n, axis=1)


# --------------------------------------------------------------------------- upscale_array


@pytest.mark.parametrize("size", [(1, 1), (10, 10), (17, 193), (192, 384)])
@pytest.mark.parametrize("native,scale", [(2, 2), (2, 1), (4, 4), (4, 2), (4, 1)])
def test_upscale_array_shapes(size, native, scale):
    h, w = size
    tier = get_tier("simple" if native == 2 else "best")
    rgb = _gradient(h, w)
    out = up.upscale_array(rgb, tier, scale, "cpu", lambda: None, lambda: False, tile_fn=fake_tile)
    assert out.shape == (h * scale, w * scale, 3)
    assert out.dtype == np.uint8


def test_upscale_array_matches_whole_image_at_native_scale():
    rgb = _gradient(300, 450)
    tier = get_tier("simple")
    out = up.upscale_array(rgb, tier, 2, "cpu", lambda: None, lambda: False, tile_fn=fake_tile)
    assert np.array_equal(out, _nearest(rgb, 2))


def test_downscale_per_tile_has_no_seams():
    rgb = _gradient(300, 450)
    tier = get_tier("best")  # native 4, fake = nearest x4
    out = up.upscale_array(rgb, tier, 2, "cpu", lambda: None, lambda: False, tile_fn=fake_tile)
    whole = Image.fromarray(_nearest(rgb, 4)).resize((450 * 2, 300 * 2), Image.Resampling.LANCZOS)
    diff = np.abs(out.astype(int) - np.asarray(whole).astype(int))
    inner = diff[8:-8, 8:-8]
    assert inner.max() <= 2


def test_upscale_array_counts_tiles_and_cancels():
    rgb = _gradient(200, 200)  # 4 tiles
    tier = get_tier("simple")
    ticks = []
    out = up.upscale_array(
        rgb, tier, 2, "cpu", lambda: ticks.append(1), lambda: False, tile_fn=fake_tile
    )
    assert out is not None and len(ticks) == 4

    ticks.clear()
    res = up.upscale_array(
        rgb, tier, 2, "cpu", lambda: ticks.append(1), lambda: len(ticks) >= 1, tile_fn=fake_tile
    )
    assert res is None and len(ticks) == 1


# --------------------------------------------------------------------------- runner


@pytest.fixture
def env(engine, tmp_path, monkeypatch):
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(up, "SessionLocal", Session)
    monkeypatch.setattr(stats, "SessionLocal", Session)
    monkeypatch.setattr(runtime, "run_tile", fake_tile)
    monkeypatch.setattr(runtime, "choose_device", lambda force_cpu: "cpu")
    monkeypatch.setattr(up, "release_sessions", lambda: None)
    applied = []
    monkeypatch.setattr(
        up.fs_watcher, "_apply", lambda kind, lib, changed: applied.append((kind, lib, changed))
    )
    db = Session()
    lib = ImageLibrary(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()

    class Env:
        pass

    e = Env()
    e.Session, e.db, e.lib_id, e.dir, e.applied = Session, db, lib.id, tmp_path, applied

    def add_image(name, size=(40, 30), fmt="JPEG", data=None):
        p = tmp_path / name
        if data is not None:
            p.write_bytes(data)
        else:
            Image.fromarray(_gradient(size[1], size[0])).save(p, format=fmt)
        row = ImageFile(
            library_id=lib.id,
            path=str(p),
            filename=name,
            extension=p.suffix,
            size=p.stat().st_size,
            width=size[0],
            height=size[1],
        )
        db.add(row)
        db.commit()
        return row.id, p

    def new_job():
        job = Job(type=JobType.IMAGE_UPSCALE, status=JobStatus.PENDING, library_id=lib.id)
        db.add(job)
        db.commit()
        return job.id

    def load_job(job_id):
        s = Session()
        j = s.get(Job, job_id)
        s.refresh(j)
        s.expunge(j)
        s.close()
        return j

    e.add_image, e.new_job, e.load_job = add_image, new_job, load_job
    yield e
    db.close()


def _results(job):
    return json.loads(job.settings)["results"]


def test_job_writes_output_next_to_source(env):
    fid, src = env.add_image("p.jpg", (40, 30))
    job_id = env.new_job()

    up.run_image_upscale_job(job_id, [fid], "simple", 2, False)

    job = env.load_job(job_id)
    assert job.status == JobStatus.COMPLETED and job.progress == 100.0
    out = env.dir / "p_2x.jpg"
    assert out.exists() and Image.open(out).size == (80, 60)
    assert not [f for f in os.listdir(env.dir) if ".compressing" in f]
    assert src.exists()
    res = _results(job)
    assert res[0]["id"] == fid and res[0]["output"] == str(out) and res[0]["skipped"] is None
    assert env.applied and env.applied[0][0] == "image"
    assert str(out) in env.applied[0][2]


def test_job_collision_suffix(env):
    fid, _ = env.add_image("p.png", (20, 20), fmt="PNG")
    (env.dir / "p_2x.png").write_bytes(b"existing")
    job_id = env.new_job()

    up.run_image_upscale_job(job_id, [fid], "simple", 2, False)

    assert (env.dir / "p_2x.png").read_bytes() == b"existing"
    assert Image.open(env.dir / "p_2x_1.png").size == (40, 40)


def test_job_one_x_names_and_sizes(env):
    fid, _ = env.add_image("p.webp", (33, 21), fmt="WEBP")
    job_id = env.new_job()
    up.run_image_upscale_job(job_id, [fid], "best", 1, False)
    assert Image.open(env.dir / "p_1x.webp").size == (33, 21)


def test_job_cancel_leaves_nothing(env, monkeypatch):
    fid, _ = env.add_image("big.jpg", (400, 300))  # many tiles
    job_id = env.new_job()
    calls = []

    def cancelling_tile(tier, device, tile):
        calls.append(1)
        common.request_cancel(job_id)
        return fake_tile(tier, device, tile)

    monkeypatch.setattr(runtime, "run_tile", cancelling_tile)

    up.run_image_upscale_job(job_id, [fid], "simple", 2, False)

    job = env.load_job(job_id)
    assert job.status == JobStatus.CANCELLED
    assert len(calls) == 1
    assert sorted(os.listdir(env.dir)) == ["big.jpg"]
    assert not common.should_cancel(job_id)


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores directory permissions")
def test_job_bad_files_do_not_stop_batch(env):
    bad_id, _ = env.add_image("bad.jpg", data=b"\xff\xd8 not a jpeg")
    good_id, _ = env.add_image("good.jpg", (30, 30))
    ro = env.dir / "ro"
    ro.mkdir()
    Image.fromarray(_gradient(20, 20)).save(ro / "locked.png")
    row = ImageFile(
        library_id=env.lib_id,
        path=str(ro / "locked.png"),
        filename="locked.png",
        extension=".png",
        size=1,
        width=20,
        height=20,
    )
    env.db.add(row)
    env.db.commit()
    ro.chmod(stat.S_IRUSR | stat.S_IXUSR)
    job_id = env.new_job()
    try:
        up.run_image_upscale_job(job_id, [bad_id, good_id, row.id], "simple", 2, False)
    finally:
        ro.chmod(stat.S_IRWXU)

    job = env.load_job(job_id)
    assert job.status == JobStatus.COMPLETED
    by_id = {r["id"]: r for r in _results(job)}
    assert by_id[good_id]["output"] and (env.dir / "good_2x.jpg").exists()
    assert by_id[bad_id]["output"] is None and by_id[bad_id]["skipped"]
    assert by_id[row.id]["output"] is None and (by_id[row.id]["skipped"] or by_id[row.id]["error"])
    assert not [f for f in os.listdir(ro) if ".compressing" in f]


def test_job_over_cap_skipped(env, monkeypatch):
    monkeypatch.setattr(upscale_plan, "MAX_OUTPUT_PIXELS", 1000)
    fid, _ = env.add_image("p.jpg", (40, 30))  # 40*30*4 = 4800 > 1000
    ok_id, _ = env.add_image("q.jpg", (10, 10))  # 400 ok
    job_id = env.new_job()

    up.run_image_upscale_job(job_id, [fid, ok_id], "simple", 2, False)

    by_id = {r["id"]: r for r in _results(env.load_job(job_id))}
    assert "150 MP" in by_id[fid]["skipped"] and not (env.dir / "p_2x.jpg").exists()
    assert by_id[ok_id]["output"]


def test_job_missing_source_skipped(env):
    fid, src = env.add_image("gone.jpg", (20, 20))
    ok_id, _ = env.add_image("ok.jpg", (20, 20))
    src.unlink()
    job_id = env.new_job()
    up.run_image_upscale_job(job_id, [fid, ok_id], "simple", 2, False)
    by_id = {r["id"]: r for r in _results(env.load_job(job_id))}
    assert "no longer exists" in by_id[fid]["skipped"]
    assert by_id[ok_id]["output"]


def test_job_all_failed_marks_failed(env):
    fid, _ = env.add_image("bad.jpg", data=b"junk")
    job_id = env.new_job()
    up.run_image_upscale_job(job_id, [fid], "simple", 2, False)
    job = env.load_job(job_id)
    assert job.status == JobStatus.FAILED and job.error


def test_gpu_failure_falls_back_to_cpu(env, monkeypatch):
    fid, _ = env.add_image("p.jpg", (20, 20))
    monkeypatch.setattr(runtime, "choose_device", lambda force_cpu: "gpu")
    seen = []

    def flaky(tier, device, tile):
        seen.append(device)
        if device == "gpu":
            raise RuntimeError("vulkan exploded")
        return fake_tile(tier, device, tile)

    monkeypatch.setattr(runtime, "run_tile", flaky)
    job_id = env.new_job()
    up.run_image_upscale_job(job_id, [fid], "simple", 2, False)
    assert env.load_job(job_id).status == JobStatus.COMPLETED
    assert seen[0] == "gpu" and set(seen[1:]) == {"cpu"}


def test_unexpected_error_fails_job_not_running(env, monkeypatch):
    fid, _ = env.add_image("p.jpg", (20, 20))
    monkeypatch.setattr(up, "verify_tier_files", lambda tier: (_ for _ in ()).throw(OSError("x")))
    job_id = env.new_job()
    up.run_image_upscale_job(job_id, [fid], "simple", 2, False)
    assert env.load_job(job_id).status == JobStatus.FAILED


def test_no_stat_event_written(env):
    fid, _ = env.add_image("p.jpg", (20, 20))
    job_id = env.new_job()
    up.run_image_upscale_job(job_id, [fid], "simple", 2, False)
    before = env.db.query(StatEvent).count()
    stats.record_finished_job(job_id)
    env.db.expire_all()
    assert env.db.query(StatEvent).count() == before
