import os
import shutil
from app.database import DATA_DIR

MODELS_DIR = os.path.join(DATA_DIR, "models")

CLIP_MODELS: dict[str, dict] = {
    "clip-vit-base-patch32": {
        "id": "clip-vit-base-patch32",
        "type": "clip",
        "name": "CLIP ViT-B/32",
        "description": "Balanced speed and accuracy. Default.",
        "hf_repo": "Xenova/clip-vit-base-patch32",
        "hf_vision_file": "onnx/vision_model.onnx",
        "hf_text_file": "onnx/text_model.onnx",
        "size_mb": 350,
        "quality": "good",
        "image_size": 224,
    },
    "clip-vit-large-patch14": {
        "id": "clip-vit-large-patch14",
        "type": "clip",
        "name": "CLIP ViT-L/14",
        "description": "High accuracy. ~1.6 GB download.",
        "hf_repo": "Xenova/clip-vit-large-patch14",
        "hf_vision_file": "onnx/vision_model.onnx",
        "hf_text_file": "onnx/text_model.onnx",
        "size_mb": 1600,
        "quality": "better",
        "image_size": 224,
    },
    "clip-vit-large-patch14-336": {
        "id": "clip-vit-large-patch14-336",
        "type": "clip",
        "name": "CLIP ViT-L/14@336px",
        "description": "Best accuracy. Same as L/14 but trained at 336px — sharper detail. ~1.6 GB download.",
        "hf_repo": "Xenova/clip-vit-large-patch14-336",
        "hf_vision_file": "onnx/vision_model.onnx",
        "hf_text_file": "onnx/text_model.onnx",
        "size_mb": 1600,
        "quality": "best",
        "image_size": 336,
    },
}

NUDENET_MODELS: dict[str, dict] = {
    "320n": {
        "id": "320n",
        "type": "nudenet",
        "name": "NudeNet 320n",
        "description": "Fast, standard accuracy. Pre-installed.",
        "bundled": True,
        "size_mb": 5,
        "quality": "good",
        "inference_resolution": 320,
    },
    "640m": {
        "id": "640m",
        "type": "nudenet",
        "name": "NudeNet 640m",
        "description": "Better at small/partial detections. ~99 MB download.",
        "bundled": False,
        "url": "https://api.github.com/repos/notAI-tech/NudeNet/releases/assets/176832019",
        "size_mb": 99,
        "quality": "better",
        "inference_resolution": 640,
    },
}


WHISPER_MODELS: dict[str, dict] = {
    "tiny": {
        "id": "tiny", "type": "whisper", "name": "Whisper Tiny",
        "description": "Fastest, lowest accuracy. ~75 MB.",
        "hf_repo": "Systran/faster-whisper-tiny", "size_mb": 75, "quality": "fast",
    },
    "base": {
        "id": "base", "type": "whisper", "name": "Whisper Base",
        "description": "Good speed/accuracy balance. ~145 MB.",
        "hf_repo": "Systran/faster-whisper-base", "size_mb": 145, "quality": "good",
    },
    "small": {
        "id": "small", "type": "whisper", "name": "Whisper Small",
        "description": "Recommended. Strong accuracy, fast enough. ~460 MB.",
        "hf_repo": "Systran/faster-whisper-small", "size_mb": 460, "quality": "better",
    },
    "medium": {
        "id": "medium", "type": "whisper", "name": "Whisper Medium",
        "description": "High accuracy. ~1.4 GB.",
        "hf_repo": "Systran/faster-whisper-medium", "size_mb": 1400, "quality": "better",
    },
    "large-v3": {
        "id": "large-v3", "type": "whisper", "name": "Whisper Large v3",
        "description": "Best accuracy. ~3 GB.",
        "hf_repo": "Systran/faster-whisper-large-v3", "size_mb": 3000, "quality": "best",
    },
}


def whisper_model_dir(model_id: str) -> str:
    return os.path.join(MODELS_DIR, "whisper", model_id)


