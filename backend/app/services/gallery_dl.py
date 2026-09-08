"""gallery-dl download service — self-contained, no imports from downloader.py.

Shared mechanism (semaphore, cookies tempfile, ProcessGroup) comes from
download_common. gallery-dl itself is a pip package (stable pinned in
requirements.txt; the page Update button pulls the git nightly into
GALLERY_DL_PKG_DIR), invoked as ``python -m gallery_dl``.
"""

import asyncio
import json
import logging
import os
import select
import shlex
import shutil
import signal
import subprocess
import sys
import time
from collections import deque

from app.config import GALLERY_DL_DIR
from app.database import SessionLocal
from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus
from app.schemas import GalleryOptions
from app.services.common import now
from app.services.download_common import (
    ProcessGroup,
    ResizableSemaphore,
    cookies_to_tempfile,
)
from app.services.gallery_options import load_options

logger = logging.getLogger(__name__)

URLS_FILE = os.path.join(GALLERY_DL_DIR, "urls.txt")
DEFAULT_ARCHIVE = os.path.join(GALLERY_DL_DIR, "archive.sqlite3")
GALLERY_DL_PKG_DIR = os.path.join(GALLERY_DL_DIR, "site")
GALLERY_DL_NIGHTLY_SPEC = "gallery-dl @ git+https://github.com/mikf/gallery-dl.git"

SENTINEL_FILE = "\x1fPXF\x1f"
SENTINEL_SKIP = "\x1fPXS\x1f"
SENTINEL_ERROR = "\x1fPXE\x1f"

