"""
Proxy layer for Whisper transcription. Runs inference in an isolated worker
subprocess (spawn) so the CTranslate2/CUDA context is fully destroyed on idle,
freeing all VRAM — same pattern as image_analyzer.py for ONNX models.
"""
import threading
import multiprocessing
from concurrent.futures import ProcessPoolExecutor, BrokenExecutor
from typing import Optional

_spawn_ctx = multiprocessing.get_context("spawn")
_executor: ProcessPoolExecutor | None = None
_executor_lock = threading.Lock()

_IDLE_TIMEOUT = 120  # seconds — matches ONNX idle window
_idle_timer: threading.Timer | None = None
_idle_timer_lock = threading.Lock()


def _get_executor() -> ProcessPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ProcessPoolExecutor(max_workers=1, mp_context=_spawn_ctx)
    return _executor


def _reset_idle_timer() -> None:
    global _idle_timer
    with _idle_timer_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
        _idle_timer = threading.Timer(_IDLE_TIMEOUT, release_model)
        _idle_timer.daemon = True
        _idle_timer.start()


def release_model() -> None:
    """Terminate the Whisper worker process, fully freeing GPU memory."""
    global _executor, _idle_timer
    with _idle_timer_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
            _idle_timer = None
    with _executor_lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


def transcribe(video_path: str, model_id: str, language: Optional[str] = None) -> str:
    """Transcribe video audio in a worker subprocess. Returns the SRT file path."""
    from app.services._whisper_impl import transcribe as _fn
    try:
        result = _get_executor().submit(_fn, video_path, model_id, language).result()
    except BrokenExecutor:
        with _executor_lock:
            global _executor
            _executor = None
        result = _get_executor().submit(_fn, video_path, model_id, language).result()
    _reset_idle_timer()
    return result
