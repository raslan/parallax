"""
Filesystem watcher — auto-triggers incremental rescans when specific files
change inside a library directory. Only the changed/deleted files are processed.

Uses watchdog for cross-platform inotify/FSEvents/kqueue support.
Debounces a few seconds so rapid file ops (e.g. a big copy) settle before
processing, then passes the changed/deleted paths to targeted scan functions.
Every fire also stat-prunes the whole library: watchdog does not emit per-file
delete events for `rm -rf subdir/`, a trash move, or delete-and-recreate, so
trusting delete events alone leaves stale rows forever.
"""

import logging
import os
import threading
from dataclasses import dataclass, field
from typing import Literal

from app.services.audio_scanner import AUDIO_EXTENSIONS

logger = logging.getLogger(__name__)

_DEBOUNCE = 3.0

_VIDEO_EXTS = {
    ".mkv",
    ".mp4",
    ".avi",
    ".mov",
    ".m4v",
    ".wmv",
    ".flv",
    ".ts",
    ".m2ts",
    ".mpg",
    ".mpeg",
    ".mts",
    ".vob",
    ".3gp",
    ".ogv",
    ".divx",
}
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".heic", ".heif"}

# Keyed by (kind, library_id) — video, image and audio library IDs all start at
# 1 and would otherwise collide, silently leaving libraries unwatched. The kind
# string is the discriminator.
Kind = Literal["video", "image", "audio"]
_Key = tuple[Kind, int]

_observer = None
_handles: dict[_Key, object] = {}  # (kind, library_id) -> watchdog watch handle
_lock = threading.Lock()


@dataclass
class _Pending:
    timer: threading.Timer | None = None
    changed: set[str] = field(default_factory=set)
    deleted: set[str] = field(default_factory=set)


_pending: dict[_Key, _Pending] = {}  # (kind, library_id) -> pending state

# Belt-and-braces sweep so drift can't accumulate when fs events are missed
# entirely (inotify queue overflow, a filesystem that doesn't report to
# inotify at all — some network mounts, virtiofs). Same reconcile as a fire.
_RECONCILE_INTERVAL = 90.0
_reconcile_stop = threading.Event()
# Serializes _apply_*_changes so a periodic reconcile and a live fire (or two
# reconciles) never work the same library from two threads at once.
# ponytail: one global lock — libraries are few and this isn't hot. Per-library
# locks only if that stops being true.
_apply_lock = threading.Lock()


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
    _reconcile_stop.set()
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


def _fire(key: _Key) -> None:
    """Called from threading.Timer — already in its own thread, just run directly."""
    kind, library_id = key
    with _lock:
        p = _pending.pop(key, None)
    if not p:
        return
    changed = frozenset(p.changed)
    # A pure-delete batch has no `changed` paths but must still run so the
    # existence sweep in _apply_*_changes prunes the now-missing rows.
    if not changed and not p.deleted:
        return
    with _apply_lock:
        if kind == "image":
            _apply_image_changes(library_id, changed)
        elif kind == "audio":
            _apply_audio_changes(library_id, changed)
        elif kind == "video":
            _apply_video_changes(library_id, changed)
        else:
            logger.warning("fs_watcher: unknown watch kind %r for library %s", kind, library_id)


