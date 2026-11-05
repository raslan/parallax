"""File listing and safe deletion for the Organize page.

Plain sync, blocking functions (the routers are sync ``def``s, so FastAPI runs
them in its threadpool). Because
``resolve_inside`` follows the final symlink, every delete also inspects the
*unresolved* path and refuses symlinks outright.
"""

import contextlib
import errno
import hashlib
import os
import re
import shutil
import stat
import subprocess
import threading
import time
from collections import OrderedDict
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

from app.config import DATA_DIR
from app.services import audio_scanner, image_scanner, organize_scan, scanner, stats
from app.services.organize_sandbox import (
    DeleteFailed,
    FolderNotEmpty,
    InvalidPath,
    SandboxError,
    is_hidden,
    kind_of,
    resolve_inside,
)
from app.services.organize_scan import Counts
from app.services.scanner import grab_frame
from app.services.thumbnail_common import (
    IMAGE_THUMB_SEMAPHORE,
    VIDEO_THUMB_SEMAPHORE,
    get_or_create,
)

THUMB_DIR = os.path.join(DATA_DIR, "organize-thumbnails")

# Formats browsers play natively; anything else is served via /audio (mp3 transcode).
NATIVE_AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".flac"}

_LOCK_STRIPES = [threading.Lock() for _ in range(64)]


class LRUCache:
    """Tiny thread-safe LRU (extract only if a second consumer appears)."""

    def __init__(self, capacity: int) -> None:
        self._cap = capacity
        self._data: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key not in self._data:
                return None
            self._data.move_to_end(key)
            return self._data[key]

    def put(self, key, value) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self._cap:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


_details_cache = LRUCache(2000)
_probe_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="organize-probe")


def clear_details_cache() -> None:
    _details_cache.clear()


def _media_details(path: str, kind: str) -> dict | None:
    """Video/audio details from the library scanners' own probe mappers, so an Organize
    value means what the same column means on Files/Cleanup (e.g. bitrate = stream
    bit_rate, else the container's). Audio goes through the scanner's dead-mount
    wall-clock guard. None when ffprobe fails or the file vanishes mid-probe."""
    try:
        if kind == "video":
            m = scanner.probe_metadata(path)
            width, height, bitrate = m["file_width"], m["file_height"], m["video_bitrate"]
        else:
            m = audio_scanner.probe_audio_metadata_guarded(path)
            width, height, bitrate = None, None, m["bitrate"]
    # OSError: the mapper's own stat/getmtime (the file went away). ValueError/TypeError:
    # a malformed ffprobe value the mapper can't convert; must not 500 the whole batch.
    except (OSError, ValueError, TypeError):
        return None
    if not m["probe_ok"]:
        return None
    return {
        "duration": m["duration"],
        "width": width,
        "height": height,
        "codec": m["codec_name"],
        "bitrate": bitrate,
    }


_EXIF_ORIENTATION = 0x0112


def _image_details(path: str) -> dict | None:
    """Displayed width/height + format from the image header only (no pixel decode).

    EXIF orientations 5–8 (rotated 90/270) swap width and height, so orientation
    filters see the image the way a viewer shows it. Corrupt files and
    decompression bombs come back None, never raised.
    """
    # No warnings.catch_warnings() here: it swaps process-global state and is not
    # thread-safe on the probe pool. A bomb *warning* is only logged; the
    # DecompressionBombError (> 2x the limit) is caught below.
    try:
        with Image.open(path) as im:
            width, height = im.size
            fmt = im.format
            with contextlib.suppress(Exception):
                if im.getexif().get(_EXIF_ORIENTATION) in (5, 6, 7, 8):
                    width, height = height, width
    except Exception:
        return None
    return {
        "duration": None,
        "width": width,
        "height": height,
        "codec": fmt.lower() if fmt else None,
        "bitrate": None,
    }