def is_whisper_downloaded(model_id: str) -> bool:
    d = whisper_model_dir(model_id)
    return os.path.isdir(d) and os.path.exists(os.path.join(d, "model.bin"))


def clip_dir(model_id: str) -> str:
    return os.path.join(MODELS_DIR, "clip", model_id)


def clip_vision_path(model_id: str) -> str:
    return os.path.join(clip_dir(model_id), "vision.onnx")


def clip_text_path(model_id: str) -> str:
    return os.path.join(clip_dir(model_id), "text.onnx")


def nudenet_path(model_id: str) -> str:
    if model_id == "320n":
        import nudenet as _pkg
        return os.path.join(os.path.dirname(_pkg.__file__), "320n.onnx")
    return os.path.join(MODELS_DIR, "nudenet", f"{model_id}.onnx")


def is_clip_downloaded(model_id: str) -> bool:
    return (
        os.path.exists(clip_vision_path(model_id))
        and os.path.exists(clip_text_path(model_id))
    )


def is_nudenet_downloaded(model_id: str) -> bool:
    meta = NUDENET_MODELS.get(model_id)
    if not meta:
        return False
    if meta.get("bundled"):
        return True
    return os.path.exists(nudenet_path(model_id))


# ---------------------------------------------------------------------------
# Streaming download helpers
# ---------------------------------------------------------------------------

class _DownloadCancelled(BaseException):
    pass


def _download_hf_file(
    repo_id: str,
    filename: str,
    dest_path: str,
    job,
    db,
    job_id: int,
    total_bytes: int,
    pct_start: float,
    pct_end: float,
    label: str,
    byte_offset: int = 0,
) -> int:
    """
    Stream one file from HuggingFace to dest_path with live progress.
    Returns number of bytes downloaded.
    byte_offset: bytes already counted toward progress (for multi-file jobs).
    """
    import requests
    from huggingface_hub import hf_hub_url
    from app.services.common import should_cancel

    url = hf_hub_url(repo_id=repo_id, filename=filename)
    _total = max(total_bytes, 1)
    n = byte_offset
    last_db_pct = pct_start
    last_log_pct = pct_start - 5.0
    downloaded = 0

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if should_cancel(job_id):
                    raise _DownloadCancelled()
                f.write(chunk)
                n += len(chunk)
                downloaded += len(chunk)
                pct = min(pct_start + (n / _total) * (pct_end - pct_start), pct_end)
                if pct - last_db_pct >= 1.0:
                    job.progress = pct
                    db.commit()
                    last_db_pct = pct
                if pct - last_log_pct >= 5.0:
                    print(
                        f"[model-download] {label}: "
                        f"{n // (1024 * 1024)} / {_total // (1024 * 1024)} MB ({pct:.0f}%)",
                        flush=True,
                    )
                    last_log_pct = pct
    return downloaded


# ---------------------------------------------------------------------------
# Whisper
# ---------------------------------------------------------------------------

def download_whisper(model_id: str, job_id: int) -> None:
    from huggingface_hub import list_repo_files
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import now, log, arm_cancel, clear_cancel

    meta = WHISPER_MODELS[model_id]
    target_dir = whisper_model_dir(model_id)
    os.makedirs(target_dir, exist_ok=True)

    db = SessionLocal()
    job = None
    _cleanup = False
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()
        arm_cancel(job_id)

        total_bytes = meta["size_mb"] * 1024 * 1024
        print(f"[model-download] {meta['name']}: starting download ({meta['size_mb']} MB)", flush=True)
        log(db, job_id, f"Downloading {meta['name']} from HuggingFace…")
        job.progress = 5.0
        db.commit()

        files = list(list_repo_files(meta["hf_repo"]))
        byte_offset = 0
        for filename in files:
            dest = os.path.join(target_dir, filename)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.exists(dest):
                byte_offset += os.path.getsize(dest)
                continue
            byte_offset += _download_hf_file(
                repo_id=meta["hf_repo"],
                filename=filename,
                dest_path=dest,
                job=job, db=db, job_id=job_id,
                total_bytes=total_bytes,
                pct_start=5.0, pct_end=95.0,
                label=meta["name"],
                byte_offset=byte_offset,
            )

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        db.commit()
        print(f"[model-download] {meta['name']}: download complete", flush=True)
        log(db, job_id, f"{meta['name']} downloaded successfully.")

    except _DownloadCancelled:
        _cleanup = True
        if job:
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            db.commit()
        print(f"[model-download] {meta['name']}: cancelled — removing partial files", flush=True)

    except Exception as e:
        _cleanup = True
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)[:512]
            job.finished_at = now()
            db.commit()
        print(f"[model-download] {meta['name']}: failed — {e}", flush=True)

    finally:
        clear_cancel(job_id)
        if _cleanup:
            shutil.rmtree(target_dir, ignore_errors=True)
        db.close()


