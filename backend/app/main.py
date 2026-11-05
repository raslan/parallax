import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import UTC

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from app.api.audio_compress import router as audio_compress_router
from app.api.audio_files import router as audio_files_router
from app.api.audio_libraries import router as audio_libraries_router
from app.api.audio_originals import router as audio_originals_router
from app.api.audio_toolbox import router as audio_toolbox_router
from app.api.compress import router as compress_router
from app.api.credits import router as credits_router
from app.api.downloads import router as downloads_router
from app.api.files import router as files_router
from app.api.galleries import router as galleries_router
from app.api.health import router as health_router
from app.api.identify import router as identify_router
from app.api.image_libraries import router as image_libraries_router
from app.api.image_upscale import router as image_upscale_router
from app.api.images import router as images_router
from app.api.jobs import router as jobs_router
from app.api.libraries import router as libraries_router
from app.api.models import router as models_router
from app.api.organize import router as organize_router
from app.api.organize import sandbox_error_handler
from app.api.originals import router as originals_router
from app.api.settings import get_theme, safe_theme_id
from app.api.settings import router as settings_router
from app.api.splice import router as splice_router
from app.api.stats import router as stats_router
from app.api.stream import router as stream_router
from app.api.subtitles import router as subtitles_router
from app.api.toolbox import router as toolbox_router
from app.config import GALLERY_DL_DIR
from app.database import SessionLocal, init_db
from app.queue import start_worker
from app.services.encoder import detect_encoder
from app.services.organize_sandbox import SandboxError

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "../static")


def stamp_theme(html: str, theme: str) -> str:
    """Stamp `data-theme` on index.html's <html> tag. The id is re-validated here (not only on
    the settings write), so a bad value can never inject markup into the page."""
    return html.replace("<html ", f'<html data-theme="{safe_theme_id(theme)}" ', 1)


def _cleanup_legacy_dirs():
    """Remove directories that are no longer used after the seek-based keyframe refactor."""
    import shutil

    from app.config import DATA_DIR

    keyframes_dir = os.path.join(DATA_DIR, "video-keyframes")
    if os.path.isdir(keyframes_dir):
        shutil.rmtree(keyframes_dir, ignore_errors=True)


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
        # `<id>.jpg` thumbnails and `<id>.jpg.failed` generation-failure markers.
        stem, ext = os.path.splitext(name[: -len(".failed")] if name.endswith(".failed") else name)
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


def _reap_orphaned_galleries():
    """Mark gallery downloads still running/pending at startup as failed — killed mid-run."""
    from datetime import datetime

    from app.database import SessionLocal
    from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus

    db = SessionLocal()
    try:
        orphans = (
            db.query(GalleryDownload)
            .filter(
                GalleryDownload.status.in_(
                    [GalleryDownloadStatus.RUNNING, GalleryDownloadStatus.PENDING]
                )
            )
            .all()
        )
        for g in orphans:
            g.status = GalleryDownloadStatus.FAILED
            g.error = "Interrupted by container restart"
            g.finished_at = datetime.now(UTC).replace(tzinfo=None)
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
        reaped = [(j.id, j.type, j.status) for j in orphans]
        for job in orphans:
            job.status = JobStatus.CANCELLED
            job.error = "Interrupted by container restart"
            job.finished_at = datetime.now(UTC).replace(tzinfo=None)
        if orphans:
            db.commit()
            summary = ", ".join(f"#{jid} {jtype} ({jstatus})" for jid, jtype, jstatus in reaped)
            print(f"[startup] Reaped {len(orphans)} orphaned job(s): {summary}", flush=True)
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


