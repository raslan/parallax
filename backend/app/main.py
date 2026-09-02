import os
from contextlib import asynccontextmanager
from datetime import UTC

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.compress import router as compress_router
from app.api.downloads import router as downloads_router
from app.api.files import router as files_router
from app.api.health import router as health_router
from app.api.identify import router as identify_router
from app.api.image_libraries import router as image_libraries_router
from app.api.images import router as images_router
from app.api.jobs import router as jobs_router
from app.api.libraries import router as libraries_router
from app.api.models import router as models_router
from app.api.originals import router as originals_router
from app.api.settings import router as settings_router
from app.api.stream import router as stream_router
from app.api.subtitles import router as subtitles_router
from app.api.toolbox import router as toolbox_router
from app.database import init_db
from app.queue import start_worker
from app.services.encoder import detect_encoder

STATIC_DIR = os.path.join(os.path.dirname(__file__), "../static")


def _cleanup_legacy_dirs():
    """Remove directories that are no longer used after the seek-based keyframe refactor."""
    import shutil

    from app.config import DATA_DIR

    keyframes_dir = os.path.join(DATA_DIR, "video-keyframes")
    if os.path.isdir(keyframes_dir):
        shutil.rmtree(keyframes_dir, ignore_errors=True)


def _cleanup_clip_models():
    """One-time: CLIP was removed from the app — delete any downloaded CLIP
    model files left on disk. Single-user app, no prompt needed. Safe to
    delete this function in a future release once confirmed run."""
    import shutil

    from app.services.model_manager import MODELS_DIR

    clip_dir = os.path.join(MODELS_DIR, "clip")
    if os.path.isdir(clip_dir):
        shutil.rmtree(clip_dir, ignore_errors=True)
        print("[startup] Removed leftover CLIP model files", flush=True)


def _sweep_orphaned_thumbnails():
    """Delete thumbnail files whose file_id no longer has a matching `File` row.

    File IDs get reused (SQLite rowid reuse after a delete), and a handful of
    code paths used to delete `File` rows without removing the matching
    thumbnail — those stale files would then get served under a later,
    unrelated file that reused the same id. Runs every startup (cheap: a
    directory listing plus a set diff) as defense-in-depth against any path
    that still misses cleanup, not just to migrate pre-fix leftovers.
    """
    from app.config import THUMBNAILS_DIR
    from app.database import SessionLocal
    from app.models.file import File

    if not os.path.isdir(THUMBNAILS_DIR):
        return

    db = SessionLocal()
    try:
        live_ids = {str(fid) for (fid,) in db.query(File.id).all()}
    finally:
        db.close()

    removed = 0
    for name in os.listdir(THUMBNAILS_DIR):
        stem, ext = os.path.splitext(name)
        if ext != ".jpg" or stem in live_ids:
            continue
        try:
            os.remove(os.path.join(THUMBNAILS_DIR, name))
            removed += 1
        except FileNotFoundError:
            pass
    if removed:
        print(f"[startup] Removed {removed} orphaned thumbnail file(s)", flush=True)


def _reap_orphaned_downloads():
    """Mark any downloads still running/pending at startup as failed — killed mid-run."""
    from datetime import datetime

    from app.database import SessionLocal
    from app.models.download import Download, DownloadStatus

    db = SessionLocal()
    try:
        orphans = (
            db.query(Download)
            .filter(Download.status.in_([DownloadStatus.RUNNING, DownloadStatus.PENDING]))
            .all()
        )
        for d in orphans:
            d.status = DownloadStatus.FAILED
            d.error = "Interrupted by container restart"
            d.finished_at = datetime.now(UTC).replace(tzinfo=None)
        if orphans:
            db.commit()
    finally:
        db.close()


def _reap_orphaned_jobs():
    """Mark orphaned jobs at startup as cancelled (killed mid-run)."""
    from datetime import datetime

    from app.database import SessionLocal
    from app.models.job import Job, JobStatus

    db = SessionLocal()
    try:
        orphans = db.query(Job).filter(Job.status.in_([JobStatus.RUNNING, JobStatus.PENDING])).all()
        for job in orphans:
            job.status = JobStatus.CANCELLED
            job.error = "Interrupted by container restart"
            job.finished_at = datetime.now(UTC).replace(tzinfo=None)
        if orphans:
            db.commit()
    finally:
        db.close()


def _migrate_video_columns():
    """Add clip_embedding to files table if missing."""
    import sqlalchemy as sa

    from app.database import engine

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(files)"))]
        if "clip_embedding" not in cols:
            conn.execute(sa.text("ALTER TABLE files ADD COLUMN clip_embedding TEXT"))
            conn.commit()


def _migrate_siglip_to_clip():
    """One-time column rename: siglip_embedding → clip_embedding (SQLite 3.35+)."""
    from app.database import engine

    with engine.connect() as conn:
        cols = [
            row[1]
            for row in conn.execute(__import__("sqlalchemy").text("PRAGMA table_info(images)"))
        ]
        if "siglip_embedding" in cols and "clip_embedding" not in cols:
            conn.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE images RENAME COLUMN siglip_embedding TO clip_embedding"
                )
            )
            conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _cleanup_legacy_dirs()
    _migrate_siglip_to_clip()
    _migrate_video_columns()
    _cleanup_clip_models()
    _sweep_orphaned_thumbnails()
    _reap_orphaned_jobs()
    _reap_orphaned_downloads()
    detect_encoder()
    # Load saved concurrency setting before starting the worker
    from app.database import SessionLocal
    from app.models.settings import get_setting
    from app.queue import init_queue

    _db = SessionLocal()
    try:
        n = int(get_setting(_db, "max_concurrent_transcodes", "1"))
    finally:
        _db.close()
    init_queue(n)
    await start_worker()
    # Start filesystem watcher for auto-rescan on file changes
    from app.services import fs_watcher

    fs_watcher.init()
    fs_watcher.watch_all_libraries()
    yield
    fs_watcher.shutdown()


app = FastAPI(title="Transcoder", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(libraries_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(originals_router, prefix="/api")
app.include_router(identify_router, prefix="/api")
app.include_router(image_libraries_router, prefix="/api")
app.include_router(images_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(subtitles_router, prefix="/api")
app.include_router(compress_router, prefix="/api")
app.include_router(downloads_router, prefix="/api")
app.include_router(toolbox_router, prefix="/api")
app.include_router(stream_router, prefix="/api")

# Serve the built React frontend — must come after all API routes
if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        candidate = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
else:

    @app.get("/{full_path:path}")
    async def frontend_not_built(full_path: str):
        return JSONResponse(
            {"message": "Frontend not built. Run: cd frontend && npm run build"},
            status_code=200,
        )
