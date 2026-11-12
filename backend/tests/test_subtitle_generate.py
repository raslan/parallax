import json
import os

import pytest

from app.models.job import Job, JobStatus, JobType
from app.services import speech
from app.services import subtitle_generate as sg
from app.services import subtitle_translate as st
from app.services import translate_packs as tp
from app.services.common import request_cancel

MODEL = {"lang": "whisper-small", "name": "Whisper small", "kind": "speech", "files": []}


@pytest.fixture
def env(tmp_path, monkeypatch, fs_db):
    monkeypatch.setattr(tp, "get_pack", lambda i: MODEL if i == "whisper-small" else None)
    monkeypatch.setattr(tp, "is_installed", lambda pack: True)
    monkeypatch.setattr(speech, "release_sessions", lambda: None)
    media = tmp_path / "media"
    media.mkdir()
    video = media / "Movie (2020).mkv"
    video.write_bytes(b"v")

    def fake_extract(video_path, out_path, is_cancelled):
        with open(out_path, "wb") as f:
            f.write(b"\0" * 4 * speech.SAMPLE_RATE * 20)  # 20 s of audio

    def fake_transcribe(model, audio_path, duration, language, is_cancelled, on_progress=None, **k):
        if on_progress:
            on_progress(100.0)
        return [
            (0.5, 2.0, "Hello there."),
            (3.0, 5.5, "This is a rather long line that has to wrap onto a second line."),
            (6.0, 7.0, ""),
        ], "en"

    monkeypatch.setattr(speech, "extract_audio", fake_extract)
    monkeypatch.setattr(speech, "transcribe", fake_transcribe)
    return video, fs_db


def _job(fs_db) -> int:
    db = fs_db()
    job = Job(type=JobType.SUBTITLE_GENERATE, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    jid = job.id
    db.close()
    return jid


def _state(fs_db, jid):
    db = fs_db()
    job = db.get(Job, jid)
    out = (job.status, job.current_file, job.error, job.settings)
    db.close()
    return out


def test_generate_writes_a_machine_made_english_subtitle(env):
    video, _ = env
    out = sg.generate_one(str(video), MODEL, "en", lambda: False)
    assert out.endswith("Movie (2020).en.mt.srt")
    text = open(out, encoding="utf-8").read()
    assert "00:00:00,500 --> 00:00:02,000\nHello there." in text
    assert text.count("-->") == 2  # the empty segment is dropped
    assert "\n" in text.split("00:00:03,000 --> 00:00:05,500\n")[1].split("\n\n")[0]  # wrapped
    # a machine-made English file is not the real one: the scan still wants a real subtitle
    from app.services.subtitle_service import _missing_lang_codes

    assert _missing_lang_codes(str(video), ["en"]) == ["en"]
    assert sorted(os.listdir(video.parent)) == ["Movie (2020).en.mt.srt", "Movie (2020).mkv"]
    assert not [
        d for d in os.listdir(os.path.dirname(video.parent)) if d.startswith("parallax-stt")
    ]


def test_cancel_leaves_no_file_and_no_temp_audio(env, monkeypatch):
    video, _ = env

    def cancelled(*a, **k):
        raise speech.SpeechCancelled()

    monkeypatch.setattr(speech, "transcribe", cancelled)
    with pytest.raises(speech.SpeechCancelled):
        sg.generate_one(str(video), MODEL, "en", lambda: False)
    assert os.listdir(video.parent) == ["Movie (2020).mkv"]


def test_job_completes_and_records_results(env):
    video, fs_db = env
    jid = _job(fs_db)
    sg.run_generate_job(jid, [{"video_path": str(video), "model": "whisper-small"}], [])
    status, _c, error, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED and error is None
    assert json.loads(settings)["results"][0]["output"].endswith(".en.mt.srt")


def test_job_cancelled_while_queued_or_waiting_never_runs(env, monkeypatch):
    video, fs_db = env
    monkeypatch.setattr(speech, "extract_audio", lambda *a, **k: pytest.fail("must not run"))
    jid = _job(fs_db)
    request_cancel(jid)
    sg.run_generate_job(jid, [{"video_path": str(video), "model": "whisper-small"}], [])
    status, current, _e, _s = _state(fs_db, jid)
    assert status == JobStatus.CANCELLED and current == "0/1 done before cancel"
    jid2 = _job(fs_db)
    db = fs_db()
    db.get(Job, jid2).status = JobStatus.CANCELLED
    db.commit()
    db.close()
    sg.run_generate_job(jid2, [{"video_path": str(video), "model": "whisper-small"}], [])
    assert _state(fs_db, jid2)[0] == JobStatus.CANCELLED
    assert os.listdir(video.parent) == ["Movie (2020).mkv"]


def test_job_cancel_mid_run_reports_done_before_cancel(env, monkeypatch, tmp_path):
    video, fs_db = env
    second = video.parent / "Other.mkv"
    second.write_bytes(b"v")
    calls = {"n": 0}
    real = speech.transcribe

    def second_cancels(*a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise speech.SpeechCancelled()
        return real(*a, **k)

    monkeypatch.setattr(speech, "transcribe", second_cancels)
    jid = _job(fs_db)
    sg.run_generate_job(
        jid,
        [
            {"video_path": str(video), "model": "whisper-small"},
            {"video_path": str(second), "model": "whisper-small"},
        ],
        [],
    )
    status, current, _e, _s = _state(fs_db, jid)
    assert status == JobStatus.CANCELLED and current == "1/2 done before cancel"
    assert (video.parent / "Movie (2020).en.mt.srt").exists()
    assert not (video.parent / "Other.en.mt.srt").exists()
    assert sorted(p for p in os.listdir(video.parent) if p.startswith(".")) == []


def test_a_video_without_audio_fails_alone(env, monkeypatch):
    video, fs_db = env

    def no_audio(*a, **k):
        raise speech.SpeechError("The video has no audio to transcribe.")

    monkeypatch.setattr(speech, "extract_audio", no_audio)
    jid = _job(fs_db)
    sg.run_generate_job(jid, [{"video_path": str(video), "model": "whisper-small"}], [])
    status, _c, error, _s = _state(fs_db, jid)
    assert status == JobStatus.FAILED and "no audio" in error
    assert os.listdir(video.parent) == ["Movie (2020).mkv"]


def test_then_translate_chains_from_the_generated_file(env, monkeypatch):
    video, fs_db = env
    seen = {}

    def fake_translate(video_path, lang, is_cancelled, on_progress=None, **kw):
        seen.update(video=video_path, lang=lang, source=kw.get("source"))
        return "out"

    monkeypatch.setattr(st, "translate_one", fake_translate)
    jid = _job(fs_db)
    sg.run_generate_job(jid, [{"video_path": str(video), "model": "whisper-small"}], ["ar"])
    assert seen["lang"] == "ar" and seen["source"].endswith("Movie (2020).en.mt.srt")
    assert _state(fs_db, jid)[0] == JobStatus.COMPLETED
