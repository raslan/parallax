import json
import os

import pytest

from app.models.job import Job, JobStatus, JobType
from app.services import subtitle_translate as st
from app.services import translate_packs as tp
from app.services import translator as tr
from app.services.common import request_cancel

SRT = (
    "1\n00:00:01,000 --> 00:00:02,000\nHello <i>there</i>.\n\n2\n00:00:03,000 --> 00:00:04,000\n\n"
)
PACK = {"lang": "ar", "name": "Arabic", "target_token": ">>ara<<", "rtl": True, "files": []}


@pytest.fixture
def env(tmp_path, monkeypatch, fs_db):
    monkeypatch.setattr(tp, "get_pack", lambda lang: PACK if lang == "ar" else None)
    monkeypatch.setattr(tp, "is_installed", lambda pack: True)
    monkeypatch.setattr(tr, "release_sessions", lambda: None)
    media = tmp_path / "media"  # fs_db keeps its own files in tmp_path
    media.mkdir()
    video = media / "Movie (2020).mkv"
    video.write_bytes(b"v")
    (media / "Movie (2020).en.srt").write_text(SRT, encoding="utf-8")

    def fake(pack, texts, is_cancelled, on_progress=None, **kw):
        if on_progress:
            on_progress(len(texts), len(texts))
        return [f"AR:{t}" if t else "" for t in texts]

    monkeypatch.setattr(tr, "translate_texts", fake)
    return video, fs_db


def _job(fs_db) -> int:
    db = fs_db()
    job = Job(type=JobType.SUBTITLE_TRANSLATE, status=JobStatus.PENDING)
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


def test_translate_one_writes_marked_file_with_timings_and_rtl(env):
    video, _ = env
    out = st.translate_one(str(video), "ar", lambda: False)
    assert out.endswith("Movie (2020).ar.translated.srt")
    text = open(out, encoding="utf-8").read()
    assert "00:00:01,000 --> 00:00:02,000\n‫AR:Hello there." in text
    assert "00:00:03,000 --> 00:00:04,000" in text
    # the machine-made file is not the real subtitle: the scan still sees Arabic as missing
    from app.services.subtitle_service import _missing_lang_codes

    assert _missing_lang_codes(str(video), ["ar"]) == ["ar"]
    assert [p for p in os.listdir(video.parent) if p.startswith(".")] == []


def test_refuses_without_a_pack_or_an_english_subtitle(env, monkeypatch):
    video, _ = env
    with pytest.raises(st.TranslateError, match="No language pack"):
        st.translate_one(str(video), "zz", lambda: False)
    monkeypatch.setattr(tp, "is_installed", lambda pack: False)
    with pytest.raises(st.TranslateError, match="not installed"):
        st.translate_one(str(video), "ar", lambda: False)
    monkeypatch.setattr(tp, "is_installed", lambda pack: True)
    os.remove(video.parent / "Movie (2020).en.srt")
    with pytest.raises(st.TranslateError, match="No English subtitle"):
        st.translate_one(str(video), "ar", lambda: False)


def test_a_machine_made_english_file_is_a_valid_source(env):
    video, _ = env
    os.rename(video.parent / "Movie (2020).en.srt", video.parent / "Movie (2020).en.generated.srt")
    assert st.find_source_subtitle(str(video)).endswith("Movie (2020).en.generated.srt")
    assert st.first_problem([str(video)]) is None
    out = st.translate_one(str(video), "ar", lambda: False)
    assert out.endswith("Movie (2020).ar.translated.srt")


def test_translate_keep_existing_writes_translated_2(env):
    video, _ = env
    real = video.parent / "Movie (2020).ar.srt"
    real.write_text("real", encoding="utf-8")
    first = st.translate_one(str(video), "ar", lambda: False)
    second = st.translate_one(str(video), "ar", lambda: False, keep_existing=True)
    assert first.endswith("Movie (2020).ar.translated.srt")
    assert second.endswith("Movie (2020).ar.translated-2.srt")
    assert real.read_text() == "real"
    # without the flag the earlier machine-made file is overwritten, not duplicated
    assert st.translate_one(str(video), "ar", lambda: False) == first


def test_translate_default_source_prefers_plain_real_english(env):
    video, _ = env
    d = video.parent
    (d / "Movie (2020).en.generated.srt").write_text(SRT, encoding="utf-8")
    (d / "Movie (2020).en.hi.srt").write_text(SRT, encoding="utf-8")
    (d / "Movie (2020).en.subf2m.srt").write_text(SRT, encoding="utf-8")
    assert st.find_source_subtitle(str(video)).endswith("Movie (2020).en.srt")
    os.remove(d / "Movie (2020).en.srt")
    assert st.find_source_subtitle(str(video)).endswith("Movie (2020).en.subf2m.srt")
    os.remove(d / "Movie (2020).en.subf2m.srt")
    assert st.find_source_subtitle(str(video)).endswith("Movie (2020).en.hi.srt")
    os.remove(d / "Movie (2020).en.hi.srt")
    assert st.find_source_subtitle(str(video)).endswith("Movie (2020).en.generated.srt")