def _details_one(path: str) -> dict | None:
    path = _strip_trailing_seps(path)
    name = os.path.basename(path)
    kind = kind_of(name)
    if kind == "other" or is_hidden(name):
        return None
    try:
        st = os.lstat(path)
    except OSError:
        return None
    if not stat.S_ISREG(st.st_mode):  # also rejects symlinks
        return None
    key = (path, st.st_size, st.st_mtime_ns)
    hit = _details_cache.get(key)
    if hit is not None:
        return hit
    if kind == "image":
        result = _image_details(path)
    else:
        result = _media_details(path, kind)
    if result is not None:  # failures are not cached (may be transient)
        _details_cache.put(key, result)
    return result


def get_details(paths: list[str]) -> dict[str, dict | None]:
    """Details per path: ffprobe for video/audio, Pillow header for images
    (kind ``other`` and failures -> None).

    Callers must have sandboxed ``paths`` already. Blocking: call via a threadpool.
    """
    unique = list(dict.fromkeys(paths))
    return dict(zip(unique, _probe_pool.map(_details_one, unique), strict=True))


def list_files(folder: str) -> list[dict]:
    """Direct, non-hidden, regular, non-symlink files of ``folder`` (live scandir)."""
    out: list[dict] = []
    with os.scandir(folder) as it:
        for entry in it:
            if is_hidden(entry.name):
                continue
            try:
                if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                    continue
                st = entry.stat(follow_symlinks=False)
            except OSError:
                continue
            out.append(
                {
                    "name": entry.name,
                    "path": os.path.join(folder, entry.name),
                    "kind": kind_of(entry.name),
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                }
            )
    out.sort(key=lambda f: f["name"].casefold())
    return out


def _strip_trailing_seps(path: str) -> str:
    """``ln/`` follows a symlink in lstat/islink; drop trailing separators first."""
    return path.rstrip(os.sep) or path


def _delete_one(root: str, path: str) -> tuple[str, Counts]:
    """Delete one regular file; returns (parent folder, counts). Raises ValueError on refusal.

    Note: a parent directory swapped for a symlink between the checks and the
    remove is a tiny TOCTOU window we accept (single-owner tool).
    """
    path = _strip_trailing_seps(path)
    try:
        real = resolve_inside(root, path)
    except SandboxError as e:
        raise ValueError(str(e)) from e
    if is_hidden(os.path.basename(path)):
        raise ValueError("Hidden files are not managed here")
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        raise ValueError("File no longer exists") from None
    if stat.S_ISLNK(st.st_mode):
        raise ValueError("Symbolic links are not deleted")
    if not stat.S_ISREG(st.st_mode):
        raise ValueError("Not a regular file")
    if real == os.path.realpath(root):
        raise ValueError("Not a regular file")
    os.remove(real)
    return os.path.dirname(real), organize_scan.file_counts(os.path.basename(real), st.st_size)


def delete_files(root: str, paths: list[str]) -> dict:
    deleted: list[str] = []
    failed: list[dict] = []
    per_folder: dict[str, Counts] = {}
    removed: dict[str, list[int]] = {}  # media kind -> [files, bytes], successes only
    for path in dict.fromkeys(paths):
        try:
            folder, counts = _delete_one(root, path)
        except ValueError as e:
            failed.append({"path": path, "error": str(e) or "Invalid path"})
            continue
        except OSError as e:
            failed.append({"path": path, "error": e.strerror or "Could not delete"})
            continue
        deleted.append(path)
        per_folder.setdefault(folder, Counts()).add(counts)
        tally = removed.setdefault(kind_of(os.path.basename(_strip_trailing_seps(path))), [0, 0])
        tally[0] += 1
        tally[1] += counts.bytes  # lstat size taken just before the unlink
    # Home dashboard parity with the other delete paths: one file-agnostic event per
    # media kind (no paths, names or root). Folder deletes are deliberately not counted.
    for media, (files, size) in removed.items():
        stats.record_removal(media, files, size)
    empty: list[str] = []
    for folder, counts in per_folder.items():
        organize_scan.apply_deleted_files(folder, counts)
        if folder == os.path.realpath(root):
            continue  # the root is never offered for deletion
        try:
            if not os.listdir(folder):
                empty.append(folder)
        except OSError:
            pass
    return {"deleted": deleted, "failed": failed, "empty_folders": empty}


