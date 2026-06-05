import json
import os
import subprocess
import numpy as np


def get_video_duration(video_path: str) -> float | None:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_entries", "format=duration", video_path],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception:
        return None


def _probe_video_dims(video_path: str) -> tuple[int, int] | None:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-select_streams", "v:0",
             "-show_entries", "stream=width,height",
             video_path],
            capture_output=True, text=True, timeout=30,
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


def extract_frames_evenly(
    video_path: str,
    n_frames: int = 32,
    max_resolution: int = 320,
) -> list[tuple[np.ndarray, float]]:
    """
    Extract n_frames evenly-spaced frames via individual fast seeks.
    Each seek decodes only from the nearest keyframe — much faster than
    full-video decode for any reasonable frame count.
    Returns (rgb_array, timestamp_secs) pairs. No files written to disk.
    """
    dims = _probe_video_dims(video_path)
    duration = get_video_duration(video_path)
    if not dims or not duration or duration <= 0:
        raise RuntimeError("Could not probe video dimensions or duration")

    out_w, out_h = _calc_scaled_size(dims[0], dims[1], max_resolution)
    frame_size = out_w * out_h * 3
    fname = os.path.basename(video_path)
    print(
        f"[keyframes] {fname}: source {dims[0]}x{dims[1]} → extract {out_w}x{out_h} "
        f"({duration:.0f}s, {n_frames} frames)",
        flush=True,
    )

    timestamps = [duration * (i + 1) / (n_frames + 1) for i in range(n_frames)]
    frames: list[tuple[np.ndarray, float]] = []

    for ts in timestamps:
        result = subprocess.run(
            [
                "ffmpeg", *_hwaccel_args(),
                "-ss", str(ts), "-i", video_path,
                "-frames:v", "1",
                "-vf", f"scale={out_w}:{out_h}",
                "-f", "rawvideo", "-pix_fmt", "rgb24",
                "pipe:1",
                "-hide_banner", "-loglevel", "error",
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0 and len(result.stdout) >= frame_size:
            arr = np.frombuffer(result.stdout[:frame_size], dtype=np.uint8).reshape((out_h, out_w, 3)).copy()
            frames.append((arr, ts))

    print(f"[keyframes] {fname}: extracted {len(frames)}/{n_frames} frames", flush=True)
    return frames