def test_the_picked_source_is_the_one_translated(env):
    video, _ = env
    other = video.parent / "Movie (2020).en.generated.srt"
    other.write_text(SRT.replace("Hello", "Howdy"), encoding="utf-8")
    out = st.translate_one(str(video), "ar", lambda: False, source=str(other))
    assert "Howdy" in open(out, encoding="utf-8").read()
    assert [s["filename"] for s in st.list_sources(str(video))] == [
        "Movie (2020).en.srt",
        "Movie (2020).en.generated.srt",
    ]


def test_a_real_english_file_is_preferred_over_a_machine_made_one(env):
    video, _ = env
    (video.parent / "Movie (2020).en.generated.srt").write_text(SRT, encoding="utf-8")
    assert st.find_source_subtitle(str(video)).endswith("Movie (2020).en.srt")


def test_cancel_mid_translation_leaves_no_file(env, monkeypatch):
    video, _ = env

    def cancelled(*a, **k):
        raise tr.TranslationCancelled()

    monkeypatch.setattr(tr, "translate_texts", cancelled)
    with pytest.raises(tr.TranslationCancelled):
        st.translate_one(str(video), "ar", lambda: False)
    assert sorted(os.listdir(video.parent)) == ["Movie (2020).en.srt", "Movie (2020).mkv"]


def test_failure_while_writing_leaves_no_partial_or_marker_file(env, monkeypatch):
    video, _ = env

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        st.translate_one(str(video), "ar", lambda: False)
    assert sorted(os.listdir(video.parent)) == ["Movie (2020).en.srt", "Movie (2020).mkv"]


def test_job_completes_and_records_results(env):
    video, fs_db = env
    jid = _job(fs_db)
    st.run_translate_job(jid, [{"video_path": str(video), "lang": "ar"}])
    status, _cur, error, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED and error is None
    assert json.loads(settings)["results"][0]["output"].endswith(".ar.translated.srt")


def test_job_cancelled_while_queued_never_translates(env, monkeypatch):
    video, fs_db = env
    jid = _job(fs_db)
    request_cancel(jid)
    monkeypatch.setattr(tr, "translate_texts", lambda *a, **k: pytest.fail("must not run"))
    st.run_translate_job(jid, [{"video_path": str(video), "lang": "ar"}])
    status, current, _e, _s = _state(fs_db, jid)
    assert status == JobStatus.CANCELLED and current == "0/1 done before cancel"
    assert not (video.parent / "Movie (2020).ar.translated.srt").exists()


def test_job_marked_cancelled_while_waiting_for_a_slot_never_runs(env, monkeypatch):
    video, fs_db = env
    jid = _job(fs_db)
    db = fs_db()
    db.get(
        Job, jid
    ).status = JobStatus.CANCELLED  # what POST /jobs/{id}/cancel does to a queued job
    db.commit()
    db.close()
    monkeypatch.setattr(tr, "translate_texts", lambda *a, **k: pytest.fail("must not run"))
    st.run_translate_job(jid, [{"video_path": str(video), "lang": "ar"}])
    assert _state(fs_db, jid)[0] == JobStatus.CANCELLED
    assert not (video.parent / "Movie (2020).ar.translated.srt").exists()


