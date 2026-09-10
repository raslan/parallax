import pytest
from sqlalchemy.orm import sessionmaker

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.job import Job, JobType


@pytest.fixture
def seeded(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = AudioLibrary(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()
    f1 = AudioFile(
        library_id=lib.id,
        path=str(tmp_path / "a.mp3"),
        filename="a.mp3",
        extension=".mp3",
        size=1000,
        duration=120.0,
        codec_name="mp3",
        bitrate=128000,
    )
    f2 = AudioFile(
        library_id=lib.id,
        path=str(tmp_path / "b.mp3"),
        filename="b.mp3",
        extension=".mp3",
        size=1000,
        duration=5.0,
        codec_name="mp3",
        bitrate=128000,
    )
    db.add_all([f1, f2])
    db.commit()
    ids = (lib.id, f1.id, f2.id)
    db.close()
    return ids


def test_start_rejects_empty_file_ids(client):
    r = client.post("/api/audio-toolbox/start", json={"file_ids": []})
    assert r.status_code == 422


def test_start_rejects_no_fix_selected(client, seeded):
    _lib, f1, _f2 = seeded
    r = client.post("/api/audio-toolbox/start", json={"file_ids": [f1]})
    assert r.status_code == 422
    assert "fix" in r.json()["detail"].lower()


def test_start_rejects_bad_channel_op(client, seeded):
    _lib, f1, _f2 = seeded
    r = client.post(
        "/api/audio-toolbox/start",
        json={"file_ids": [f1], "channel_op": "surround"},
    )
    assert r.status_code == 422


def test_start_rejects_trim_longer_than_duration(client, seeded):
    _lib, _f1, f2 = seeded  # f2 duration is 5.0 s
    r = client.post(
        "/api/audio-toolbox/start",
        json={"file_ids": [f2], "trim_start": 3.0, "trim_end": 3.0},
    )
    assert r.status_code == 422
    assert "b.mp3" in r.json()["detail"]


def test_start_rejects_cross_library_selection(client, seeded, engine):
    _lib, f1, _f2 = seeded
    from sqlalchemy.orm import sessionmaker

    Session = sessionmaker(bind=engine)
    db = Session()
    other = AudioLibrary(name="O", path="/tmp/other")
    db.add(other)
    db.commit()
    stray = AudioFile(
        library_id=other.id,
        path="/tmp/other/c.mp3",
        filename="c.mp3",
        extension=".mp3",
        size=1,
        duration=60.0,
        codec_name="mp3",
        bitrate=128000,
    )
    db.add(stray)
    db.commit()
    stray_id = stray.id
    db.close()

    r = client.post(
        "/api/audio-toolbox/start",
        json={"file_ids": [f1, stray_id], "normalize": True},
    )
    assert r.status_code == 422


def test_start_creates_pending_job(client, seeded, engine):
    lib, f1, _f2 = seeded
    r = client.post(
        "/api/audio-toolbox/start",
        json={"file_ids": [f1], "normalize": True, "keep_original": True},
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    from sqlalchemy.orm import sessionmaker

    Session = sessionmaker(bind=engine)
    db = Session()
    job = db.get(Job, job_id)
    assert job.type == JobType.AUDIO_TOOLBOX
    assert job.library_id == lib
    assert job.total_files == 1
    db.close()