def _seed_max_concurrent_jobs():
    """One-time: `max_concurrent_jobs` (app-wide job dispatcher concurrency)
    used to be the same setting as `max_concurrent_transcodes`, which is now
    redefined as per-GPU capacity for Compress/Toolbox file scheduling and no
    longer drives the job queue. Seed the new key from the old stored value
    so upgrading doesn't silently serialize the job queue down to the
    default of 1. No-op once `max_concurrent_jobs` has its own stored value."""
    from app.database import SessionLocal
    from app.models.settings import Setting, get_setting, set_setting

    db = SessionLocal()
    try:
        if db.get(Setting, "max_concurrent_jobs") is not None:
            return
        old = get_setting(db, "max_concurrent_transcodes", "1")
        set_setting(db, "max_concurrent_jobs", old)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    os.makedirs(GALLERY_DL_DIR, exist_ok=True)
    _cleanup_legacy_dirs()
    _migrate_siglip_to_clip()
    _migrate_video_columns()
    _seed_max_concurrent_jobs()
    _sweep_orphaned_thumbnails()
    _reap_orphaned_jobs()
    _reap_orphaned_downloads()
    _reap_orphaned_galleries()
    detect_encoder()
    # Load saved concurrency setting before starting the worker
    from app.database import SessionLocal
    from app.models.settings import get_setting
    from app.queue import init_queue

    _db = SessionLocal()
    try:
        n = int(get_setting(_db, "max_concurrent_jobs", "1"))
    finally:
        _db.close()
    init_queue(n)
    await start_worker()
    # Start filesystem watcher for auto-rescan on file changes
    from app.services import fs_watcher

    fs_watcher.init()
    fs_watcher.watch_all_libraries()

    # Clear a leftover stream remux on boot and idle-sweep it on a timer —
    # otherwise a multi-GB `current.mp4` lingers until the next AC3/DTS playback.
    from app.services import stream_cache

    stream_cache.start_sweeper()

    # Organize's thumbnail cache is per-session: wipe it on boot (background thread). While
    # the app runs it is still trimmed by age + size, lazily, from thumbnail requests.
    from app.services import organize_files

    threading.Thread(target=organize_files.clear_thumbnail_cache, daemon=True).start()

    # Best-effort fetch of the alass binary for subtitle sync — never block
    # startup on it (offline environments should still boot fine).
    from app.services.subtitle_sync import ensure_alass

    try:
        await asyncio.to_thread(ensure_alass)
    except Exception as exc:
        print(f"[startup] Could not fetch alass binary: {exc}", flush=True)

    # Auto-update gallery-dl (and the yt-dlp module its `ytdl:` backend imports) to the
    # nightlies in the background — fire-and-forget so a slow/offline network never delays
    # boot. Same install path as the page's manual Update button. Also fetch deno, the JS
    # runtime yt-dlp needs for YouTube, if it isn't in the data volume yet.
    from app.services.gallery_dl import ensure_deno, install_gallerydl

    async def _auto_update_gallerydl():
        try:
            await asyncio.to_thread(install_gallerydl)
            print("[startup] gallery-dl + yt-dlp nightly updated", flush=True)
        except Exception as exc:
            print(f"[startup] Could not update gallery-dl: {exc}", flush=True)
        try:
            await asyncio.to_thread(ensure_deno)
        except Exception as exc:
            print(f"[startup] Could not fetch deno: {exc}", flush=True)

    asyncio.create_task(_auto_update_gallerydl())

    yield
    fs_watcher.shutdown()
    stream_cache.stop_sweeper()


_API_DESCRIPTION = (
    "The HTTP API behind the Parallax web app. Everything the app does in the browser goes "
    "through these routes, all under `/api`."
)