def _apply_video_changes(library_id: int, changed: frozenset[str]) -> None:
    from app.database import SessionLocal
    from app.models.file import File, FileStatus
    from app.models.library import Library
    from app.services.scanner import (
        _find_video_files,
        _now,
        _probe_metadata,
        clear_thumbnail_failed_marker,
        thumbnail_path,
    )

    db = SessionLocal()
    try:
        library = db.get(Library, library_id)
        if not library:
            return

        # Deletions — stat every row in the library, not just the paths that
        # arrived as delete events. watchdog emits no per-file delete event for
        # `rm -rf subdir/`, a trash move, or delete-and-recreate, so the event
        # set is unreliable; a full existence sweep is the only thing that
        # actually keeps the DB in step with the disk.
        pruned = 0
        for f in db.query(File).filter(File.library_id == library_id).all():
            if os.path.exists(f.path):
                continue
            try:
                os.remove(thumbnail_path(f.id))
            except FileNotFoundError:
                pass
            clear_thumbnail_failed_marker(f.id)
            db.delete(f)
            pruned += 1
        db.commit()

        # Additions the event stream never delivered: files that existed before
        # the watcher started (added while the app was down, or a library that
        # was never scanned), or events lost to an inotify queue overflow
        # during a big copy. Mirror the delete sweep — reconcile the whole
        # library against disk each fire, not just the event paths.
        # ponytail: one os.walk per fire. Fine for normal libraries; if a huge
        # tree makes fires slow, gate this to startup + a periodic interval.
        known = {p for (p,) in db.query(File.path).filter(File.library_id == library_id)}
        changed = changed | (frozenset(_find_video_files(library.path)) - known)

        # New / modified — batch-insert every genuinely-new path in one shot
        # (one query + one commit for the whole set) instead of a round-trip
        # per file; a big folder copy can land hundreds of "changed" paths in
        # a single debounced batch.
        existing_changed = {
            f.path: f
            for f in db.query(File)
            .filter(File.library_id == library_id, File.path.in_(changed))
            .all()
        }
        new_paths = [p for p in changed if p not in existing_changed and os.path.exists(p)]
        new_path_set = set(new_paths)
        if new_paths:
            db.expire(library)
            if db.get(Library, library_id) is None:
                return
            new_objs = [
                File(
                    library_id=library_id,
                    path=path,
                    filename=os.path.basename(path),
                    extension=os.path.splitext(path)[1].lower().lstrip("."),
                    status=FileStatus.UNKNOWN,
                )
                for path in new_paths
            ]
            db.add_all(new_objs)
            db.commit()
            for obj in new_objs:
                existing_changed[obj.path] = obj

        for path in changed:
            if not os.path.exists(path):
                continue
            f = existing_changed.get(path)
            if f is None:
                # Existed neither in the DB nor at the batch-insert check above
                # (e.g. it appeared between the two os.path.exists calls) —
                # skip for now, the next debounce cycle will pick it up.
                continue
            is_new = path in new_path_set

            before = (
                f.size,
                f.duration,
                f.codec_name,
                f.video_bitrate,
                f.file_width,
                f.file_height,
                f.file_fps,
                f.file_date,
                f.file_mtime,
            )

            meta = _probe_metadata(path)
            if meta["size"] is not None:
                f.size = meta["size"]
            if meta["probe_ok"]:
                for key in (
                    "duration",
                    "codec_name",
                    "video_bitrate",
                    "file_width",
                    "file_height",
                    "file_fps",
                ):
                    setattr(f, key, meta[key])
            f.file_mtime = meta["file_mtime"]
            f.file_date = meta["file_date"]

            after = (
                f.size,
                f.duration,
                f.codec_name,
                f.video_bitrate,
                f.file_width,
                f.file_height,
                f.file_fps,
                f.file_date,
                f.file_mtime,
            )

            if is_new or before != after:
                f.scanned_at = _now()
                db.commit()
                if not is_new:
                    # Content genuinely changed under an existing path (e.g. a
                    # file replaced outside Parallax) — the old thumbnail is
                    # now stale. Remove it so the next view lazily regenerates
                    # from the new bytes instead of serving the old ones
                    # forever (get_or_create_thumbnail only fills in misses).
                    try:
                        os.remove(thumbnail_path(f.id))
                    except FileNotFoundError:
                        pass
                clear_thumbnail_failed_marker(f.id)
            else:
                # Re-probed values are identical — a spurious fs event (e.g.
                # another process touching the file's mtime with no real
                # content change). Discard the no-op assignments so the flush
                # doesn't bump File.updated_at and falsely signal "changed"
                # to every page watching this library's SSE stream.
                db.rollback()

        if changed or pruned:
            library.last_scanned_at = _now()
            db.commit()
            logger.info(
                "Watcher: video library %d — %d changed, %d pruned",
                library_id,
                len(changed),
                pruned,
            )
    except Exception:
        logger.exception("Watcher: error in video incremental scan for library %d", library_id)
    finally:
        db.close()


