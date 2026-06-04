"""
Filesystem watcher — auto-triggers incremental rescans when specific files
change inside a library directory. Only the changed/deleted files are processed.

Uses watchdog for cross-platform inotify/FSEvents/kqueue support.
Debounces 30 s so rapid file ops (e.g. a big copy) wait until files settle,
then passes the exact changed/deleted paths to targeted scan functions.
"""
import logging
import os
import threading
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_DEBOUNCE = 30.0

_VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts",
               ".mpg", ".mpeg", ".mts", ".vob", ".3gp", ".ogv", ".divx"}
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".heic", ".heif"}

_observer = None
_handles: dict[int, object] = {}  # library_id -> watchdog watch handle
_lock = threading.Lock()


@dataclass
class _Pending:
    timer: threading.Timer | None = None
    changed: set[str] = field(default_factory=set)
    deleted: set[str] = field(default_factory=set)


_pending: dict[int, _Pending] = {}  # library_id -> pending state


def init() -> None:
    global _observer
    try:
        from watchdog.observers import Observer
        _observer = Observer()
        _observer.daemon = True
        _observer.start()
        logger.info("Filesystem watcher started")
    except Exception as exc:
        logger.warning("Filesystem watcher unavailable: %s", exc)


def shutdown() -> None:
    global _observer
    with _lock:
        for p in _pending.values():
            if p.timer:
                p.timer.cancel()
        _pending.clear()
    if _observer:
        try:
            _observer.stop()
        except Exception:
            pass
        _observer = None


def _fire(library_id: int, is_image: bool) -> None:
    """Called from threading.Timer — already in its own thread, just run directly."""
    with _lock:
        p = _pending.pop(library_id, None)
    if not p:
        return
    changed = frozenset(p.changed)
    deleted = frozenset(p.deleted)
    if not changed and not deleted:
        return
    if is_image:
        _apply_image_changes(library_id, changed, deleted)
    else:
        _apply_video_changes(library_id, changed, deleted)


def _apply_video_changes(library_id: int, changed: frozenset[str], deleted: frozenset[str]) -> None:
    from app.database import SessionLocal
    from app.models.file import File, FileStatus
    from app.models.library import Library
    from app.services.scanner import probe_file, generate_thumbnail, thumbnail_path, _now

    db = SessionLocal()
    try:
        library = db.get(Library, library_id)
        if not library:
            return

        # Deletions
        for path in deleted:
            f = db.query(File).filter(File.path == path).first()
            if f:
                try:
                    os.remove(thumbnail_path(f.id))
                except FileNotFoundError:
                    pass
                db.delete(f)
        db.commit()

        # New / modified
        for path in changed:
            if not os.path.exists(path):
                continue
            f = db.query(File).filter(File.path == path).first()
            is_new = f is None
            if is_new:
                f = File(
                    library_id=library_id,
                    path=path,
                    filename=os.path.basename(path),
                    extension=os.path.splitext(path)[1].lower().lstrip("."),
                    status=FileStatus.UNKNOWN,
                )
                db.add(f)
                db.commit()
                db.refresh(f)

            try:
                f.size = os.stat(path).st_size
            except OSError:
                pass

            import json as _json
            from datetime import datetime
            data = probe_file(path)
            if data:
                fmt = data.get("format", {})
                streams = data.get("streams", [])
                if fmt.get("duration"):
                    f.duration = float(fmt["duration"])
                if fmt.get("size"):
                    f.size = int(fmt["size"])
                if streams:
                    s = streams[0]
                    if s.get("codec_name"):
                        f.codec_name = s["codec_name"]
                    br = s.get("bit_rate") or fmt.get("bit_rate")
                    if br:
                        try:
                            f.video_bitrate = int(br)
                        except (ValueError, TypeError):
                            pass
                    f.file_width = s.get("width")
                    f.file_height = s.get("height")
                    raw_fps = s.get("r_frame_rate", "")
                    if "/" in raw_fps:
                        num, den = raw_fps.split("/")
                        f.file_fps = round(int(num) / int(den), 3) if int(den) else None

            creation_time_str = data.get("format", {}).get("tags", {}).get("creation_time") if data else None
            if creation_time_str:
                try:
                    dt = datetime.fromisoformat(creation_time_str.replace("Z", "+00:00"))
                    f.file_date = dt.timestamp()
                except (ValueError, TypeError):
                    f.file_date = os.path.getmtime(path)
            else:
                f.file_date = os.path.getmtime(path)

            f.scanned_at = _now()
            db.commit()
            generate_thumbnail(path, f.id)

        library.last_scanned_at = _now()
        db.commit()
        logger.info("Watcher: video library %d — %d changed, %d deleted",
                    library_id, len(changed), len(deleted))
    except Exception:
        logger.exception("Watcher: error in video incremental scan for library %d", library_id)
    finally:
        db.close()


