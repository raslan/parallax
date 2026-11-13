import pytest

from app.models.job import Job, JobStatus, JobType
from app.services import translate_packs as tp

SRT = "1\n00:00:01,000 --> 00:00:02,000\nHi.\n\n"


@pytest.fixture(autouse=True)
def _clean_jobs(engine):
    """`client` writes to the shared test DB, so jobs made here must not leak into other tests."""
    from sqlalchemy.orm import sessionmaker

    def wipe():
        s = sessionmaker(bind=engine)()
        s.query(Job).filter(
            Job.type.in_(
                [JobType.PACK_DOWNLOAD, JobType.SUBTITLE_TRANSLATE, JobType.SUBTITLE_GENERATE]
            )
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

    monkeypatch.setattr("app.api.subtitle_packs.enqueue", fake)
    monkeypatch.setattr("app.api.subtitles.enqueue", fake)
    return calls


@pytest.fixture
def packs_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(tp, "PACKS_DIR", str(tmp_path / "packs"))
    return tmp_path / "packs"


def test_list_shows_arabic_not_installed(client, packs_dir):
    rows = client.get("/api/subtitle-packs").json()
    ar = next(r for r in rows if r["lang"] == "ar")
    assert ar["installed"] is False and ar["size_bytes"] > 400_000_000
    assert ar["licence"] == "CC BY 4.0" and ar["installing_job_id"] is None


def test_install_enqueues_a_job_and_blocks_a_second(client, packs_dir, enqueued):
    r = client.post("/api/subtitle-packs/ar/install")
    assert r.status_code == 202
    assert enqueued[0][1] == "run_pack_install_job" and enqueued[0][2] == (r.json()["job_id"], "ar")
    assert client.post("/api/subtitle-packs/ar/install").status_code == 409
    ar = next(x for x in client.get("/api/subtitle-packs").json() if x["lang"] == "ar")
    assert ar["installing_job_id"] == r.json()["job_id"]
    assert client.delete("/api/subtitle-packs/ar").status_code == 409


def test_unknown_pack_is_404(client, packs_dir):
    assert client.post("/api/subtitle-packs/zz/install").status_code == 404
    assert client.delete("/api/subtitle-packs/zz").status_code == 404


def test_remove_not_installed_is_404(client, packs_dir):
    assert client.delete("/api/subtitle-packs/ar").status_code == 404


def test_remove_blocked_while_a_translation_runs(client, packs_dir, monkeypatch, _clean_jobs):
    monkeypatch.setattr(tp, "remove_pack", lambda pack: True)
    db = _clean_jobs()
    db.add(Job(type=JobType.SUBTITLE_TRANSLATE, status=JobStatus.RUNNING))
    db.commit()
    db.close()
    assert client.delete("/api/subtitle-packs/ar").status_code == 409


def test_translate_needs_an_installed_pack(client, packs_dir, tmp_path, enqueued):
    v = tmp_path / "M.mkv"
    v.write_bytes(b"v")
    r = client.post("/api/subtitles/translate", json={"file_paths": [str(v)], "language": "ar"})
    assert r.status_code == 409 and "Settings → Subtitles" in r.json()["detail"]


def test_translate_validates_files_and_queues(client, packs_dir, tmp_path, enqueued, monkeypatch):
    monkeypatch.setattr(tp, "is_installed", lambda pack: True)
    v = tmp_path / "M.mkv"
    v.write_bytes(b"v")
    body = {"file_paths": [str(v)], "language": "ar"}
    assert (
        client.post("/api/subtitles/translate", json={**body, "language": "zz"}).status_code == 422
    )
    assert (
        client.post("/api/subtitles/translate", json={**body, "file_paths": []}).status_code == 422
    )
    missing = {**body, "file_paths": [str(tmp_path / "nope.mkv")]}
    assert client.post("/api/subtitles/translate", json=missing).status_code == 400
    # no English subtitle yet
    assert client.post("/api/subtitles/translate", json=body).status_code == 422
    (tmp_path / "M.en.srt").write_text(SRT)
    (tmp_path / "M.ar.srt").write_text(SRT)  # a real Arabic subtitle exists: nothing to do
    assert client.post("/api/subtitles/translate", json=body).status_code == 422
    (tmp_path / "M.ar.srt").unlink()
    r = client.post("/api/subtitles/translate", json=body)
    assert r.status_code == 200
    assert enqueued[-1][1] == "run_translate_job"
    assert enqueued[-1][2][1] == [
        {"video_path": str(v), "lang": "ar", "drop_hi": False, "source": None}
    ]


def test_speech_models_list_and_do_not_mix_with_language_packs(client, packs_dir):
    rows = client.get("/api/speech-models").json()
    assert [r["lang"] for r in rows] == ["whisper-small", "whisper-medium"]
    assert rows[0]["size_bytes"] > 400_000_000 and rows[1]["size_bytes"] > 1_400_000_000
    assert all(r["licence"] == "MIT" for r in rows)
    assert "whisper-small" not in [r["lang"] for r in client.get("/api/subtitle-packs").json()]
    assert client.post("/api/subtitle-packs/whisper-small/install").status_code == 404
    assert client.post("/api/speech-models/ar/install").status_code == 404


def test_speech_model_install_job_and_conflict(client, packs_dir, enqueued):
    r = client.post("/api/speech-models/whisper-small/install")
    assert r.status_code == 202
    assert enqueued[0][1] == "run_pack_install_job"
    assert enqueued[0][2] == (r.json()["job_id"], "whisper-small")
    assert client.post("/api/speech-models/whisper-small/install").status_code == 409
    assert client.delete("/api/speech-models/whisper-small").status_code == 409


def test_generate_needs_the_model_and_an_audio_file(
    client, packs_dir, tmp_path, enqueued, monkeypatch
):
    v = tmp_path / "M.mkv"
    v.write_bytes(b"v")
    body = {"file_paths": [str(v)]}
    assert client.post("/api/subtitles/generate", json=body).status_code == 409
    assert client.post("/api/subtitles/generate", json={**body, "model": "huge"}).status_code == 422
    monkeypatch.setattr(tp, "is_installed", lambda pack: True)
    assert (
        client.post("/api/subtitles/generate", json={**body, "file_paths": []}).status_code == 422
    )
    (tmp_path / "M.en.srt").write_text(SRT)  # a real English subtitle exists: nothing to do
    assert client.post("/api/subtitles/generate", json=body).status_code == 422
    (tmp_path / "M.en.srt").unlink()
    (tmp_path / "M.en.machine.srt").write_text(SRT)  # a machine-made one does not block a new run
    r = client.post("/api/subtitles/generate", json=body)
    assert r.status_code == 200
    assert enqueued[-1][1] == "run_generate_job"
    assert enqueued[-1][2][1] == [{"video_path": str(v), "model": "whisper-small"}]
    assert len(enqueued[-1][2]) == 2  # no hidden translation step


def test_translate_refuses_a_speech_model_as_a_language(client, packs_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(tp, "is_installed", lambda pack: True)
    v = tmp_path / "M.mkv"
    v.write_bytes(b"v")
    (tmp_path / "M.en.srt").write_text(SRT)
    body = {"file_paths": [str(v)], "language": "whisper-small"}
    assert client.post("/api/subtitles/translate", json=body).status_code == 422


def test_a_language_pack_can_go_while_a_generate_job_runs(
    client, packs_dir, monkeypatch, _clean_jobs
):
    # generating only transcribes now, so it never uses a language pack
    monkeypatch.setattr(tp, "remove_pack", lambda pack: True)
    db = _clean_jobs()
    db.add(Job(type=JobType.SUBTITLE_GENERATE, status=JobStatus.RUNNING))
    db.commit()
    db.close()
    assert client.delete("/api/subtitle-packs/ar").status_code == 204


def _translate_setup(tmp_path, monkeypatch):
    monkeypatch.setattr(tp, "is_installed", lambda pack: True)
    v = tmp_path / "M.mkv"
    v.write_bytes(b"v")
    (tmp_path / "M.en.srt").write_text(SRT)
    (tmp_path / "M.en.machine.srt").write_text(SRT)
    (tmp_path / "M.fr.srt").write_text(SRT)
    return v


def test_translate_sources_lists_every_english_srt_real_first(
    client, packs_dir, tmp_path, monkeypatch
):
    v = _translate_setup(tmp_path, monkeypatch)
    rows = client.get("/api/subtitles/translate-sources", params={"path": str(v)}).json()
    assert [r["filename"] for r in rows] == [
        "M.en.srt",
        "M.en.machine.srt",
    ]  # French is not offered
    assert [r["machine_made"] for r in rows] == [False, True]
    assert (
        client.get("/api/subtitles/translate-sources", params={"path": "/nope"}).status_code == 404
    )


def test_translate_uses_the_source_the_user_picked(
    client, packs_dir, tmp_path, enqueued, monkeypatch
):
    v = _translate_setup(tmp_path, monkeypatch)
    picked = str(tmp_path / "M.en.machine.srt")
    body = {"file_paths": [str(v)], "language": "ar", "source": picked}
    r = client.post("/api/subtitles/translate", json=body)
    assert r.status_code == 200
    assert enqueued[-1][2][1][0]["source"] == picked


def test_translate_refuses_a_source_that_is_not_an_english_subtitle_of_the_video(
    client, packs_dir, tmp_path, enqueued, monkeypatch
):
    v = _translate_setup(tmp_path, monkeypatch)
    other = tmp_path / "secret.txt"
    other.write_text("x")
    for bad in (str(other), str(tmp_path / "M.fr.srt")):
        body = {"file_paths": [str(v)], "language": "ar", "source": bad}
        r = client.post("/api/subtitles/translate", json=body)
        assert r.status_code == 422 and "not an English subtitle" in r.json()["detail"]
    two = {"file_paths": [str(v), str(tmp_path / "M.en.srt")], "language": "ar"}
    assert (
        client.post("/api/subtitles/translate", json={**two, "source": str(v)}).status_code == 422
    )
    assert not enqueued