# One line per tag; shown in the public API reference and in /docs.
_OPENAPI_TAGS = [
    {"name": "health", "description": "Liveness check."},
    {
        "name": "libraries",
        "description": "Video libraries: add, scan, remove, plus duplicate and cleanup helpers.",
    },
    {"name": "files", "description": "Browse, stream and thumbnail video files."},
    {"name": "compress", "description": "Re-encode videos to a smaller size or resolution."},
    {
        "name": "toolbox",
        "description": "Per-file video fixes: trim, audio channel, rotate, normalize, sync.",
    },
    {"name": "splice", "description": "Join several videos into one new file."},
    {
        "name": "originals",
        "description": "Backups kept in `_originals` folders for video: list, restore, delete.",
    },
    {
        "name": "audio-libraries",
        "description": "Audio libraries: add, scan, remove, and find duplicates.",
    },
    {"name": "audio-files", "description": "Browse, stream and delete audio files."},
    {
        "name": "audio-compress",
        "description": "Re-encode audio to Opus, AAC or MP3 at a target bitrate.",
    },
    {
        "name": "audio-toolbox",
        "description": "Audio fixes: trim, channel fix and loudness normalization.",
    },
    {
        "name": "audio-originals",
        "description": "Backups kept in `_originals` folders for audio: list, restore, delete.",
    },
    {"name": "image-libraries", "description": "Image libraries: add, scan and remove."},
    {
        "name": "images",
        "description": "Browse images, content detections, duplicates and the quarantine.",
    },
    {"name": "image-upscale", "description": "Make larger or sharper copies of images."},
    {
        "name": "jobs",
        "description": "Background jobs: list, inspect logs, cancel, and a live event stream.",
    },
    {
        "name": "identify",
        "description": "Rename videos to Plex, Jellyfin and Kodi naming, with TMDB matching.",
    },
    {
        "name": "subtitles",
        "description": "Scan for missing subtitles, download, sync and delete them.",
    },
    {
        "name": "organize",
        "description": "Browse any folder and move, rename or delete what is in it.",
    },
    {"name": "downloads", "description": "Save videos and audio from links."},
    {"name": "galleries", "description": "Fetch galleries and albums of images and clips."},
    {"name": "models", "description": "Content detection models: list, download, remove."},
    {
        "name": "stream",
        "description": "Prepare and serve playback for videos with sound browsers cannot play.",
    },
    {"name": "stats", "description": "Lifetime usage statistics shown on the Home page."},
    {"name": "credits", "description": "Credits and licences for everything Parallax uses."},
    {"name": "settings", "description": "App settings, and the purge of all library data."},
]

app = FastAPI(
    title="Parallax API",
    description=_API_DESCRIPTION,
    openapi_tags=_OPENAPI_TAGS,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Typed service errors mapped to status + {"detail": ...} once (CODE_CONVENTIONS B3).
app.add_exception_handler(SandboxError, sandbox_error_handler)

app.include_router(health_router, prefix="/api")
app.include_router(libraries_router, prefix="/api")
app.include_router(audio_libraries_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(audio_files_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(originals_router, prefix="/api")
app.include_router(organize_router, prefix="/api")
app.include_router(audio_originals_router, prefix="/api")
app.include_router(identify_router, prefix="/api")
app.include_router(image_libraries_router, prefix="/api")
app.include_router(images_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(subtitles_router, prefix="/api")
app.include_router(compress_router, prefix="/api", tags=["compress"])
app.include_router(audio_compress_router, prefix="/api", tags=["audio-compress"])
app.include_router(image_upscale_router, prefix="/api")
app.include_router(audio_toolbox_router, prefix="/api")
app.include_router(downloads_router, prefix="/api")
app.include_router(stats_router, prefix="/api")
app.include_router(credits_router, prefix="/api")
app.include_router(galleries_router, prefix="/api")
app.include_router(splice_router, prefix="/api", tags=["splice"])
app.include_router(toolbox_router, prefix="/api", tags=["toolbox"])
app.include_router(stream_router, prefix="/api")

# Serve the built React frontend — must come after all API routes
if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    def _index_html() -> HTMLResponse:
        """index.html with the saved theme stamped on <html>, so the first paint is already
        themed (no flash of the default theme, even in a fresh browser or incognito)."""
        with open(os.path.join(STATIC_DIR, "index.html"), encoding="utf-8") as fh:
            html = fh.read()
        db = SessionLocal()
        try:
            theme = get_theme(db)
        finally:
            db.close()
        return HTMLResponse(stamp_theme(html, theme), headers={"Cache-Control": "no-cache"})

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        candidate = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return await run_in_threadpool(_index_html)
else:

    @app.get("/{full_path:path}")
    async def frontend_not_built(full_path: str):
        return JSONResponse(
            {"message": "Frontend not built. Run: cd frontend && npm run build"},
            status_code=200,
        )
