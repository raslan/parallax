import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from app.database import init_db
from app.queue import start_worker
from app.api.health import router as health_router
from app.api.libraries import router as libraries_router
from app.api.files import router as files_router
from app.api.jobs import router as jobs_router

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _reap_orphaned_jobs()
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
