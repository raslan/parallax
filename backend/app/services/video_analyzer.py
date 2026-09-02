import json
import subprocess


def get_video_duration(video_path: str) -> float | None:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_entries",
                "format=duration",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception:
        return None


def _probe_video_dims(video_path: str) -> tuple[int, int] | None:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        s = json.loads(result.stdout)["streams"][0]
        return int(s["width"]), int(s["height"])
    except Exception:
        return None


def _calc_scaled_size(w: int, h: int, max_size: int) -> tuple[int, int]:
    """Scale so longest dimension ≤ max_size, maintain AR, round to even."""
    if w <= max_size and h <= max_size:
        ow, oh = w, h
    elif w >= h:
        ow = max_size
        oh = round(h * max_size / w)
    else:
        oh = max_size
        ow = round(w * max_size / h)
    return max(2, ow - (ow % 2)), max(2, oh - (oh % 2))


def _hwaccel_args() -> list[str]:
    """Return ffmpeg hwaccel input flags for the detected GPU, or [] for CPU."""
    try:
        from app.services.encoder import get_encoder_family

        family = get_encoder_family()
    except Exception:
        return []
    if family == "nvenc":
        return ["-hwaccel", "cuda"]
    if family == "qsv":
        return ["-hwaccel", "qsv"]
    if family in ("amf", "vaapi"):
        return ["-hwaccel", "vaapi", "-vaapi_device", "/dev/dri/renderD128"]
    return []
