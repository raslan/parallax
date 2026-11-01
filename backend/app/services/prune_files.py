"""File listing and safe deletion for the Prune page.

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
import warnings
from collections import OrderedDict
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

from app.config import DATA_DIR
from app.services import image_scanner, prune_scan, scanner
from app.services.audio_scanner import probe_audio
from app.services.prune_sandbox import SandboxError, is_hidden, kind_of, resolve_inside
from app.services.prune_scan import Counts
from app.services.scanner import grab_frame, probe_file

THUMB_DIR = os.path.join(DATA_DIR, "prune-thumbnails")

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
_probe_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="prune-probe")


def clear_details_cache() -> None:
    _details_cache.clear()


def _num(value, cast):
    try:
        return cast(value)
    except (TypeError, ValueError):
        return None


def _parse_probe(info: dict) -> dict | None:
    if not info:
        return None
    streams = info.get("streams") or [{}]
    s, fmt = streams[0], info.get("format") or {}
    return {
        "duration": _num(fmt.get("duration") or s.get("duration"), float),
        "width": _num(s.get("width"), int),
        "height": _num(s.get("height"), int),
        "codec": s.get("codec_name"),
        "bitrate": _num(fmt.get("bit_rate") or s.get("bit_rate"), int),
    }


_EXIF_ORIENTATION = 0x0112


def _image_details(path: str) -> dict | None:
    """Displayed width/height + format from the image header only (no pixel decode).

    EXIF orientations 5–8 (rotated 90/270) swap width and height, so orientation
    filters see the image the way a viewer shows it. Corrupt files and
    decompression bombs come back None, never raised.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
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
        result = _parse_probe((probe_file if kind == "video" else probe_audio)(path))
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
    return os.path.dirname(real), prune_scan.file_counts(os.path.basename(real), st.st_size)


def delete_files(root: str, paths: list[str]) -> dict:
    deleted: list[str] = []
    failed: list[dict] = []
    per_folder: dict[str, Counts] = {}
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
    empty: list[str] = []
    for folder, counts in per_folder.items():
        prune_scan.apply_deleted_files(folder, counts)
        if folder == os.path.realpath(root):
            continue  # the root is never offered for deletion
        try:
            if not os.listdir(folder):
                empty.append(folder)
        except OSError:
            pass
    return {"deleted": deleted, "failed": failed, "empty_folders": empty}


def delete_folder(root: str, path: str, only_if_empty: bool = False) -> None:
    """Recursively delete a folder inside ``root`` (never the root, never a symlink).

    ``only_if_empty`` uses ``os.rmdir`` instead, so a folder that gained an
    entry since it was offered as empty is kept (409).
    """
    path = _strip_trailing_seps(path)
    try:
        if os.path.islink(path):
            raise SandboxError(400, "Symbolic links are not deleted")
        real = resolve_inside(root, path)
    except ValueError as e:  # NUL byte
        raise SandboxError(400, "Invalid path") from e
    if real == os.path.realpath(root):
        raise SandboxError(400, "The root folder cannot be deleted")
    if not os.path.isdir(real):
        raise SandboxError(400, "Not a folder")
    if only_if_empty:
        try:
            os.rmdir(real)
        except OSError as e:
            if e.errno in (errno.ENOTEMPTY, errno.EEXIST):
                raise SandboxError(409, "Folder is no longer empty") from e
            raise SandboxError(500, f"Could not delete folder: {e.strerror or e}") from e
        prune_scan.remove_folder(real)
        return
    try:
        shutil.rmtree(real)
    except OSError as e:
        prune_scan.invalidate()  # partial delete: the cache can no longer be trusted
        raise SandboxError(500, f"Could not delete folder: {e.strerror or e}") from e
    prune_scan.remove_folder(real)


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
    out, failed = f"{stem}.jpg", f"{stem}.jpg.failed"
    if os.path.exists(out):
        _touch(out)
        return out
    if os.path.exists(failed):
        _touch(failed)
        return None
    with _LOCK_STRIPES[int(key.hexdigest(), 16) % len(_LOCK_STRIPES)]:
        if os.path.exists(out):
            return out
        if os.path.exists(failed):
            return None
        os.makedirs(THUMB_DIR, exist_ok=True)
        tmp = f"{stem}.{threading.get_ident()}.tmp.jpg"
        ok = False
        try:
            if kind == "image":
                with image_scanner._thumbnail_gen_semaphore:
                    image_scanner.generate_thumbnail(path, tmp)
                ok = os.path.exists(tmp)
            else:
                with scanner._thumbnail_gen_semaphore:
                    ok = grab_frame(path, tmp) and os.path.exists(tmp)
            if ok:
                os.replace(tmp, out)
        except Exception:
            ok = False
        finally:
            with contextlib.suppress(OSError):
                os.remove(tmp)
        if ok:
            return out
        with contextlib.suppress(OSError):
            open(failed, "w").close()
        return None


# ── thumbnail cache eviction ─────────────────────────────────────────────────

_MAX_THUMB_AGE = 30 * 86400  # unused (mtime untouched) this long -> evicted
_MAX_THUMB_BYTES = 500 * 1024 * 1024
_EVICT_INTERVAL = 6 * 3600  # lazy sweep at most this often
_TOUCH_AFTER = 86400  # refresh a hit's mtime at most once a day
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