_MAX_NAME_BYTES = 255


def _validate_name(name: str, noun: str = "folder") -> str:
    """A single, visible path component: no separators, NUL, ``.``/``..`` or leading dot."""
    name = name.strip()
    if (
        not name
        or "/" in name
        or "\\" in name
        or "\x00" in name
        or name in (".", "..")
        or is_hidden(name)
    ):
        raise InvalidPath(f"Invalid {noun} name")
    if len(name.encode("utf-8", "surrogateescape")) > _MAX_NAME_BYTES:
        raise InvalidPath(f"{noun.capitalize()} name is too long")
    return name


def _unique_target(dest: str, filename: str) -> str:
    """``dest/filename``, or ``dest/stem (1).ext``, ``(2)``… when that name is taken.
    Moving never overwrites."""
    target = os.path.join(dest, filename)
    if not os.path.lexists(target):
        return target
    stem, ext = os.path.splitext(filename)
    n = 1
    while os.path.lexists(target := os.path.join(dest, f"{stem} ({n}){ext}")):
        n += 1
    return target


def _move_one(root: str, folder: str, dest: str, path: str) -> int:
    """Move one regular file from ``folder`` into ``dest``; returns its size.
    Raises ValueError on refusal (same rules as ``_delete_one``)."""
    path = _strip_trailing_seps(path)
    try:
        real = resolve_inside(root, path)
    except SandboxError as e:
        raise ValueError(str(e)) from e
    if is_hidden(os.path.basename(path)):
        raise ValueError("Hidden files are not managed here")
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        raise ValueError("File no longer exists") from None
    if stat.S_ISLNK(st.st_mode):
        raise ValueError("Symbolic links are not moved")
    if not stat.S_ISREG(st.st_mode):
        raise ValueError("Not a regular file")
    if os.path.dirname(real) != folder:
        raise ValueError("Not in the open folder")
    os.makedirs(dest, exist_ok=True)  # only once a file is known to move
    shutil.move(real, _unique_target(dest, os.path.basename(real)))
    return st.st_size


def move_to_subfolder(root: str, folder: str, paths: list[str], name: str) -> dict:
    """Move ``paths`` (direct files of ``folder``) into ``folder/name``, creating it.

    An existing folder of that name is reused; a taken file name inside it gets a
    `` (1)``, `` (2)``… suffix, so nothing is ever overwritten. Per-path refusals come
    back in ``failed``; the folder is only created once a file is known to move.
    """
    name = _validate_name(name)
    real_folder = _open_folder(root, folder)
    dest = os.path.join(real_folder, name)
    if os.path.islink(dest) or (os.path.lexists(dest) and not os.path.isdir(dest)):
        raise InvalidPath("A file with that name already exists")
    moved, failed, counts = _move_all(root, real_folder, dest, paths)
    if moved:
        organize_scan.apply_moved_to_subfolder(real_folder, name, counts)
    return {"folder": dest, "moved": moved, "failed": failed}


def move_to_folder(root: str, folder: str, paths: list[str], destination: str) -> dict:
    """Move ``paths`` (direct files of ``folder``) into the existing folder ``destination``
    anywhere inside the root. Same collision rule as ``move_to_subfolder``."""
    real_folder = _open_folder(root, folder)
    destination = _strip_trailing_seps(destination)
    if os.path.islink(destination):
        raise InvalidPath("Symbolic links are not managed here")
    dest = resolve_inside(root, destination)
    if not os.path.isdir(dest):
        raise InvalidPath("Not a folder")
    if dest == real_folder:
        raise InvalidPath("The files are already in that folder")
    moved, failed, counts = _move_all(root, real_folder, dest, paths)
    if moved:
        organize_scan.apply_moved_between(real_folder, dest, counts)
    return {"folder": dest, "moved": moved, "failed": failed}


