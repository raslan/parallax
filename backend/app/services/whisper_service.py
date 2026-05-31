import os
import threading
from typing import Optional

_model = None
_model_id_loaded: str | None = None
_lock = threading.Lock()
_idle_timer: threading.Timer | None = None
_idle_timer_lock = threading.Lock()
_IDLE_TIMEOUT = 300  # 5 minutes — whisper models are large


def _reset_idle_timer() -> None:
    global _idle_timer
    with _idle_timer_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
        _idle_timer = threading.Timer(_IDLE_TIMEOUT, release_model)
        _idle_timer.daemon = True
        _idle_timer.start()


def release_model() -> None:
    global _model, _model_id_loaded, _idle_timer
    with _idle_timer_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
            _idle_timer = None
    with _lock:
        _model = None
        _model_id_loaded = None


def _get_model(model_id: str):
    global _model, _model_id_loaded
    from faster_whisper import WhisperModel
    from app.services.model_manager import whisper_model_dir

    with _lock:
        if _model is None or _model_id_loaded != model_id:
            _model = WhisperModel(
                whisper_model_dir(model_id),
                device="auto",
                compute_type="auto",
            )
            _model_id_loaded = model_id
        return _model


def _fmt_srt_time(secs: float) -> str:
    h = int(secs // 3600)
    m = int((secs % 3600) // 60)
    s = int(secs % 60)
    ms = min(int(round((secs % 1) * 1000)), 999)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _segments_to_srt(segments) -> str:
    lines = []
    counter = 1
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        lines.append(f"{counter}\n{_fmt_srt_time(seg.start)} --> {_fmt_srt_time(seg.end)}\n{text}")
        counter += 1
    return "\n\n".join(lines)


def transcribe(video_path: str, model_id: str, language: Optional[str] = None) -> str:
    """Transcribe video audio and save SRT alongside it. Returns the SRT file path."""
    model = _get_model(model_id)

    kwargs: dict = {"beam_size": 5, "vad_filter": True}
    if language:
        kwargs["language"] = language

    segments, info = model.transcribe(video_path, **kwargs)
    srt_content = _segments_to_srt(list(segments))

    detected_lang = getattr(info, "language", None) or "und"
    base = os.path.splitext(video_path)[0]
    out_path = f"{base}.{detected_lang}.srt"

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(srt_content)

    _reset_idle_timer()
    return out_path
