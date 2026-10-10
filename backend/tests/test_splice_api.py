import subprocess

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.file import File
from app.models.library import Library

_CLIP_CACHE: dict[tuple, bytes] = {}


def _clip(path, size="320x240", rate=25, audio=True):
    key = (size, rate, audio)
    if key not in _CLIP_CACHE:
        args = ["ffmpeg", "-y", "-f", "lavfi", "-i", f"testsrc=duration=1:size={size}:rate={rate}"]
        if audio:
            args += ["-f", "lavfi", "-i", "sine=duration=1:frequency=440:sample_rate=48000"]
        args += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
        if audio:
            args += ["-c:a", "aac", "-shortest"]
        out = path.with_name(f".cache-{size}-{rate}-{audio}.mp4")
        subprocess.run([*args, str(out)], check=True, capture_output=True)
        _CLIP_CACHE[key] = out.read_bytes()
        out.unlink()
    path.write_bytes(_CLIP_CACHE[key])


@pytest.fixture
def seeded(engine, tmp_path, monkeypatch):
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr("app.api.splice.SessionLocal", Session)  # routes open SessionLocal directly
    db = Session()
    lib = Library(name="L", path=str(tmp_path))
    other = Library(name="O", path=str(tmp_path / "other"))
    db.add_all([lib, other])
    db.commit()
    rows = {}
    for name, kw in {
        "a.mp4": {},
        "b.mp4": {},
        "c_small.mp4": {"size": "160x120"},
    }.items():
        p = tmp_path / name
        _clip(p, **kw)
        f = File(
            library_id=lib.id,
            path=str(p),
            filename=name,
            extension="mp4",
            size=p.stat().st_size,
            duration=1.0,
        )
        db.add(f)
        rows[name] = f
    foreign = File(
        library_id=other.id, path=str(tmp_path / "z.mp4"), filename="z.mp4", extension="mp4", size=1
    )
    db.add(foreign)
    db.commit()
    ids = {k: v.id for k, v in rows.items()} | {"foreign": foreign.id}
    yield ids, tmp_path
    db.query(File).delete()
    db.query(Library).delete()
    db.commit()
    db.close()


def test_preflight_compatible_is_copy(client, seeded):
    ids, tmp = seeded
    r = client.post("/api/splice/preflight", json={"file_ids": [ids["a.mp4"], ids["b.mp4"]]})
    assert r.status_code == 200
    body = r.json()
    assert body["verdict"] == "copy"
    assert body["output_ext"] == ".mp4"
    assert body["output_dir"] == str(tmp)
    assert [f["reasons"] for f in body["files"]] == [[], []]
    assert body["total_size"] > 0 and body["free_bytes"] > 0


def test_preflight_mismatch_is_reencode_with_reasons(client, seeded):
    ids, _ = seeded
    r = client.post("/api/splice/preflight", json={"file_ids": [ids["a.mp4"], ids["c_small.mp4"]]})
    body = r.json()
    assert body["verdict"] == "reencode"
    assert any("resolution" in x for x in body["files"][1]["reasons"])


def test_preflight_name_conflict_ignores_sources_but_flags_others(client, seeded):
    ids, tmp = seeded
    (tmp / "taken.mp4").write_bytes(b"x")
    pair = [ids["a.mp4"], ids["b.mp4"]]
    assert (
        client.post(
            "/api/splice/preflight", json={"file_ids": pair, "output_name": "taken"}
        ).json()["name_conflict"]
        is True
    )
    assert (
        client.post("/api/splice/preflight", json={"file_ids": pair, "output_name": "a"}).json()[
            "name_conflict"
        ]
        is False
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"file_ids": []},
        {"file_ids": [1]},
    ],
)
def test_preflight_needs_two_files(client, payload):
    assert client.post("/api/splice/preflight", json=payload).status_code == 422


def test_preflight_rejects_duplicates_unknown_and_mixed_library(client, seeded):
    ids, _ = seeded
    a = ids["a.mp4"]
    assert client.post("/api/splice/preflight", json={"file_ids": [a, a]}).status_code == 422
    assert client.post("/api/splice/preflight", json={"file_ids": [a, 999999]}).status_code == 422
    assert (
        client.post("/api/splice/preflight", json={"file_ids": [a, ids["foreign"]]}).status_code
        == 422
    )