def _open_folder(root: str, folder: str) -> str:
    """The sandboxed real path of the open folder (a non-symlink directory)."""
    folder = _strip_trailing_seps(folder)
    if os.path.islink(folder):
        raise InvalidPath("Symbolic links are not managed here")
    real_folder = resolve_inside(root, folder)
    if not os.path.isdir(real_folder):
        raise InvalidPath("Not a folder")
    return real_folder


def _move_all(
    root: str, folder: str, dest: str, paths: list[str]
) -> tuple[list[str], list[dict], Counts]:
    """Move each path into ``dest``; returns (moved, failed, counts of what moved)."""
    moved: list[str] = []
    failed: list[dict] = []
    counts = organize_scan.Counts()
    for path in dict.fromkeys(paths):
        try:
            size = _move_one(root, folder, dest, path)
        except ValueError as e:
            failed.append({"path": path, "error": str(e) or "Invalid path"})
            continue
        except OSError as e:
            failed.append({"path": path, "error": e.strerror or "Could not move"})
            continue
        moved.append(path)
        counts.add(organize_scan.file_counts(os.path.basename(_strip_trailing_seps(path)), size))
    return moved, failed, counts


def _rename_one(root: str, folder: str, path: str, new_name: str) -> str:
    """Rename one regular file of ``folder`` in place; returns its new path.
    Raises ValueError on refusal. Never overwrites."""
    path = _strip_trailing_seps(path)
    try:
        new_name = _validate_name(new_name, "file")
        real = resolve_inside(root, path)
    except SandboxError as e:
        raise ValueError(str(e)) from e
    if is_hidden(os.path.basename(path)):
        raise ValueError("Hidden files are not managed here")
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        raise ValueError("File no longer exists") from None
    if stat.S_ISLNK(st.st_mode):
        raise ValueError("Symbolic links are not renamed")
    if not stat.S_ISREG(st.st_mode):
        raise ValueError("Not a regular file")
    if os.path.dirname(real) != folder:
        raise ValueError("Not in the open folder")
    target = os.path.join(folder, new_name)
    if os.path.basename(real) == new_name:
        raise ValueError("Name is unchanged")
    if os.path.lexists(target):
        raise ValueError("A file with that name already exists")
    os.rename(real, target)
    return target


def rename_files(root: str, folder: str, items: list[tuple[str, str]]) -> dict:
    """Rename direct files of ``folder``: ``items`` are ``(path, new_name)`` pairs.

    Nothing is ever overwritten: a taken name fails just that item. Per-item refusals
    come back in ``failed``."""
    real_folder = _open_folder(root, folder)
    renamed: list[dict] = []
    failed: list[dict] = []
    seen: set[str] = set()
    for path, new_name in items:
        if path in seen:
            continue
        seen.add(path)
        try:
            new_path = _rename_one(root, real_folder, path, new_name)
        except ValueError as e:
            failed.append({"path": path, "error": str(e) or "Invalid name"})
            continue
        except OSError as e:
            failed.append({"path": path, "error": e.strerror or "Could not rename"})
            continue
        renamed.append({"path": path, "new_path": new_path})
        old_kind, new_kind = kind_of(os.path.basename(path)), kind_of(os.path.basename(new_path))
        if old_kind != new_kind:
            size = os.lstat(new_path).st_size
            organize_scan.apply_recounted_file(
                real_folder,
                organize_scan.file_counts(os.path.basename(path), size),
                organize_scan.file_counts(os.path.basename(new_path), size),
            )
    return {"renamed": renamed, "failed": failed}


