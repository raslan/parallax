import subprocess

_encoders: dict[str, str] | None = None

PRESETS: dict[str, int] = {
    "high": 18,
    "medium": 23,
    "low": 28,
}

# Codecs that are at least as efficient as H.264 — transcode these to HEVC
# to avoid size blowup. H.264 and older always target H.264.
_EFFICIENT_CODECS = {"hevc", "av1", "vp9"}


def _probe_encoders() -> dict[str, str]:
    """Return {'h264': encoder_name, 'hevc': encoder_name}."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10,
        )
        stdout = result.stdout
        h264 = "h264_nvenc" if "h264_nvenc" in stdout else "libx264"
        hevc = "hevc_nvenc" if "hevc_nvenc" in stdout else "libx265"
        return {"h264": h264, "hevc": hevc}
    except Exception:
        return {"h264": "libx264", "hevc": "libx265"}


def _get_encoders() -> dict[str, str]:
    global _encoders
    if _encoders is None:
        _encoders = _probe_encoders()
    return _encoders


def detect_encoder() -> str:
    """Return the best available H.264 encoder."""
    return _get_encoders()["h264"]


def encoder_for_codec(source_codec: str | None) -> str:
    """Pick output encoder based on source codec efficiency tier."""
    encoders = _get_encoders()
    if source_codec and source_codec.lower() in _EFFICIENT_CODECS:
        return encoders["hevc"]
    return encoders["h264"]
