import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from app.database import init_db
from app.models import video as _video_models  # noqa: F401 — ensures VideoDetection table is created
from app.queue import start_worker
from app.services.encoder import detect_encoder
from app.api.health import router as health_router
from app.api.libraries import router as libraries_router
from app.api.files import router as files_router
from app.api.jobs import router as jobs_router
from app.api.settings import router as settings_router
from app.api.originals import router as originals_router
from app.api.identify import router as identify_router
from app.api.image_libraries import router as image_libraries_router
from app.api.images import router as images_router
from app.api.models import router as models_router

STATIC_DIR = os.path.join(os.path.dirname(__file__), "../static")


def _reap_orphaned_jobs():
    """Mark any jobs still 'running' or 'pending' at startup as cancelled — they were killed mid-run."""
    from datetime import datetime, timezone
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    db = SessionLocal()
    try:
        orphans = db.query(Job).filter(Job.status.in_([JobStatus.RUNNING, JobStatus.PENDING])).all()
        for job in orphans:
            job.status = JobStatus.CANCELLED
            job.error = "Interrupted by container restart"
            job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if orphans:
            db.commit()
    finally:
        db.close()


def _migrate_video_columns():
    """Add clip_embedding and video_scanned_at to files table if missing."""
    from app.database import engine
    import sqlalchemy as sa
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(files)"))]
        if "clip_embedding" not in cols:
            conn.execute(sa.text("ALTER TABLE files ADD COLUMN clip_embedding TEXT"))
            conn.commit()
        if "video_scanned_at" not in cols:
            conn.execute(sa.text("ALTER TABLE files ADD COLUMN video_scanned_at DATETIME"))
            conn.commit()


def _migrate_siglip_to_clip():
    """One-time column rename: siglip_embedding → clip_embedding (SQLite 3.35+)."""
    from app.database import engine
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(
            __import__("sqlalchemy").text("PRAGMA table_info(images)")
        )]
        if "siglip_embedding" in cols and "clip_embedding" not in cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE images RENAME COLUMN siglip_embedding TO clip_embedding"
            ))
            conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _migrate_siglip_to_clip()
    _migrate_video_columns()
    from app.services.model_manager import migrate_legacy_clip
    migrate_legacy_clip()
    _reap_orphaned_jobs()
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
    yield


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