def _apply_image_changes(library_id: int, changed: frozenset[str]) -> None:
    from app.database import SessionLocal
    from app.models.image import ImageDetection, ImageFile
    from app.models.image_library import ImageLibrary
    from app.services.common import now
    from app.services.image_scanner import (
        _thumbnail_path,
        collect_image_paths,
    )
    from app.services.image_scanner import (
        generate_thumbnail as img_thumb,
    )

    db = SessionLocal()
    try:
        library = db.get(ImageLibrary, library_id)
        if not library:
            return

        # Deletions — full existence sweep, not just the delete-event paths.
        # watchdog emits no per-file delete event for `rm -rf subdir/`, a trash
        # move, or delete-and-recreate, so stat every row in the library.
        pruned = 0
        for f in db.query(ImageFile).filter(ImageFile.library_id == library_id).all():
            if os.path.exists(f.path):
                continue
            db.query(ImageDetection).filter(ImageDetection.image_id == f.id).delete()
            try:
                os.remove(_thumbnail_path(f.id))
            except FileNotFoundError:
                pass
            db.delete(f)
            pruned += 1
        db.commit()

        # Additions the event stream never delivered — pre-existing files, an
        # unscanned library, or events dropped on an inotify overflow. Same
        # whole-library reconcile as the delete sweep above.
        # ponytail: one os.walk per fire; gate to startup + interval if a huge
        # library makes fires slow.
        known = {p for (p,) in db.query(ImageFile.path).filter(ImageFile.library_id == library_id)}
        changed = changed | (frozenset(collect_image_paths(library.path)) - known)

        # New / modified — basic metadata + thumbnail, no AI
        import os as _os

        from app.models.image import ImageStatus
        from app.services.image_analyzer import get_image_metadata

        for path in changed:
            if not _os.path.exists(path):
                continue
            f = db.query(ImageFile).filter(ImageFile.path == path).first()
            if f:
                # Update existing record
                before = (f.size, f.width, f.height, f.exif_date, f.exif_gps, f.exif_camera)
                meta = get_image_metadata(path)
                f.size = meta["size"]
                f.width = meta["width"]
                f.height = meta["height"]
                f.exif_date = meta["exif_date"]
                f.exif_gps = meta["exif_gps"]
                f.exif_camera = meta["exif_camera"]
                after = (f.size, f.width, f.height, f.exif_date, f.exif_gps, f.exif_camera)
                if before != after:
                    f.scanned_at = now()
                    db.commit()
                    img_thumb(path, _thumbnail_path(f.id))
                else:
                    # Spurious fs event, nothing actually changed — don't
                    # bump ImageFile.updated_at with a no-op write.
                    db.rollback()
            else:
                # New file — re-check library still exists before inserting
                db.expire(library)
                if db.get(ImageLibrary, library_id) is None:
                    return
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

        if changed or pruned:
            logger.info(
                "Watcher: image library %d — %d changed, %d pruned",
                library_id,
                len(changed),
                pruned,
            )
    except Exception:
        logger.exception("Watcher: error in image incremental scan for library %d", library_id)
    finally:
        db.close()