def test_job_cancel_running_reports_done_before_cancel(env, monkeypatch):
    video, fs_db = env
    tmp_path = video.parent
    second = tmp_path / "Other.mkv"
    second.write_bytes(b"v")
    (tmp_path / "Other.en.srt").write_text(SRT, encoding="utf-8")
    jid = _job(fs_db)
    real = tr.translate_texts
    calls = {"n": 0}

    def second_call_cancels(*a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise tr.TranslationCancelled()
        return real(*a, **k)

    monkeypatch.setattr(tr, "translate_texts", second_call_cancels)
    st.run_translate_job(
        jid,
        [{"video_path": str(video), "lang": "ar"}, {"video_path": str(second), "lang": "ar"}],
    )
    status, current, _e, _s = _state(fs_db, jid)
    assert status == JobStatus.CANCELLED and current == "1/2 done before cancel"
    assert (tmp_path / "Movie (2020).ar.translated.srt").exists()
    assert not (tmp_path / "Other.ar.translated.srt").exists()
    assert [p for p in os.listdir(tmp_path) if p.startswith(".")] == []


def test_job_one_bad_file_does_not_stop_the_batch(env):
    video, fs_db = env
    nosub = video.parent / "Nosub.mkv"
    nosub.write_bytes(b"v")
    jid = _job(fs_db)
    st.run_translate_job(
        jid,
        [{"video_path": str(nosub), "lang": "ar"}, {"video_path": str(video), "lang": "ar"}],
    )
    status, _c, error, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED and "1 of 2" in error
    results = json.loads(settings)["results"]
    assert "error" in results[0] and "output" in results[1]


def test_job_where_every_file_fails_is_failed(env):
    _video, fs_db = env
    nosub = _video.parent / "Nosub.mkv"
    nosub.write_bytes(b"v")
    jid = _job(fs_db)
    st.run_translate_job(jid, [{"video_path": str(nosub), "lang": "ar"}])
    assert _state(fs_db, jid)[0] == JobStatus.FAILED


def test_worker_crash_costs_one_file_not_the_job(env, monkeypatch):
    video, fs_db = env
    from concurrent.futures import BrokenExecutor

    def dead(*a, **k):
        raise BrokenExecutor("worker died")

    monkeypatch.setattr(tr, "translate_texts", dead)
    jid = _job(fs_db)
    st.run_translate_job(jid, [{"video_path": str(video), "lang": "ar"}])
    assert _state(fs_db, jid)[0] == JobStatus.FAILED
    assert not (video.parent / "Movie (2020).ar.translated.srt").exists()


NOTES_SRT = (
    "1\n00:00:01,000 --> 00:00:02,000\n[DISTANT EXPLOSION]\n\n"
    "2\n00:00:03,000 --> 00:00:04,000\nFURY: Get down!\n\n"
    "3\n00:00:05,000 --> 00:00:06,000\n♪ la la ♪\n\n"
)


def test_sound_notes_and_speaker_labels_are_kept_by_default(env):
    video, _ = env
    (video.parent / "Movie (2020).en.srt").write_text(NOTES_SRT, encoding="utf-8")
    out = st.translate_one(str(video), "ar", lambda: False)
    text = open(out, encoding="utf-8").read()
    assert "AR:[DISTANT EXPLOSION]" in text and "AR:FURY: Get down!" in text
    assert "♪ AR:la la ♪" in text  # markers kept aside, only the words translated


def test_drop_hi_removes_notes_labels_and_cues_that_were_only_notes(env):
    video, _ = env
    (video.parent / "Movie (2020).en.srt").write_text(NOTES_SRT, encoding="utf-8")
    out = st.translate_one(str(video), "ar", lambda: False, drop_hi=True)
    text = open(out, encoding="utf-8").read()
    assert "DISTANT" not in text and "FURY" not in text
    assert "AR:Get down!" in text
    assert text.count("-->") == 2  # the note-only cue is gone


def _cards(n):
    from app.services.gpu_pool import GPUDevice

    return [GPUDevice("nvidia", str(i), f"GPU {i}", "nvenc") for i in range(n)]


def test_two_files_run_on_two_cards_at_once_in_one_job(env, monkeypatch):
    video, fs_db = env
    second = video.parent / "Other.mkv"
    second.write_bytes(b"v")
    (video.parent / "Other.en.srt").write_text(SRT, encoding="utf-8")
    monkeypatch.setattr(st, "_gpu_devices", lambda db: _cards(2))
    import threading

    both = threading.Barrier(2, timeout=5)
    used = []

    def fake(pack, texts, is_cancelled, on_progress=None, device="cpu", device_index=0, **kw):
        used.append((device, device_index))
        both.wait()  # only passes when the two files run side by side
        return [f"AR:{t}" if t else "" for t in texts]

    monkeypatch.setattr(tr, "translate_texts", fake)
    jid = _job(fs_db)
    st.run_translate_job(
        jid,
        [{"video_path": str(video), "lang": "ar"}, {"video_path": str(second), "lang": "ar"}],
    )
    assert _state(fs_db, jid)[0] == JobStatus.COMPLETED
    assert sorted(used) == [("cuda", 0), ("cuda", 1)]


def test_a_cuda_error_on_the_card_falls_back_and_the_file_still_finishes(env, monkeypatch):
    video, fs_db = env
    monkeypatch.setattr(st, "_gpu_devices", lambda db: _cards(1))
    devices = []

    def fake(pack, texts, is_cancelled, on_progress=None, device="cpu", device_index=0, **kw):
        devices.append(device)
        if device == "cuda":
            raise RuntimeError("Library libcublas.so.12 is not found or cannot be loaded")
        return [f"AR:{t}" if t else "" for t in texts]

    monkeypatch.setattr(tr, "translate_texts", fake)
    jid = _job(fs_db)
    st.run_translate_job(jid, [{"video_path": str(video), "lang": "ar"}])
    assert _state(fs_db, jid)[0] == JobStatus.COMPLETED and devices == ["cuda", "cpu"]
    assert (video.parent / "Movie (2020).ar.translated.srt").exists()
    db = fs_db()
    from app.models.job import JobLog

    msgs = [r.message for r in db.query(JobLog).filter(JobLog.job_id == jid)]
    db.close()
    assert any("GPU could not start" in m for m in msgs) and any("on the CPU" in m for m in msgs)
