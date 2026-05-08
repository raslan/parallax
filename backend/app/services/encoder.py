import subprocess

_encoder: str | None = None

PRESETS: dict[str, int] = {
    "high": 18,
    "medium": 23,
    "low": 28,
}


def detect_encoder() -> str:
    global _encoder
    if _encoder is not None:
        return _encoder
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10,
        )
        if "h264_nvenc" in result.stdout:
            _encoder = "h264_nvenc"
            return _encoder
    except Exception:
        pass
    _encoder = "libx264"
    return _encoder
