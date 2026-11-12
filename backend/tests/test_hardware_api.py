import pytest

from app.models.job import Job, JobStatus, JobType
from app.services import gpu_accel as ga
from app.services.gpu_pool import GPUDevice


@pytest.fixture(autouse=True)
def _clean_jobs(engine):
    from sqlalchemy.orm import sessionmaker

    def wipe():
        s = sessionmaker(bind=engine)()
        s.query(Job).filter(
            Job.type.in_([JobType.NVIDIA_PACKAGE, JobType.SUBTITLE_TRANSLATE])
        ).delete()
        s.commit()
        s.close()

    wipe()
    yield sessionmaker(bind=engine)
    wipe()


@pytest.fixture
def enqueued(monkeypatch):
    calls = []

    async def fake(job_id, fn, *args):
        calls.append((job_id, fn.__name__, args))

    monkeypatch.setattr("app.api.hardware.enqueue", fake)
    return calls


def test_hardware_reports_cards_and_the_package_state(client, monkeypatch, tmp_path):
    cards = [GPUDevice("nvidia", "0", "RTX A", "nvenc"), GPUDevice("nvidia", "1", "RTX B", "nvenc")]
    monkeypatch.setattr("app.api.hardware.detect_gpus", lambda: cards)
    monkeypatch.setattr(ga, "nvidia_devices", lambda: cards)
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(tmp_path / "none"))
    body = client.get("/api/hardware").json()
    assert [g["label"] for g in body["gpus"]] == ["RTX A", "RTX B"]
    n = body["nvidia"]
    assert n["installed"] is False and n["nvidia_gpus"] == 2 and n["gpus_in_use"] == 0
    assert n["enabled"] is True and n["gpu_count"] == 0


def test_the_slider_and_the_switch_are_saved_and_limit_the_cards_in_use(
    client, monkeypatch, tmp_path
):
    cards = [GPUDevice("nvidia", str(i), f"RTX {i}", "nvenc") for i in range(2)]
    monkeypatch.setattr("app.api.hardware.detect_gpus", lambda: cards)
    monkeypatch.setattr(ga, "nvidia_devices", lambda: cards)
    monkeypatch.setattr(ga, "installed", lambda: True)
    r = client.patch("/api/settings", json={"gpu_accel_count": 1})
    assert r.status_code == 200 and r.json()["gpu_accel_count"] == 1
    assert client.get("/api/hardware").json()["nvidia"]["gpus_in_use"] == 1
    client.patch("/api/settings", json={"gpu_accel_enabled": False})
    assert client.get("/api/hardware").json()["nvidia"]["gpus_in_use"] == 0
    client.patch("/api/settings", json={"gpu_accel_enabled": True, "gpu_accel_count": 0})
    assert client.get("/api/hardware").json()["nvidia"]["gpus_in_use"] == 2
    assert client.patch("/api/settings", json={"gpu_accel_count": -1}).status_code == 422


def test_install_queues_one_job_and_blocks_a_second(client, enqueued):
    r = client.post("/api/hardware/nvidia/install")
    assert r.status_code == 202 and enqueued[0][1] == "run_install_job"
    assert client.post("/api/hardware/nvidia/install").status_code == 409
    assert client.get("/api/hardware").json()["nvidia"]["installing_job_id"] == r.json()["job_id"]
    assert client.delete("/api/hardware/nvidia").status_code == 409


def test_update_and_remove_wait_for_running_gpu_jobs(client, enqueued, _clean_jobs):
    db = _clean_jobs()
    db.add(Job(type=JobType.SUBTITLE_TRANSLATE, status=JobStatus.RUNNING))
    db.commit()
    db.close()
    assert client.post("/api/hardware/nvidia/install").status_code == 409
    assert client.delete("/api/hardware/nvidia").status_code == 409


def test_remove_and_check_when_nothing_is_installed(client, monkeypatch, tmp_path):
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(tmp_path / "none"))
    assert client.delete("/api/hardware/nvidia").status_code == 404
    body = client.post("/api/hardware/nvidia/check").json()
    assert body["ok"] is False and "not installed" in body["message"]
