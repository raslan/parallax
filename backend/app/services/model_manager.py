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
    """Download CLIP model from HuggingFace. Runs in background job thread."""
    from huggingface_hub import hf_hub_download
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import now, log

    meta = CLIP_MODELS[model_id]
    target_dir = clip_dir(model_id)
    os.makedirs(target_dir, exist_ok=True)

    db = SessionLocal()
    job = None
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

        log(db, job_id, f"Downloading {meta['name']} vision model from HuggingFace…")
        job.current_file = "vision_model.onnx"
        job.progress = 10.0
        db.commit()
        src = hf_hub_download(
            repo_id=meta["hf_repo"],
            filename=meta["hf_vision_file"],
            local_dir=target_dir,
        )
        dest = clip_vision_path(model_id)
        if os.path.abspath(src) != os.path.abspath(dest):
            shutil.move(src, dest)

        log(db, job_id, f"Downloading {meta['name']} text model from HuggingFace…")
        job.current_file = "text_model.onnx"
        job.progress = 60.0
        db.commit()
        src = hf_hub_download(
            repo_id=meta["hf_repo"],
            filename=meta["hf_text_file"],
            local_dir=target_dir,
        )
        dest = clip_text_path(model_id)
        if os.path.abspath(src) != os.path.abspath(dest):
            shutil.move(src, dest)

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        job.current_file = None
        db.commit()
        log(db, job_id, f"{meta['name']} downloaded successfully.")

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)[:512]
            job.finished_at = now()
            db.commit()
    finally:
        db.close()


def download_nudenet(model_id: str, job_id: int) -> None:
    """Download NudeNet model from GitHub. Runs in background job thread."""
    import requests
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import now, log

    meta = NUDENET_MODELS[model_id]
    target = nudenet_path(model_id)
    os.makedirs(os.path.dirname(target), exist_ok=True)

    db = SessionLocal()
    job = None
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

        log(db, job_id, f"Downloading {meta['name']} from GitHub…")
        job.current_file = f"{model_id}.onnx"
        job.progress = 10.0
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
        last_reported = 0
        with open(target, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)
                downloaded += len(chunk)
                pct = 10.0 + (downloaded / content_length) * 85.0
                if pct - last_reported >= 2.0:
                    job.progress = min(pct, 95.0)
                    db.commit()
                    last_reported = pct

        if downloaded < expected_bytes * 0.5:
            os.remove(target)
            raise ValueError(
                f"Downloaded file too small: {downloaded} bytes "
                f"(expected ~{expected_bytes} bytes). File may be corrupt."
            )

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        job.current_file = None
        db.commit()
        log(db, job_id, f"{meta['name']} downloaded successfully ({downloaded // 1024 // 1024} MB).")

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)[:512]
            job.finished_at = now()
            db.commit()
    finally:
        db.close()


def delete_clip(model_id: str) -> None:
    d = clip_dir(model_id)
    if os.path.isdir(d):
        shutil.rmtree(d)


def delete_nudenet(model_id: str) -> None:
    meta = NUDENET_MODELS.get(model_id, {})
    if meta.get("bundled"):
        return
    path = nudenet_path(model_id)
    if os.path.exists(path):
        os.remove(path)
