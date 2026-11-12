"""Runs inside the speech-to-text worker process: loads a CTranslate2 Whisper model and
transcribes. Kept apart from `speech.py` (the main-process proxy) so importing the app never
imports faster-whisper. The model stays cached for the life of the worker; dropping the worker
is what frees its memory (and any GPU context).

The main process cannot reach into this one, so cancel and progress go through two small files:
the worker writes how far it got (seconds of audio done) after every segment and stops, returning
what it has, as soon as the cancel file exists.
"""

import os

_models: dict[tuple, object] = {}


def _load(model_dir: str, device: str, device_index: int):
    key = (model_dir, device, device_index)
    if key not in _models:
        from faster_whisper import WhisperModel

        _models[key] = WhisperModel(
            model_dir,
            device=device,
            device_index=device_index,
            compute_type="int8" if device == "cpu" else "float16",
            cpu_threads=os.cpu_count() or 4,
            local_files_only=True,
        )
    return _models[key]


def transcribe(
    model_dir: str,
    audio_path: str,
    language: str | None,
    progress_path: str,
    cancel_path: str,
    device: str = "cpu",
    device_index: int = 0,
) -> dict:
    """Transcribe 16 kHz mono float32 audio saved raw at `audio_path`.

    Returns {"segments": [(start, end, text), ...], "language": str, "cancelled": bool}."""
    import numpy as np

    model = _load(model_dir, device, device_index)
    audio = np.fromfile(audio_path, dtype=np.float32)
    segments, info = model.transcribe(
        audio,
        language=language,
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,  # one bad segment must not poison the rest
    )
    out: list[tuple[float, float, str]] = []
    for seg in segments:  # a lazy generator: stopping the loop stops the decoding
        text = seg.text.strip()
        if text:
            out.append((float(seg.start), float(seg.end), text))
        with open(progress_path, "w") as f:
            f.write(str(float(seg.end)))
        if os.path.exists(cancel_path):
            return {"segments": out, "language": info.language, "cancelled": True}
    return {"segments": out, "language": info.language, "cancelled": False}