def _apply_audio_changes(library_id: int, changed: frozenset[str]) -> None:
    """Audio analogue of _apply_video_changes: same whole-library reconcile
    (delete sweep + disk walk for additions), minus thumbnails (audio has none)."""
    from app.database import SessionLocal
    from app.models.audio_file import AudioFile
    from app.models.audio_library import AudioLibrary
    from app.models.file import FileStatus
    from app.services import audio_scanner
    from app.services.common import now

    db = SessionLocal()
    try:
        library = db.get(AudioLibrary, library_id)
        if not library:
            return

        # Deletions — stat every row in the library, not just the paths that
        # arrived as delete events. watchdog emits no per-file delete event for
        # `rm -rf subdir/`, a trash move, or delete-and-recreate, so the event
        # set is unreliable; a full existence sweep is the only thing that
        # actually keeps the DB in step with the disk.
        pruned = 0
        for f in db.query(AudioFile).filter(AudioFile.library_id == library_id).all():
            if os.path.exists(f.path):
                continue
            db.delete(f)
            pruned += 1
        db.commit()

        # Additions the event stream never delivered: files that existed before
        # the watcher started (added while the app was down, or a library that
        # was never scanned), or events lost to an inotify queue overflow
        # during a big copy. Mirror the delete sweep — reconcile the whole
        # library against disk each fire, not just the event paths.
        known = {p for (p,) in db.query(AudioFile.path).filter(AudioFile.library_id == library_id)}
        changed = changed | (frozenset(audio_scanner._find_audio_files(library.path)) - known)

        # New / modified — batch-insert every genuinely-new path in one shot
        # (one query + one commit for the whole set) instead of a round-trip
        # per file; a big folder copy can land hundreds of "changed" paths in
        # a single debounced batch.
        existing_changed = {
            f.path: f
            for f in db.query(AudioFile)
            .filter(AudioFile.library_id == library_id, AudioFile.path.in_(changed))
            .all()
        }
        new_paths = [p for p in changed if p not in existing_changed and os.path.exists(p)]
        new_path_set = set(new_paths)
        if new_paths:
            db.expire(library)
            if db.get(AudioLibrary, library_id) is None:
                return
            new_objs = [
                AudioFile(
                    library_id=library_id,
                    path=path,
                    filename=os.path.basename(path),
                    extension=os.path.splitext(path)[1].lower(),
                    status=FileStatus.UNKNOWN,
                )
                for path in new_paths
            ]
            db.add_all(new_objs)
            db.commit()
            for obj in new_objs:
                existing_changed[obj.path] = obj

        for path in changed:
            if not os.path.exists(path):
                continue
            f = existing_changed.get(path)
            if f is None:
                # Existed neither in the DB nor at the batch-insert check above
                # (e.g. it appeared between the two os.path.exists calls) —
                # skip for now, the next debounce cycle will pick it up.
                continue
            is_new = path in new_path_set

            before = (
                f.size,
                f.duration,
                f.codec_name,
                f.bitrate,
                f.sample_rate,
                f.channels,
                f.channel_layout,
                f.file_date,
                f.file_mtime,
            )

            meta = audio_scanner._probe_audio_metadata(path)
            if meta["size"] is not None:
                f.size = meta["size"]
            if meta["probe_ok"]:
                for key in (
                    "duration",
                    "codec_name",
                    "bitrate",
                    "sample_rate",
                    "channels",
                    "channel_layout",
                ):
                    setattr(f, key, meta[key])
                f.status = FileStatus.DONE
                f.scan_error = None
            else:
                f.status = FileStatus.UNKNOWN
                f.scan_error = "ffprobe failed"
            f.file_mtime = meta["file_mtime"]
            f.file_date = meta["file_date"]

            after = (
                f.size,
                f.duration,
                f.codec_name,
                f.bitrate,
                f.sample_rate,
                f.channels,
                f.channel_layout,
                f.file_date,
                f.file_mtime,
            )

            if is_new or before != after:
                f.scanned_at = now()
                db.commit()
            else:
                # Re-probed values are identical — a spurious fs event (e.g.
                # another process touching the file's mtime with no real
                # content change). Discard the no-op assignments so the flush
                # doesn't bump AudioFile.updated_at and falsely signal "changed"
                # to every page watching this library's SSE stream.
                db.rollback()

        if changed or pruned:
            library.last_scanned_at = now()
            db.commit()
            logger.info(
                "Watcher: audio library %d — %d changed, %d pruned",
                library_id,
                len(changed),
                pruned,
            )
    except Exception:
        logger.exception("Watcher: error in audio incremental scan for library %d", library_id)
    finally:
        db.close()


