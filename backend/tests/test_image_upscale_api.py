import json

import pytest
from PIL import Image
from sqlalchemy.orm import sessionmaker

from app.api import image_upscale as api
from app.models.image import ImageFile
from app.models.image_library import ImageLibrary
from app.models.job import Job, JobStatus, JobType


@pytest.fixture(autouse=True)
def _no_real_queue_or_probe(monkeypatch):
    enqueued = []

    async def fake_enqueue(job_id, fn, *args):
        enqueued.append((job_id, fn, args))

    monkeypatch.setattr(api, "enqueue", fake_enqueue)
    monkeypatch.setattr(api, "gpu_available", lambda: True)
    api._enqueued = enqueued
    yield


@pytest.fixture
def seeded(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    # Earlier tests may leave active upscale jobs behind in the shared session DB.
    db.query(Job).filter(Job.type == JobType.IMAGE_UPSCALE).delete()
    lib = ImageLibrary(name="L", path=str(tmp_path / "lib1"))
    other = ImageLibrary(name="O", path=str(tmp_path / "lib2"))
    db.add_all([lib, other])
    db.commit()
    (tmp_path / "lib1").mkdir()
    (tmp_path / "lib2").mkdir()

    def add(library, name, w, h, real_size=None):
        p = (tmp_path / ("lib1" if library is lib else "lib2")) / name
        if real_size:
            Image.new("RGB", real_size, (1, 2, 3)).save(p)
        else:
            p.write_bytes(b"x")
        row = ImageFile(
            library_id=library.id,
            path=str(p),
            filename=name,
            extension=p.suffix,
            size=1,
            width=w,
            height=h,
        )
        db.add(row)
        db.commit()
        return row.id

    class S:
        pass

    s = S()
    s.lib, s.other = lib.id, other.id
    s.a = add(lib, "a.jpg", 100, 100)
    s.b = add(lib, "b.png", 200, 100)
    s.gif = add(lib, "c.gif", 50, 50)
    s.huge = add(lib, "huge.jpg", 4000, 3000)  # 12 MP: x4 = 192 MP
    s.unscanned = add(lib, "d.png", None, None, real_size=(4000, 3000))
    s.foreign = add(other, "e.jpg", 10, 10)
    s.db = db
    yield s
    db.close()


def _post(client, **kw):
    body = {"tier": "simple", "scale": 2, "force_cpu": False, **kw}
    return client.post("/api/image-upscale/start", json=body)


def test_tiers_lists_three(client):
    r = client.get("/api/image-upscale/tiers")
    assert r.status_code == 200
    data = r.json()
    assert [t["id"] for t in data["tiers"]] == ["simple", "sharp", "best"]
    assert [t["scales"] for t in data["tiers"]] == [[1, 2], [1, 2], [1, 2, 4]]
    assert data["tiers"][2]["speed"] == "slow"
    assert data["gpu_available"] is True


def test_credits_ok(client):
    r = client.get("/api/image-upscale/credits")
    assert r.status_code == 200
    assert len(r.json()["models"]) == 3 and "BSD" in r.json()["ncnn"]["text"]


def test_start_creates_job(client, seeded):
    r = _post(client, file_ids=[seeded.a, seeded.b])
    assert r.status_code == 200
    body = r.json()
    assert body["skipped"] == []
    seeded.db.expire_all()
    job = seeded.db.get(Job, body["job_id"])
    assert job.type == JobType.IMAGE_UPSCALE and job.status == JobStatus.PENDING
    assert job.total_files == 2 and job.library_id == seeded.lib
    assert json.loads(job.settings)["tier"] == "simple"
    ((job_id, fn, args),) = api._enqueued
    assert job_id == body["job_id"]
    assert args == (job_id, [seeded.a, seeded.b], "simple", 2, False, 1)


def test_start_rejects_scale_4_for_simple(client, seeded):
    r = _post(client, file_ids=[seeded.a], scale=4)
    assert r.status_code == 422 and "4" in r.json()["detail"]
    assert _post(client, file_ids=[seeded.a], tier="best", scale=4).status_code == 200


def test_start_rejects_unknown_tier_and_scale(client, seeded):
    assert _post(client, file_ids=[seeded.a], tier="ultra").status_code == 422
    assert _post(client, file_ids=[seeded.a], scale=3).status_code == 422


def test_start_empty_and_unknown_ids_422(client, seeded):
    assert _post(client, file_ids=[]).status_code == 422
    assert _post(client, file_ids=[seeded.a, 999999]).status_code == 422


def test_start_mixed_libraries_422(client, seeded):
    assert _post(client, file_ids=[seeded.a, seeded.foreign]).status_code == 422


def test_start_409_when_active(client, seeded):
    assert _post(client, file_ids=[seeded.a]).status_code == 200
    r = _post(client, file_ids=[seeded.b])
    assert r.status_code == 409


def test_start_reports_skipped_gif_and_oversize(client, seeded):
    r = _post(client, file_ids=[seeded.a, seeded.gif, seeded.huge], tier="best", scale=4)
    assert r.status_code == 200
    skipped = {s["id"]: s["reason"] for s in r.json()["skipped"]}
    assert skipped[seeded.gif] == "format not supported"
    assert "150 MP" in skipped[seeded.huge]
    ((_, _, args),) = api._enqueued
    assert args[1] == [seeded.a]  # only the runnable file is queued
    seeded.db.expire_all()
    assert seeded.db.get(Job, r.json()["job_id"]).total_files == 1


def test_start_all_skipped_422(client, seeded):
    r = _post(client, file_ids=[seeded.gif])
    assert r.status_code == 422
    assert not api._enqueued


def test_start_unscanned_dims_read_from_header(client, seeded):
    r = _post(client, file_ids=[seeded.unscanned, seeded.a], tier="best", scale=4)
    assert r.status_code == 200
    skipped = {s["id"]: s["reason"] for s in r.json()["skipped"]}
    assert "150 MP" in skipped[seeded.unscanned]


def test_start_shrink_first_runs_model_at_native_scale(client, seeded):
    r = _post(client, file_ids=[seeded.a], tier="best", scale=4, shrink=4)
    assert r.status_code == 200
    ((_, _, args),) = api._enqueued
    assert args[2:] == ("best", 4, False, 4)
    seeded.db.expire_all()
    assert json.loads(seeded.db.get(Job, r.json()["job_id"]).settings)["shrink"] == 4


def test_start_shrink_first_rejects_non_native_scale(client, seeded):
    r = _post(client, file_ids=[seeded.a], tier="best", scale=2, shrink=2)
    assert r.status_code == 422 and "native" in r.json()["detail"]


def test_start_rejects_unknown_shrink(client, seeded):
    assert _post(client, file_ids=[seeded.a], shrink=7).status_code == 422


def test_start_cap_uses_the_shrunk_size(client, seeded):
    # 12 MP at 4x is over the cap; shrunk 4x first it comes back at its own size, so it runs
    r = _post(client, file_ids=[seeded.huge], tier="best", scale=4, shrink=4)
    assert r.status_code == 200 and r.json()["skipped"] == []
