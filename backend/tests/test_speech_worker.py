"""The real worker plumbing for speech-to-text, with a stand-in for faster-whisper.

A real spawned worker, real ffmpeg and the real cancel and progress files are used; only the
model is replaced by a stub package that yields a segment every 0.2 s, so no model download is
needed. (The real model is checked on the demo stack.)
"""

import os
import subprocess
import time

import pytest

from app.services import speech

STUB = """
import time

class _Seg:
    def __init__(self, start, end, text):
        self.start, self.end, self.text = start, end, text

class _Info:
    language = "en"

class WhisperModel:
    def __init__(self, path, **kw):
        self.path = path

    def transcribe(self, audio, **kw):
        assert audio.dtype.name == "float32" and kw.get("vad_filter") is True
        def gen():
            for i in range(50):
                time.sleep(0.2)
                yield _Seg(i * 1.0, i * 1.0 + 0.9, f" line {i} ")
        return gen(), _Info()
"""


@pytest.fixture
def stub_whisper(tmp_path, monkeypatch):
    d = tmp_path / "stub"
    d.mkdir()
    (d / "faster_whisper.py").write_text(STUB)
    monkeypatch.syspath_prepend(str(d))  # spawned workers inherit sys.path
    speech.release_sessions()  # a fresh worker, so it sees the stub on sys.path
    yield
    speech.release_sessions()


def make_audio(path, seconds=2):
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
         f"sine=frequency=440:duration={seconds}", "-y", str(path)],
        check=True,
    )  # fmt: skip


def test_extract_audio_makes_raw_float32_at_16khz(tmp_path):
    src, out = tmp_path / "a.mp3", tmp_path / "a.f32"
    make_audio(src, 3)
    speech.extract_audio(str(src), str(out), lambda: False)
    assert abs(os.path.getsize(out) / 4 / speech.SAMPLE_RATE - 3.0) < 0.2


def test_a_file_with_no_audio_stream_says_so(tmp_path):
    src = tmp_path / "v.mkv"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1",
         "-an", "-y", str(src)],
        check=True,
    )  # fmt: skip
    with pytest.raises(speech.SpeechError, match="no audio"):
        speech.extract_audio(str(src), str(tmp_path / "o.f32"), lambda: False)
    assert not (tmp_path / "o.f32").exists() or os.path.getsize(tmp_path / "o.f32") == 0


def test_cancel_kills_ffmpeg(tmp_path):
    src = tmp_path / "long.mp3"
    make_audio(src, 5)
    t = time.monotonic()
    with pytest.raises(speech.SpeechCancelled):
        speech.extract_audio(str(src), str(tmp_path / "o.f32"), lambda: True)
    assert time.monotonic() - t < 3


def test_the_worker_transcribes_and_reports_progress(tmp_path, stub_whisper):
    audio = tmp_path / "audio.f32"
    audio.write_bytes(b"\0" * 4 * speech.SAMPLE_RATE * 50)
    seen = []
    segments, lang = speech.transcribe(
        {"lang": "whisper-small", "dir": "whisper/small"},
        str(audio),
        50.0,
        "en",
        lambda: False,
        on_progress=seen.append,
    )
    assert lang == "en" and len(segments) == 50 and segments[0] == (0.0, 0.9, "line 0")
    assert seen and max(seen) > 50  # progress was read from the worker's progress file
    assert [p for p in os.listdir(tmp_path) if "state" in p] == []


def test_cancel_stops_the_worker_between_segments_and_cleans_up(tmp_path, stub_whisper):
    audio = tmp_path / "audio.f32"
    audio.write_bytes(b"\0" * 4 * speech.SAMPLE_RATE * 50)
    started = time.monotonic()
    with pytest.raises(speech.SpeechCancelled):
        speech.transcribe(
            {"lang": "whisper-small", "dir": "whisper/small"},
            str(audio),
            50.0,
            "en",
            lambda: time.monotonic() - started > 1.5,
        )
    assert time.monotonic() - started < 6  # the full run would take about 10 s
    assert [p for p in os.listdir(tmp_path) if "state" in p] == []


def test_a_worker_that_will_not_stop_is_terminated(tmp_path, monkeypatch):
    d = tmp_path / "stub"
    d.mkdir()
    (d / "faster_whisper.py").write_text(
        STUB.replace("time.sleep(0.2)", "time.sleep(60)")  # one segment takes a minute
    )
    monkeypatch.syspath_prepend(str(d))
    speech.release_sessions()  # a fresh worker, so it sees the stub on sys.path
    audio = tmp_path / "audio.f32"
    audio.write_bytes(b"\0" * 4 * speech.SAMPLE_RATE * 5)
    from app.services import worker_common

    real = worker_common.WorkerPool.submit_cancellable
    monkeypatch.setattr(
        worker_common.WorkerPool,
        "submit_cancellable",
        lambda self, fn, *a, is_cancelled, **k: real(
            self, fn, *a, is_cancelled=is_cancelled, grace=1.0
        ),
    )
    started = time.monotonic()
    with pytest.raises(speech.SpeechCancelled):
        speech.transcribe(
            {"lang": "whisper-small", "dir": "whisper/small"}, str(audio), 5.0, "en",
            lambda: time.monotonic() - started > 1.0,
        )  # fmt: skip
    assert time.monotonic() - started < 10
    speech.release_sessions()
