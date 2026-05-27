import os
import json
import shutil
import subprocess
import tempfile
import numpy as np

_FRAME_INTERVAL_SECS = 30  # 1 keyframe per 30 seconds


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
    interval_secs: int = _FRAME_INTERVAL_SECS,
) -> tuple[str, list[tuple[str, float]]]:
    """
    Extract one frame every `interval_secs` seconds into a temp directory.
    Returns (tmpdir, [(frame_path, timestamp_secs), ...]).
    Caller must delete tmpdir when done.
    """
    tmpdir = tempfile.mkdtemp(prefix="parallax_vframes_")
    pattern = os.path.join(tmpdir, "%06d.jpg")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-i", video_path,
                "-vf", f"fps=1/{interval_secs}",
                "-q:v", "5",
                pattern,
                "-hide_banner", "-loglevel", "error",
            ],
            timeout=300,
            check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise RuntimeError(f"ffmpeg frame extraction failed: {e}") from e

    frames = sorted(
        f for f in os.listdir(tmpdir) if f.endswith(".jpg")
    )
    results = []
    for i, fname in enumerate(frames):
        timestamp = i * interval_secs
        results.append((os.path.join(tmpdir, fname), float(timestamp)))

    return tmpdir, results


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