def rename_folder(root: str, path: str, new_name: str) -> str:
    """Rename a folder in place (never the root, never a symlink); returns its new path."""
    new_name = _validate_name(new_name)
    path = _strip_trailing_seps(path)
    if os.path.islink(path):
        raise InvalidPath("Symbolic links are not renamed")
    real = resolve_inside(root, path)
    if real == os.path.realpath(root):
        raise InvalidPath("The root folder cannot be renamed")
    if not os.path.isdir(real):
        raise InvalidPath("Not a folder")
    if os.path.basename(real) == new_name:
        raise InvalidPath("Name is unchanged")
    target = os.path.join(os.path.dirname(real), new_name)
    if os.path.lexists(target):
        raise InvalidPath("A file or folder with that name already exists")
    try:
        os.rename(real, target)
    except OSError as e:
        raise InvalidPath(f"Could not rename: {e.strerror or e}") from e
    organize_scan.apply_renamed_folder(real, new_name)
    return target


def delete_folder(root: str, path: str, only_if_empty: bool = False) -> None:
    """Recursively delete a folder inside ``root`` (never the root, never a symlink).

    ``only_if_empty`` uses ``os.rmdir`` instead, so a folder that gained an
    entry since it was offered as empty is kept (``FolderNotEmpty``).
    """
    path = _strip_trailing_seps(path)
    if os.path.islink(path):  # islink() is False for a NUL path; resolve_inside refuses it
        raise InvalidPath("Symbolic links are not deleted")
    real = resolve_inside(root, path)
    if real == os.path.realpath(root):
        raise InvalidPath("The root folder cannot be deleted")
    if not os.path.isdir(real):
        raise InvalidPath("Not a folder")
    if only_if_empty:
        try:
            os.rmdir(real)
        except OSError as e:
            if e.errno in (errno.ENOTEMPTY, errno.EEXIST):
                raise FolderNotEmpty("Folder is no longer empty") from e
            raise DeleteFailed(f"Could not delete folder: {e.strerror or e}") from e
        organize_scan.remove_folder(real)
        return
    try:
        shutil.rmtree(real)
    except OSError as e:
        organize_scan.invalidate()  # partial delete: the cache can no longer be trusted
        raise DeleteFailed(f"Could not delete folder: {e.strerror or e}") from e
    organize_scan.remove_folder(real)


def servable_file(path: str) -> bool:
    """True for a non-hidden regular file reached without a final symlink."""
    path = _strip_trailing_seps(path)
    if is_hidden(os.path.basename(path)):
        return False
    try:
        return stat.S_ISREG(os.lstat(path).st_mode)
    except OSError:
        return False


def thumbnail_for(path: str) -> str | None:
    """Cached JPEG thumbnail for a video or image (None for audio/other/failures).

    Cache key = sha1(path|size|mtime_ns), so an edited file gets a fresh one.
    Blocking (ffmpeg/Pillow): call via a threadpool.
    """
    path = _strip_trailing_seps(path)
    kind = kind_of(os.path.basename(path))
    if kind not in ("video", "image") or not servable_file(path):
        return None
    try:
        st = os.lstat(path)
    except OSError:
        return None
    maybe_evict_thumbnails()
    key = hashlib.sha1(f"{path}|{st.st_size}|{st.st_mtime_ns}".encode("utf-8", "surrogateescape"))
    stem = os.path.join(THUMB_DIR, key.hexdigest())
    out = f"{stem}.jpg"

    def generate() -> bool:
        os.makedirs(THUMB_DIR, exist_ok=True)
        tmp = f"{stem}.{threading.get_ident()}.tmp.jpg"  # name matched by eviction
        try:
            if kind == "image":
                image_scanner.generate_thumbnail(path, tmp)
                ok = os.path.exists(tmp)
            else:
                ok = grab_frame(path, tmp) and os.path.exists(tmp)
            if ok:
                os.replace(tmp, out)
            return ok
        except Exception:
            return False
        finally:
            with contextlib.suppress(OSError):
                os.remove(tmp)

    try:
        return get_or_create(
            out,
            generate,
            semaphore=IMAGE_THUMB_SEMAPHORE if kind == "image" else VIDEO_THUMB_SEMAPHORE,
            lock=lambda: _LOCK_STRIPES[int(key.hexdigest(), 16) % len(_LOCK_STRIPES)],
            failed_path=f"{out}.failed",
            on_hit=_touch,
        )
    except OSError:  # e.g. the .failed marker could not be written: just no thumbnail
        return None