class _Handler:
    def __init__(self, library_id: int, kind: Kind) -> None:
        self.library_id = library_id
        self.kind = kind
        self.valid_exts = {
            "video": _VIDEO_EXTS,
            "image": _IMAGE_EXTS,
            "audio": AUDIO_EXTENSIONS,
        }[kind]

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
        key: _Key = (self.kind, self.library_id)
        with _lock:
            p = _pending.setdefault(key, _Pending())
            if deleted:
                p.deleted.add(path)
                p.changed.discard(path)
            else:
                p.changed.add(path)
                p.deleted.discard(path)
            if p.timer:
                p.timer.cancel()
            t = threading.Timer(_DEBOUNCE, _fire, args=(key,))
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
        elif "Created" in event_type or "Modified" in event_type:
            self._record(event.src_path, deleted=False)
        # Everything else (FileOpenedEvent / FileClosedEvent / ClosedNoWrite,
        # emitted by watchdog 4.x on Linux for *any* open, reads included) is
        # not a content change. Recording them here caused an infinite loop:
        # _fire ffprobes/opens each file to check it, which re-emits an open
        # event, which schedules another _fire.


def watch_library(library_id: int, path: str, kind: Kind = "video") -> None:
    if _observer is None:
        return
    key: _Key = (kind, library_id)
    with _lock:
        if key in _handles:
            return
        handler = _Handler(library_id, kind)
        handle = _observer.schedule(handler, path, recursive=True)
        _handles[key] = handle
    logger.info("Watching %s library %d → %s", kind, library_id, path)


def unwatch_library(library_id: int, kind: Kind = "video") -> None:
    key: _Key = (kind, library_id)
    with _lock:
        handle = _handles.pop(key, None)
        p = _pending.pop(key, None)
        if p and p.timer:
            p.timer.cancel()
    if handle and _observer:
        try:
            _observer.unschedule(handle)
        except Exception:
            pass
    logger.info("Unwatched %s library %d", kind, library_id)


def watch_all_libraries() -> None:
    from app.database import SessionLocal
    from app.models.audio_library import AudioLibrary
    from app.models.image_library import ImageLibrary
    from app.models.library import Library

    db = SessionLocal()
    try:
        for lib in db.query(Library).all():
            if os.path.isdir(lib.path):
                watch_library(lib.id, lib.path, kind="video")
        for lib in db.query(ImageLibrary).all():
            if os.path.isdir(lib.path):
                watch_library(lib.id, lib.path, kind="image")
        for lib in db.query(AudioLibrary).all():
            if os.path.isdir(lib.path):
                watch_library(lib.id, lib.path, kind="audio")
    finally:
        db.close()

    # Reconcile every library against disk now and every _RECONCILE_INTERVAL
    # thereafter, so files added/deleted while the app was down — or missed
    # because fs events never arrived at all — get picked up without a live
    # event. Daemon thread: a large library's walk+probe must not block
    # startup, and the loop dies with the process (shutdown() also signals it).
    _reconcile_stop.clear()
    threading.Thread(target=_reconcile_loop, daemon=True, name="fs-watcher-reconcile").start()


def reconcile_all() -> None:
    """Full disk<->DB reconcile for every library — the same work a debounced
    fire does, but for all libraries and triggered by a timer instead of an
    fs event. Safe to call anytime; serialized against live fires by _apply_lock."""
    from app.database import SessionLocal
    from app.models.audio_library import AudioLibrary
    from app.models.image_library import ImageLibrary
    from app.models.library import Library

    db = SessionLocal()
    try:
        videos = [lib.id for lib in db.query(Library).all() if os.path.isdir(lib.path)]
        images = [lib.id for lib in db.query(ImageLibrary).all() if os.path.isdir(lib.path)]
        audios = [lib.id for lib in db.query(AudioLibrary).all() if os.path.isdir(lib.path)]
    finally:
        db.close()

    with _apply_lock:
        for lid in videos:
            _apply_video_changes(lid, frozenset())
        for lid in images:
            _apply_image_changes(lid, frozenset())
        for lid in audios:
            _apply_audio_changes(lid, frozenset())


def _reconcile_loop() -> None:
    reconcile_all()
    logger.info("Watcher: startup reconcile complete")
    while not _reconcile_stop.wait(_RECONCILE_INTERVAL):
        try:
            reconcile_all()
        except Exception:
            logger.exception("Watcher: periodic reconcile failed")
