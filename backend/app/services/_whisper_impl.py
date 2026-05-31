"""
Whisper transcription implementation — runs inside an isolated worker subprocess.
Loaded by whisper_service.py via ProcessPoolExecutor(spawn) so the CTranslate2/CUDA
context is fully destroyed when the subprocess exits, freeing all VRAM.
"""
import os
from typing import Optional

_model = None
_model_id_loaded: str | None = None


def _get_model(model_id: str):
    global _model, _model_id_loaded
    from faster_whisper import WhisperModel
    from app.services.model_manager import whisper_model_dir

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

    return out_path