def _apply_image_changes(library_id: int, changed: frozenset[str], deleted: frozenset[str]) -> None:
    from app.database import SessionLocal
    from app.models.image import ImageFile, ImageDetection
    from app.models.image_library import ImageLibrary
    from app.services.image_scanner import (
        generate_thumbnail as img_thumb,
        _thumbnail_path,
        THUMBNAIL_DIR,
    )
    from app.services.common import now

    db = SessionLocal()
    try:
        library = db.get(ImageLibrary, library_id)
        if not library:
            return

        # Deletions
        for path in deleted:
            f = db.query(ImageFile).filter(ImageFile.path == path).first()
            if f:
                db.query(ImageDetection).filter(ImageDetection.image_id == f.id).delete()
                try:
                    os.remove(_thumbnail_path(f.id))
                except FileNotFoundError:
                    pass
                db.delete(f)
        db.commit()

        # New / modified — basic metadata + thumbnail, no AI
        from app.services.image_analyzer import get_image_metadata
        from app.models.image import ImageStatus
        import os as _os

        for path in changed:
            if not _os.path.exists(path):
                continue
            f = db.query(ImageFile).filter(ImageFile.path == path).first()
            if f:
                # Update existing record
                meta = get_image_metadata(path)
                f.size = meta["size"]
                f.width = meta["width"]
                f.height = meta["height"]
                f.exif_date = meta["exif_date"]
                f.exif_gps = meta["exif_gps"]
                f.exif_camera = meta["exif_camera"]
                f.scanned_at = now()
                db.commit()
                img_thumb(path, _thumbnail_path(f.id))
            else:
                # New file — insert record
                meta = get_image_metadata(path)
                ext = _os.path.splitext(path)[1].lower().lstrip(".")
                f = ImageFile(
                    library_id=library_id,
                    path=path,
                    filename=_os.path.basename(path),
                    extension=ext,
                    size=meta["size"],
                    width=meta["width"],
                    height=meta["height"],
                    exif_date=meta["exif_date"],
                    exif_gps=meta["exif_gps"],
                    exif_camera=meta["exif_camera"],
                    status=ImageStatus.SCANNED,
                    scanned_at=now(),
                )
                db.add(f)
                db.commit()
                db.refresh(f)
                img_thumb(path, _thumbnail_path(f.id))

        logger.info("Watcher: image library %d — %d changed, %d deleted",
                    library_id, len(changed), len(deleted))
    except Exception:
        logger.exception("Watcher: error in image incremental scan for library %d", library_id)
    finally:
        db.close()


class _Handler:
    def __init__(self, library_id: int, is_image: bool) -> None:
        self.library_id = library_id
        self.is_image = is_image
        self.valid_exts = _IMAGE_EXTS if is_image else _VIDEO_EXTS

    def _is_relevant(self, path: str) -> bool:
        norm = path.replace("\\", "/")
        if "/_originals/" in norm or norm.endswith("/_originals"):
            return False
        name = os.path.basename(norm)
        if name.startswith(".") or ".compressing" in name or ".transcoding" in name:
            return False
        return os.path.splitext(name)[1].lower() in self.valid_exts

    def _record(self, path: str, deleted: bool) -> None:
        if not self._is_relevant(path):
            return
        lid = self.library_id
        is_image = self.is_image
        with _lock:
            p = _pending.setdefault(lid, _Pending())
            if deleted:
                p.deleted.add(path)
                p.changed.discard(path)
            else:
                p.changed.add(path)
                p.deleted.discard(path)
            if p.timer:
                p.timer.cancel()
            t = threading.Timer(_DEBOUNCE, _fire, args=(lid, is_image))
            t.daemon = True
            t.start()
            p.timer = t

    def dispatch(self, event) -> None:
        if event.is_directory:
            return
        event_type = type(event).__name__
        if "Delete" in event_type:
            self._record(event.src_path, deleted=True)
        elif "Move" in event_type:
            self._record(event.src_path, deleted=True)
            if hasattr(event, "dest_path"):
                self._record(event.dest_path, deleted=False)
        else:
            self._record(event.src_path, deleted=False)


def watch_library(library_id: int, path: str, is_image: bool) -> None:
    if _observer is None:
        return
    with _lock:
        if library_id in _handles:
            return
        handler = _Handler(library_id, is_image)
        handle = _observer.schedule(handler, path, recursive=True)
        _handles[library_id] = handle
    logger.info("Watching %s library %d → %s", "image" if is_image else "video", library_id, path)


def unwatch_library(library_id: int) -> None:
    with _lock:
        handle = _handles.pop(library_id, None)
        p = _pending.pop(library_id, None)
        if p and p.timer:
            p.timer.cancel()
    if handle and _observer:
        try:
            _observer.unschedule(handle)
        except Exception:
            pass
    logger.info("Unwatched library %d", library_id)


def watch_all_libraries() -> None:
    from app.database import SessionLocal
    from app.models.library import Library
    from app.models.image_library import ImageLibrary

    db = SessionLocal()
    try:
        for lib in db.query(Library).all():
            if os.path.isdir(lib.path):
                watch_library(lib.id, lib.path, is_image=False)
        for lib in db.query(ImageLibrary).all():
            if os.path.isdir(lib.path):
                watch_library(lib.id, lib.path, is_image=True)
    finally:
        db.close()