def delete_whisper(model_id: str) -> None:
    d = whisper_model_dir(model_id)
    if os.path.isdir(d):
        shutil.rmtree(d)


# ---------------------------------------------------------------------------
# CLIP
# ---------------------------------------------------------------------------

def migrate_legacy_clip() -> None:
    """Move pre-subdirectory CLIP files into per-model directory on first startup."""
    legacy_dir = os.path.join(MODELS_DIR, "clip")
    legacy_vision = os.path.join(legacy_dir, "vision.onnx")
    legacy_text = os.path.join(legacy_dir, "text.onnx")
    target = "clip-vit-base-patch32"
    if os.path.exists(legacy_vision) and not os.path.exists(clip_vision_path(target)):
        os.makedirs(clip_dir(target), exist_ok=True)
        shutil.move(legacy_vision, clip_vision_path(target))
    if os.path.exists(legacy_text) and not os.path.exists(clip_text_path(target)):
        os.makedirs(clip_dir(target), exist_ok=True)
        shutil.move(legacy_text, clip_text_path(target))


def download_clip(model_id: str, job_id: int) -> None:
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import now, log, arm_cancel, clear_cancel

    meta = CLIP_MODELS[model_id]
    target_dir = clip_dir(model_id)
    os.makedirs(target_dir, exist_ok=True)

    total_bytes = meta["size_mb"] * 1024 * 1024
    vision_bytes = int(total_bytes * 0.6)  # vision ~60%, text ~40%

    db = SessionLocal()
    job = None
    _cleanup = False
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()
        arm_cancel(job_id)

        print(f"[model-download] {meta['name']}: starting download ({meta['size_mb']} MB)", flush=True)

        log(db, job_id, f"Downloading {meta['name']} vision model from HuggingFace…")
        job.current_file = "vision_model.onnx"
        job.progress = 5.0
        db.commit()
        _download_hf_file(
            repo_id=meta["hf_repo"],
            filename=meta["hf_vision_file"],
            dest_path=clip_vision_path(model_id),
            job=job, db=db, job_id=job_id,
            total_bytes=total_bytes,
            pct_start=5.0, pct_end=60.0,
            label=f"{meta['name']} vision",
        )

        log(db, job_id, f"Downloading {meta['name']} text model from HuggingFace…")
        job.current_file = "text_model.onnx"
        job.progress = 60.0
        db.commit()
        _download_hf_file(
            repo_id=meta["hf_repo"],
            filename=meta["hf_text_file"],
            dest_path=clip_text_path(model_id),
            job=job, db=db, job_id=job_id,
            total_bytes=total_bytes,
            pct_start=60.0, pct_end=95.0,
            label=f"{meta['name']} text",
            byte_offset=vision_bytes,
        )

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        job.current_file = None
        db.commit()
        print(f"[model-download] {meta['name']}: download complete", flush=True)
        log(db, job_id, f"{meta['name']} downloaded successfully.")

    except _DownloadCancelled:
        _cleanup = True
        if job:
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            job.current_file = None
            db.commit()
        print(f"[model-download] {meta['name']}: cancelled — removing partial files", flush=True)

    except Exception as e:
        _cleanup = True
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)[:512]
            job.finished_at = now()
            job.current_file = None
            db.commit()
        print(f"[model-download] {meta['name']}: failed — {e}", flush=True)

    finally:
        clear_cancel(job_id)
        if _cleanup:
            shutil.rmtree(target_dir, ignore_errors=True)
        db.close()


