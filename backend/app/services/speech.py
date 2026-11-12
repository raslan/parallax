"""Main-process side of speech-to-text (faster-whisper on CTranslate2, CPU by default).

`extract_audio` decodes a video's first audio stream with ffmpeg to 16 kHz mono float32 (faster-
whisper's own decoding needs PyAV, which a newer PyAV breaks; handing it an array avoids that),
and `transcribe` runs the model in a spawned worker (`worker_common.WorkerPool`, freed after two
idle minutes or when a job ends). Cancel: ffmpeg is killed at once; the worker is told through a
file and stops after its current segment, and is terminated if it has not stopped within a few
seconds.
"""

import os
import subprocess
import time
from collections.abc import Callable

from app.services import _whisper_impl
from app.services import translate_packs as packs
from app.services.worker_common import WorkerCancelled, WorkerPool

SAMPLE_RATE = 16000
_pool = WorkerPool(idle_timeout=120.0)


class SpeechCancelled(Exception):
    pass


class SpeechError(Exception):
    """An expected, user-facing failure (message is shown on the job)."""


def release_sessions() -> None:
    _pool.release()


def extract_audio(video_path: str, out_path: str, is_cancelled: Callable[[], bool]) -> None:
    """Write the first audio stream of `video_path` as raw 16 kHz mono float32 to `out_path`."""
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error", "-i", video_path,
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-y", out_path,
    ]  # fmt: skip
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    try:
        while proc.poll() is None:
            if is_cancelled():
                proc.kill()
                proc.wait()
                raise SpeechCancelled()
            time.sleep(0.25)
        err = proc.stderr.read() if proc.stderr else ""
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    if proc.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise SpeechError(
            "The video has no audio to transcribe."
            if not err or "matches no streams" in err
            else "ffmpeg could not read the audio."
        )


def transcribe(
    model: dict,
    audio_path: str,
    duration: float,
    language: str | None,
    is_cancelled: Callable[[], bool],
    on_progress: Callable[[float], None] | None = None,
    device: str = "cpu",
    device_index: int = 0,
) -> tuple[list[tuple[float, float, str]], str]:
    """Transcribe the raw audio file; returns (segments, detected language). Raises
    `SpeechCancelled` when cancelled."""
    base = audio_path + ".state"
    progress_path, cancel_path = base + ".progress", base + ".cancel"
    for p in (progress_path, cancel_path):
        if os.path.exists(p):
            os.remove(p)

    def watch() -> bool:
        if on_progress:
            try:
                with open(progress_path) as f:
                    on_progress(min(100.0, float(f.read() or 0) / max(duration, 1.0) * 100))
            except (OSError, ValueError):
                pass
        cancelled = is_cancelled()
        if cancelled and not os.path.exists(cancel_path):
            open(cancel_path, "w").close()
        return cancelled

    try:
        result = _pool.submit_cancellable(
            _whisper_impl.transcribe,
            packs.pack_dir(model),
            audio_path,
            language,
            progress_path,
            cancel_path,
            device,
            device_index,
            is_cancelled=watch,
        )
    except WorkerCancelled:
        raise SpeechCancelled() from None
    finally:
        for p in (progress_path, cancel_path):
            if os.path.exists(p):
                os.remove(p)
    if result["cancelled"]:
        raise SpeechCancelled()
    return result["segments"], result["language"]
