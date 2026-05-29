import os
import json
import shutil
import subprocess
import numpy as np

_DEFAULT_KEYFRAMES_PER_VIDEO = 8


def get_video_duration(video_path: str) -> float | None:
    """Return duration in seconds via ffprobe, or None on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_entries", "format=duration",
                video_path,
            ],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception:
        return None


def extract_keyframes(
    video_path: str,
    num_frames: int = _DEFAULT_KEYFRAMES_PER_VIDEO,
    dest_dir: str | None = None,
) -> tuple[str, list[tuple[str, float]]]:
    """
    Extract exactly `num_frames` evenly-spaced frames from the video.
    Writes to `dest_dir` (persistent) or a tempdir if not provided.
    Returns (frame_dir, [(frame_path, timestamp_secs), ...]).
    """
    import tempfile

    duration = get_video_duration(video_path)
    if not duration or duration <= 0:
        raise RuntimeError("Could not determine video duration")

    n = max(1, num_frames)
    # Space timestamps evenly, avoiding the very start/end (use n+1 intervals)
    timestamps = [duration * (i + 1) / (n + 1) for i in range(n)]

    frame_dir = dest_dir or tempfile.mkdtemp(prefix="parallax_vframes_")
    os.makedirs(frame_dir, exist_ok=True)

    results = []
    for i, ts in enumerate(timestamps):
        out_path = os.path.join(frame_dir, f"{i:06d}.jpg")
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-ss", str(ts),
                    "-i", video_path,
                    "-frames:v", "1",
                    "-q:v", "5",
                    out_path,
                    "-hide_banner", "-loglevel", "error",
                    "-y",
                ],
                timeout=30,
                check=True,
            )
            results.append((out_path, ts))
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            pass  # skip unextractable frames; caller raises if results is empty

    return frame_dir, results


def embed_video_clip(
    frame_paths: list[str],
    model_id: str = "clip-vit-base-patch32",
) -> list[float]:
    """Average CLIP embeddings of all frames → video-level embedding."""
    from app.services.image_analyzer import encode_image_clip

    vectors = []
    for path in frame_paths:
        try:
            vec = encode_image_clip(path, model_id=model_id)
            vectors.append(vec)
        except Exception:
            continue

    if not vectors:
        raise ValueError("No frames could be embedded")

    avg = np.mean(np.array(vectors, dtype=np.float64), axis=0)
    norm = np.linalg.norm(avg)
    if norm > 0:
        avg = avg / norm
    return avg.tolist()


def detect_video_nudenet(
    frames: list[tuple[str, float]],
    model_id: str = "320n",
    min_confidence: float = 0.5,
) -> list[dict]:
    """
    Run NudeNet on each frame.
    Returns list of {timestamp_secs, label, confidence} dicts.
    """
    from app.services.image_analyzer import run_nudenet

    results = []
    for frame_path, timestamp in frames:
        try:
            detections = run_nudenet(frame_path, model_id=model_id)
            for d in detections:
                if d["confidence"] >= min_confidence:
                    results.append({
                        "timestamp_secs": timestamp,
                        "label": d["label"],
                        "confidence": d["confidence"],
                    })
        except Exception:
            continue
    return results