def test_preflight_bad_name_422(client, seeded):
    ids, _ = seeded
    r = client.post(
        "/api/splice/preflight",
        json={"file_ids": [ids["a.mp4"], ids["b.mp4"]], "output_name": "../x"},
    )
    assert r.status_code == 422


def test_merge_conflict_409_and_reencode_required(client, seeded, monkeypatch):
    ids, tmp = seeded
    (tmp / "taken.mp4").write_bytes(b"x")
    pair = [ids["a.mp4"], ids["b.mp4"]]
    r = client.post(
        "/api/splice/merge", json={"file_ids": pair, "output_name": "taken", "chapters": False}
    )
    assert r.status_code == 409
    mixed = [ids["a.mp4"], ids["c_small.mp4"]]
    r = client.post(
        "/api/splice/merge", json={"file_ids": mixed, "output_name": "new", "chapters": False}
    )
    assert r.status_code == 422  # verdict reencode but no reencode settings


def test_retry_cpu_requires_failed_gpu_splice_job(client, seeded, monkeypatch):
    ids, _ = seeded
    queued = {}

    async def fake_enqueue(job_id, fn, *args):
        queued["args"] = args

    monkeypatch.setattr("app.api.splice.enqueue", fake_enqueue)
    # a failed GPU job is retryable; settings gain force_cpu
    r = client.post(
        "/api/splice/merge",
        json={"file_ids": [ids["a.mp4"], ids["b.mp4"]], "output_name": "joined", "chapters": False},
    )
    job_id = r.json()["job_id"]
    import app.api.splice as api

    db = api.SessionLocal()  # patched to the test engine by `seeded`
    job = db.get(api.Job, job_id)
    job.status = "failed"
    job.error = "GPU encode failed: boom"
    db.commit()
    db.close()
    r2 = client.post(f"/api/splice/jobs/{job_id}/retry-cpu")
    assert r2.status_code == 200 and r2.json()["job_id"] != job_id
    assert queued["args"][-1]["force_cpu"] is True
    # a non-GPU failure is not retryable
    db = api.SessionLocal()
    job = db.get(api.Job, job_id)
    job.error = "something else"
    db.commit()
    db.close()
    assert client.post(f"/api/splice/jobs/{job_id}/retry-cpu").status_code == 409
    assert client.post("/api/splice/jobs/999999/retry-cpu").status_code == 404


def test_merge_enqueues_job(client, seeded, monkeypatch):
    ids, _ = seeded
    queued = {}

    async def fake_enqueue(job_id, fn, *args):
        queued["job_id"] = job_id

    monkeypatch.setattr("app.api.splice.enqueue", fake_enqueue)
    r = client.post(
        "/api/splice/merge",
        json={"file_ids": [ids["a.mp4"], ids["b.mp4"]], "output_name": "joined", "chapters": True},
    )
    assert r.status_code == 200 and r.json()["job_id"] == queued["job_id"]


def test_routes_probe_without_holding_a_db_session(client, seeded, monkeypatch):
    ids, _ = seeded
    import app.api.splice as api
    import app.services.splice as sp

    real_factory = api.SessionLocal
    open_sessions = {"n": 0}

    def tracking():
        s = real_factory()
        open_sessions["n"] += 1
        real_close = s.close

        def close():
            open_sessions["n"] -= 1
            real_close()

        s.close = close
        return s

    seen = []
    real_probe = sp.probe_facts

    def probe(path):
        seen.append(open_sessions["n"])
        return real_probe(path)

    async def fake_enqueue(job_id, fn, *args):
        pass

    monkeypatch.setattr(api, "SessionLocal", tracking)
    monkeypatch.setattr(sp, "probe_facts", probe)
    monkeypatch.setattr(api, "enqueue", fake_enqueue)
    pair = [ids["a.mp4"], ids["b.mp4"]]
    assert client.post("/api/splice/preflight", json={"file_ids": pair}).status_code == 200
    r = client.post("/api/splice/merge", json={"file_ids": pair, "output_name": "joined2"})
    assert r.status_code == 200
    assert len(seen) == 4 and seen == [0, 0, 0, 0]