# ── thumbnail cache eviction ─────────────────────────────────────────────────

_MAX_THUMB_AGE = 30 * 86400  # unused (mtime untouched) this long -> evicted
_MAX_THUMB_BYTES = 500 * 1024 * 1024
_EVICT_INTERVAL = 6 * 3600  # lazy sweep at most this often
_TOUCH_AFTER = 86400  # refresh a hit's mtime at most once a day
_TMP_GRACE = 3600  # in-flight .tmp files younger than this are never evicted
# Only our own cache entries: sha1.jpg, sha1.jpg.failed, sha1.<tid>.tmp.jpg
_THUMB_NAME = re.compile(r"[0-9a-f]{40}(\.\d+\.tmp)?\.jpg(\.failed)?")
_evict_lock = threading.Lock()
_last_evict = 0.0


def _touch(path: str) -> None:
    """Mark a cache hit as used so age eviction keeps it (throttled to one write a day)."""
    with contextlib.suppress(OSError):
        if time.time() - os.stat(path).st_mtime > _TOUCH_AFTER:
            os.utime(path)


def evict_thumbnails(
    directory: str | None = None,
    *,
    max_age: float = _MAX_THUMB_AGE,
    max_bytes: int = _MAX_THUMB_BYTES,
    now: float | None = None,
) -> int:
    """Delete cache entries older than ``max_age`` (by mtime), then the oldest until
    the cache is under ``max_bytes``. Only regular files named like cache entries
    directly inside ``directory`` (no recursion, no symlinks). Never raises.
    Returns the number of entries removed."""
    directory = directory or THUMB_DIR
    now = time.time() if now is None else now
    entries: list[tuple[float, int, str]] = []
    try:
        with os.scandir(directory) as it:
            for e in it:
                try:
                    if not _THUMB_NAME.fullmatch(e.name) or not e.is_file(follow_symlinks=False):
                        continue
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                if ".tmp." in e.name and now - st.st_mtime < _TMP_GRACE:
                    continue  # a generation still writing it; os.replace() would race
                entries.append((st.st_mtime, st.st_size, e.path))
    except OSError:
        return 0
    entries.sort()
    total = sum(size for _, size, _ in entries)
    removed = 0
    for mtime, size, path in entries:
        if now - mtime <= max_age and total <= max_bytes:
            break  # sorted oldest first: everything after is newer and fits
        try:
            os.remove(path)
        except OSError:
            continue
        removed += 1
        total -= size
    return removed


def clear_thumbnail_cache() -> int:
    """Drop every cache entry (the per-session wipe done at startup). Same guards as
    ``evict_thumbnails`` — only cache-named regular files; never raises."""
    with contextlib.suppress(Exception):
        return evict_thumbnails(max_age=0, max_bytes=0)
    return 0


def _evict_quietly(directory: str) -> None:
    with contextlib.suppress(Exception):
        evict_thumbnails(directory)


def maybe_evict_thumbnails(now: float | None = None) -> bool:
    """Start a background eviction sweep unless one ran in the last ``_EVICT_INTERVAL``.
    Never blocks the caller (called at startup and on thumbnail requests)."""
    global _last_evict
    now = time.time() if now is None else now
    with _evict_lock:
        if now - _last_evict < _EVICT_INTERVAL:
            return False
        _last_evict = now
    threading.Thread(target=_evict_quietly, args=(THUMB_DIR,), daemon=True).start()
    return True


def stream_audio_mp3(path: str) -> Iterator[bytes]:
    """Yield an on-the-fly mp3 transcode of ``path`` (ffmpeg stdout)."""
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", path, "-vn", "-c:a", "libmp3lame", "-b:a", "192k"]
        + ["-f", "mp3", "pipe:1"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        assert proc.stdout is not None
        while chunk := proc.stdout.read(64 * 1024):
            yield chunk
    finally:
        proc.kill()
        proc.wait()
        if proc.stdout:
            proc.stdout.close()