def delete_clip(model_id: str) -> None:
    d = clip_dir(model_id)
    if os.path.isdir(d):
        shutil.rmtree(d)


# ---------------------------------------------------------------------------
# NudeNet
# ---------------------------------------------------------------------------

def download_nudenet(model_id: str, job_id: int) -> None:
    import requests
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import now, log, arm_cancel, clear_cancel, should_cancel

    meta = NUDENET_MODELS[model_id]
    target = nudenet_path(model_id)
    os.makedirs(os.path.dirname(target), exist_ok=True)

    db = SessionLocal()
    job = None
    _cleanup = False
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()
        arm_cancel(job_id)

        print(f"[model-download] {meta['name']}: starting download ({meta['size_mb']} MB)", flush=True)
        log(db, job_id, f"Downloading {meta['name']} from GitHub…")
        job.current_file = f"{model_id}.onnx"
        job.progress = 5.0
        db.commit()

        headers = {
            "Accept": "application/octet-stream",
            "User-Agent": "python-requests/2.28",
        }
        r = requests.get(meta["url"], stream=True, timeout=120, headers=headers)
        r.raise_for_status()
        content_type = r.headers.get("Content-Type", "")
        if "text/html" in content_type:
            raise ValueError(
                f"Download URL returned HTML instead of binary data. "
                f"URL may be invalid or require authentication: {meta['url']}"
            )

        expected_bytes = meta["size_mb"] * 1024 * 1024
        content_length = int(r.headers.get("Content-Length", 0)) or expected_bytes
        downloaded = 0
        last_db_pct = 5.0
        last_log_pct = 0.0
        with open(target, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                if should_cancel(job_id):
                    raise _DownloadCancelled()
                f.write(chunk)
                downloaded += len(chunk)
                pct = 5.0 + (downloaded / content_length) * 90.0
                pct = min(pct, 95.0)
                if pct - last_db_pct >= 1.0:
                    job.progress = pct
                    db.commit()
                    last_db_pct = pct
                if pct - last_log_pct >= 5.0:
                    mb = downloaded // (1024 * 1024)
                    total_mb = content_length // (1024 * 1024)
                    print(f"[model-download] {meta['name']}: {mb} MB / {total_mb} MB ({pct:.0f}%)", flush=True)
                    last_log_pct = pct

        if downloaded < expected_bytes * 0.5:
            raise ValueError(
                f"Downloaded file too small: {downloaded} bytes "
                f"(expected ~{expected_bytes} bytes). File may be corrupt."
            )

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        job.current_file = None
        db.commit()
        print(f"[model-download] {meta['name']}: download complete ({downloaded // (1024 * 1024)} MB)", flush=True)
        log(db, job_id, f"{meta['name']} downloaded successfully ({downloaded // 1024 // 1024} MB).")

    except _DownloadCancelled:
        _cleanup = True
        if job:
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            job.current_file = None
            db.commit()
        print(f"[model-download] {meta['name']}: cancelled — removing partial files", flush=True)

    except Exception as e:
        _cleanup = True
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)[:512]
            job.finished_at = now()
            job.current_file = None
            db.commit()
        print(f"[model-download] {meta['name']}: failed — {e}", flush=True)

    finally:
        clear_cancel(job_id)
        if _cleanup and os.path.exists(target):
            os.remove(target)
        db.close()


def delete_nudenet(model_id: str) -> None:
    meta = NUDENET_MODELS.get(model_id, {})
    if meta.get("bundled"):
        return
    path = nudenet_path(model_id)
    if os.path.exists(path):
        os.remove(path)