EXT_SETS: dict[str, tuple[str, ...]] = {
    "video": ("mp4", "mkv", "m4v", "webm", "mov", "avi", "wmv", "flv", "mpg", "mpeg", "3gp", "ts"),
    "audio": ("mp3", "m4a", "aac", "flac", "ogg", "opus", "wav", "wma"),
    "image": ("jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "heic", "heif", "tiff", "svg"),
}


def _gallery_dl_argv_prefix() -> list[str]:
    """argv[0..] to invoke gallery-dl as a module. Its own seam so tests can fake it."""
    return [sys.executable, "-m", "gallery_dl"]


def _gallery_dl_env() -> dict[str, str]:
    """os.environ with GALLERY_DL_PKG_DIR prepended to PYTHONPATH, so a page-installed
    nightly (pip --target) shadows the requirements.txt stable in site-packages."""
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = GALLERY_DL_PKG_DIR + (os.pathsep + existing if existing else "")
    return env


def type_filter_expr(opts: GalleryOptions) -> str | None:
    """`extension in (...)` for the ticked types, or None (typeAny / none ticked)."""
    if opts.typeAny:
        return None
    picked: list[str] = []
    for key, flag in (
        ("video", opts.typeVideo),
        ("audio", opts.typeAudio),
        ("image", opts.typeImage),
    ):
        if flag:
            picked.extend(EXT_SETS[key])
    if not picked:
        return None
    inner = ",".join(f"'{e}'" for e in picked)
    return f"extension in ({inner})"


def build_gallerydl_cmd(url: str, opts: GalleryOptions, cookies_file: str | None) -> list[str]:
    cmd: list[str] = [
        *_gallery_dl_argv_prefix(),
        "--no-part",
        "--no-colors",
        "-o",
        "output.mode=null",
        "--print",
        f"file:{SENTINEL_FILE}{{_path}}",
        "--print",
        f"skip:{SENTINEL_SKIP}{{_path}}",
        "--print",
        f"error:{SENTINEL_ERROR}{{_path}}",
        "--retries",
        str(opts.retries),
        "-d",
        opts.baseDir,
        "-o",
        f"downloader.http.timeout={opts.httpTimeout}",
    ]

    expr = type_filter_expr(opts)
    if expr:
        cmd += ["--filter", expr]

    if opts.maxSizeValue is not None:
        cmd += ["--filesize-max", f"{_num(opts.maxSizeValue)}{opts.maxSizeUnit}"]
    if opts.minSizeValue is not None:
        cmd += ["--filesize-min", f"{_num(opts.minSizeValue)}{opts.minSizeUnit}"]

    if opts.stopAfterExisting is not None:
        cmd += ["-T", str(opts.stopAfterExisting)]

    if opts.useArchive:
        cmd += ["--download-archive", opts.archivePath or DEFAULT_ARCHIVE]

    if opts.range.strip():
        cmd += ["--range", opts.range.strip()]
    if opts.browser.strip():
        cmd += ["-o", f"extractor.*.browser={opts.browser.strip()}"]
    if opts.userAgent.strip():
        cmd += ["--user-agent", opts.userAgent.strip()]
    if opts.limitRate.strip():
        cmd += ["--limit-rate", opts.limitRate.strip()]
    if opts.sleepRequest.strip():
        cmd += ["--sleep-request", opts.sleepRequest.strip()]
    if opts.filenameTemplate.strip():
        cmd += ["--filename", opts.filenameTemplate.strip()]

    if cookies_file:
        cmd += ["--cookies", cookies_file]

    if opts.extraArgs.strip():
        try:
            cmd += shlex.split(opts.extraArgs)
        except ValueError:
            cmd.append(opts.extraArgs)

    if opts.inputMode == "file":
        cmd += ["-i", URLS_FILE]
    else:
        cmd.append(url)

    return cmd


def _num(v: float) -> str:
    """3.0 -> '3', 3.5 -> '3.5' for size suffixes."""
    return str(int(v)) if float(v).is_integer() else str(v)


_STALL_TIMEOUT = 1200  # 20 min of zero output on either pipe
_RECENT_CAP = 15
_FLUSH_INTERVAL = 1.0

_pg = ProcessGroup()

_gallery_semaphore: ResizableSemaphore | None = None
_gallery_limit = 0


def classify_line(line: str) -> tuple[str, str] | None:
    for sentinel, kind in (
        (SENTINEL_FILE, "file"),
        (SENTINEL_SKIP, "skip"),
        (SENTINEL_ERROR, "error"),
    ):
        if line.startswith(sentinel):
            return kind, line[len(sentinel) :]
    return None


def get_gallery_semaphore(limit: int) -> ResizableSemaphore:
    global _gallery_semaphore, _gallery_limit
    limit = max(1, min(5, limit))
    if _gallery_semaphore is None:
        _gallery_semaphore = ResizableSemaphore(limit)
        _gallery_limit = limit
    elif limit != _gallery_limit:
        _gallery_semaphore.resize(limit)
        _gallery_limit = limit
    return _gallery_semaphore


def set_gallery_max_parallel(limit: int) -> None:
    get_gallery_semaphore(limit)


async def run_gallery(row_id: int, cookies: str, max_parallel: int) -> None:
    sem = get_gallery_semaphore(max_parallel)
    async with sem:
        await asyncio.to_thread(_run_gallery_sync, row_id, cookies)


def _set_status(row_id: int, **fields) -> None:
    with SessionLocal() as s:
        row = s.get(GalleryDownload, row_id)
        if row is None:
            return
        for k, v in fields.items():
            setattr(row, k, v)
        s.commit()


def _kill(proc: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, OSError):
        proc.kill()


def _run_gallery_sync(row_id: int, cookies: str) -> None:
    if _pg.is_cancel_requested(row_id):
        _pg.discard(row_id)
        _set_status(
            row_id,
            status=GalleryDownloadStatus.CANCELLED,
            finished_at=now(),
        )
        return

    _set_status(row_id, status=GalleryDownloadStatus.RUNNING, started_at=now())

    with SessionLocal() as s:
        row = s.get(GalleryDownload, row_id)
        if row is None:
            return
        url = row.url
        opts = None
        if row.options:
            try:
                opts = GalleryOptions.model_validate_json(row.options)
            except Exception:
                opts = None
        if opts is None:
            opts = load_options(s)

    cookies_tmp = cookies_to_tempfile(cookies)
    done = skipped = failed = 0
    last_filename: str | None = None
    recent: deque[str] = deque(maxlen=_RECENT_CAP)
    stderr_tail: deque[str] = deque(maxlen=40)
    stalled = False

    try:
        cmd = build_gallerydl_cmd(url, opts, cookies_tmp)
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
                env=_gallery_dl_env(),
            )
        except FileNotFoundError:
            _set_status(
                row_id,
                status=GalleryDownloadStatus.FAILED,
                error="gallery-dl not found. Use the Update button to install it.",
                finished_at=now(),
            )
            return

        _pg.register(row_id, proc)
        last_output = time.time()
        last_flush = 0.0
        dirty = False

        streams = [p for p in (proc.stdout, proc.stderr) if p is not None]
        while streams:
            ready, _, _ = select.select(streams, [], [], 5.0)
            if not ready:
                if time.time() - last_output > _STALL_TIMEOUT:
                    stalled = True
                    _kill(proc)
                    break
                continue
            for stream in ready:
                line = stream.readline()
                if line == "":
                    streams.remove(stream)
                    continue
                last_output = time.time()
                line = line.rstrip("\n")
                if stream is proc.stderr:
                    if line.strip():
                        stderr_tail.append(line)
                    continue
                hit = classify_line(line)
                if hit is None:
                    continue
                kind, path = hit
                base = os.path.basename(path)
                if kind == "file":
                    done += 1
                    last_filename = base
                    recent.append(base)
                elif kind == "skip":
                    skipped += 1
                else:
                    failed += 1
                dirty = True

            if dirty and time.time() - last_flush >= _FLUSH_INTERVAL:
                _set_status(
                    row_id,
                    files_done=done,
                    files_skipped=skipped,
                    files_failed=failed,
                    last_filename=last_filename,
                    recent_files=json.dumps(list(recent)),
                )
                last_flush = time.time()
                dirty = False

        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)

        cancelled = _pg.is_cancel_requested(row_id) or _pg.is_cancelled(row_id)
        if cancelled:
            final_status = GalleryDownloadStatus.CANCELLED
            error = None
        elif proc.returncode == 0 and not stalled:
            final_status = GalleryDownloadStatus.COMPLETED
            error = None
        else:
            final_status = GalleryDownloadStatus.FAILED
            tail = "\n".join(stderr_tail)
            error = (
                f"[parallax] stalled — no output for {_STALL_TIMEOUT}s\n\n{tail}"
                if stalled
                else f"gallery-dl exited {proc.returncode}\n\n{tail}"
            )

        _set_status(
            row_id,
            status=final_status,
            files_done=done,
            files_skipped=skipped,
            files_failed=failed,
            last_filename=last_filename,
            recent_files=json.dumps(list(recent)),
            error=error,
            finished_at=now(),
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("gallery-dl worker crashed for row %s", row_id)
        _set_status(
            row_id,
            status=GalleryDownloadStatus.FAILED,
            error=str(exc),
            finished_at=now(),
        )
    finally:
        _pg.unregister(row_id)
        _pg.discard(row_id)
        if cookies_tmp and os.path.exists(cookies_tmp):
            try:
                os.remove(cookies_tmp)
            except OSError:
                pass


def cancel_gallery(row_id: int) -> bool:
    _pg.request_cancel(row_id)
    last_filename: str | None = None
    output_dir: str | None = None
    try:
        with SessionLocal() as s:
            row = s.get(GalleryDownload, row_id)
            if row is not None:
                last_filename = row.last_filename
                output_dir = row.output_dir
    except Exception:
        last_filename = output_dir = None
    return _pg.cancel(
        row_id,
        sig=signal.SIGINT,
        escalate_after=3.0,
        on_escalated=lambda _key: _rm_partial_file(last_filename, output_dir),
    )


def _rm_partial_file(last_filename: str | None, output_dir: str | None) -> None:
    """After a hard SIGKILL, gallery-dl couldn't discard its in-flight file.

    We only know the basename (last stdout `file:`/`error:` line never fired a
    success), so walk the base dir for a match and remove it. Best effort — the
    row may already be gone by the time the escalation thread runs, so the two
    values are captured at cancel time and passed in rather than re-read here.
    """
    try:
        if not last_filename or not output_dir:
            return
        for dirpath, _dirs, names in os.walk(output_dir):
            if last_filename in names:
                try:
                    os.remove(os.path.join(dirpath, last_filename))
                except OSError:
                    pass
                return
    except Exception:
        pass


def get_gallerydl_info() -> dict:
    try:
        result = subprocess.run(
            [*_gallery_dl_argv_prefix(), "--version"],
            capture_output=True,
            text=True,
            timeout=15,
            env=_gallery_dl_env(),
        )
    except (OSError, subprocess.TimeoutExpired):
        return {"installed": False, "version": None, "path": None}
    if result.returncode != 0:
        return {"installed": False, "version": None, "path": None}
    version = result.stdout.strip() or None
    path = GALLERY_DL_PKG_DIR if os.path.isdir(GALLERY_DL_PKG_DIR) else "site-packages"
    return {"installed": True, "version": version, "path": path}


def install_gallerydl() -> None:
    """pip-install the gallery-dl nightly into GALLERY_DL_PKG_DIR, atomically.
    Blocking — callers wrap in asyncio.to_thread."""
    os.makedirs(GALLERY_DL_DIR, exist_ok=True)
    staging = GALLERY_DL_PKG_DIR + ".new"
    if os.path.isdir(staging):
        shutil.rmtree(staging, ignore_errors=True)
    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--target",
                staging,
                "--upgrade",
                GALLERY_DL_NIGHTLY_SPEC,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=600,
        )
        backup = GALLERY_DL_PKG_DIR + ".old"
        if os.path.isdir(backup):
            shutil.rmtree(backup, ignore_errors=True)
        if os.path.isdir(GALLERY_DL_PKG_DIR):
            os.replace(GALLERY_DL_PKG_DIR, backup)
        os.replace(staging, GALLERY_DL_PKG_DIR)
        if os.path.isdir(backup):
            shutil.rmtree(backup, ignore_errors=True)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
