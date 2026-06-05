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

# Priority order for each codec family. First match wins.
_H264_PRIORITY  = ["h264_nvenc",  "h264_qsv",  "h264_amf",  "h264_vaapi",  "libx264"]
_HEVC_PRIORITY  = ["hevc_nvenc",  "hevc_qsv",  "hevc_amf",  "hevc_vaapi",  "libx265"]
_AV1_PRIORITY   = ["av1_nvenc",   "av1_qsv",   "av1_amf",   "libsvtav1",   "libaom-av1"]

# Map encoder name → family string
_FAMILY_MAP: dict[str, str] = {
    "h264_nvenc": "nvenc",  "hevc_nvenc": "nvenc",  "av1_nvenc": "nvenc",
    "h264_qsv":   "qsv",   "hevc_qsv":   "qsv",   "av1_qsv":   "qsv",
    "h264_amf":   "amf",   "hevc_amf":   "amf",   "av1_amf":   "amf",
    "h264_vaapi": "vaapi", "hevc_vaapi": "vaapi",
}

# NVIDIA consumer cards cap at 3 simultaneous NVENC sessions on older drivers.
# QSV/AMF/VAAPI have no known hard session limit.
_CONCURRENT_HINT: dict[str, int | None] = {
    "nvenc": 3,
    "qsv":   None,
    "amf":   None,
    "vaapi": None,
    "software": None,
}


def _probe_encoders() -> dict[str, str]:
    """Return {'h264': name, 'hevc': name, 'av1': name} using the best available encoder."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10,
        )
        stdout = result.stdout
        h264 = next((e for e in _H264_PRIORITY if e in stdout), "libx264")
        hevc = next((e for e in _HEVC_PRIORITY if e in stdout), "libx265")
        av1  = next((e for e in _AV1_PRIORITY  if e in stdout), "libsvtav1")
        return {"h264": h264, "hevc": hevc, "av1": av1}
    except Exception:
        return {"h264": "libx264", "hevc": "libx265", "av1": "libsvtav1"}


def _get_encoders() -> dict[str, str]:
    global _encoders
    if _encoders is None:
        _encoders = _probe_encoders()
    return _encoders


def get_encoder_family() -> str:
    """Return the GPU/encoder family in use: nvenc | qsv | amf | vaapi | software."""
    enc = _get_encoders()
    for name in enc.values():
        family = _FAMILY_MAP.get(name)
        if family:
            return family
    return "software"


def get_concurrent_limit_hint() -> int | None:
    """
    Return a suggested max for simultaneous encode sessions, or None if unknown.
    NVIDIA consumer GPUs are typically limited to 3 on older drivers.
    """
    return _CONCURRENT_HINT.get(get_encoder_family())


def detect_encoder() -> str:
    """Return the best available H.264 encoder."""
    return _get_encoders()["h264"]


def encoder_for_codec(source_codec: str | None) -> str:
    """Pick output encoder based on source codec efficiency tier."""
    encoders = _get_encoders()
    if source_codec and source_codec.lower() in _EFFICIENT_CODECS:
        return encoders["hevc"]
    return encoders["h264"]
