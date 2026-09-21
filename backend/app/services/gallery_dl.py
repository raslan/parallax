"""gallery-dl download service — self-contained, no imports from downloader.py.

Shared mechanism (semaphore, cookies tempfile, ProcessGroup) comes from
download_common. gallery-dl itself is a pip package (stable pinned in
requirements.txt; the page Update button pulls the Codeberg master
tarball into GALLERY_DL_PKG_DIR — upstream dev moved off GitHub, whose
mirror lags), invoked as ``python -m gallery_dl``.
"""

import asyncio
import json
import logging
import os
import platform
import re
import select
import shlex
import shutil
import signal
import subprocess
import sys
import time
from collections import deque

from sqlalchemy.orm.exc import StaleDataError

from app.config import DATA_DIR, GALLERY_DL_DIR
from app.database import SessionLocal
from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus
from app.schemas import GalleryOptions
from app.services.common import now
from app.services.download_common import (
    ProcessGroup,
    ResizableSemaphore,
    cookies_to_tempfile,
    install_zip_binary,
)
from app.services.gallery_options import load_options

logger = logging.getLogger(__name__)

URLS_FILE = os.path.join(GALLERY_DL_DIR, "urls.txt")
DEFAULT_ARCHIVE = os.path.join(GALLERY_DL_DIR, "archive.sqlite3")
GALLERY_DL_PKG_DIR = os.path.join(GALLERY_DL_DIR, "site")
GALLERY_DL_NIGHTLY_SPEC = "gallery-dl @ https://codeberg.org/mikf/gallery-dl/archive/master.tar.gz"
# gallery-dl's `ytdl:` backend imports yt-dlp as a Python module (the standalone binary the
# Downloads page uses can't be imported), so it rides along in the same --target dir. The
# `.dev0` bound makes pip prefer yt-dlp's nightly builds without a global --pre, which would
# also admit pre-release *dependencies*.
YTDLP_NIGHTLY_SPEC = "yt-dlp[default]>=2026.1.1.dev0"

# yt-dlp needs a JS runtime to solve YouTube's challenges. deno is one binary in a release
# zip; stored beside the other binaries (DATA_DIR/yt-dlp, DATA_DIR/alass).
DENO_BIN = os.path.join(DATA_DIR, "deno")
_DENO_ARCH = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}

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
    # The container user has no home dir, so both tools' `~/.cache` default resolves to an
    # unwritable `/.cache`. Pin it into the data volume (also survives restarts, so yt-dlp's
    # solved YouTube signature functions aren't recomputed for every video).
    env["XDG_CACHE_HOME"] = os.path.join(GALLERY_DL_DIR, "cache")
    return env


def deno_url(machine: str | None = None) -> str | None:
    """Release-zip URL for this CPU architecture, or None when deno has no Linux build for it."""
    arch = _DENO_ARCH.get((machine or platform.machine()).lower())
    if arch is None:
        return None
    return f"https://github.com/denoland/deno/releases/latest/download/deno-{arch}-unknown-linux-gnu.zip"


def ensure_deno() -> None:
    """Download deno into DATA_DIR if missing. Blocking — wrap in asyncio.to_thread."""
    if os.access(DENO_BIN, os.X_OK):
        return
    url = deno_url()
    if url is None:
        raise RuntimeError(f"no deno build for {platform.machine()}")
    install_zip_binary(url, "deno", DENO_BIN)


_FOLDER_MAX = 120


def safe_folder_name(name: object) -> str | None:
    """Make *name* safe as one literal directory segment, or None if nothing usable is left.

    gallery-dl already turns `/` into `_` in every segment, but it lets `..` through, and a
    literal `{`/`}` would be parsed as a format field — so neither may reach the template.
    """
    if not name:
        return None
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", str(name))
    cleaned = re.sub(r"[/\\]", "_", cleaned)
    cleaned = re.sub(r"[{}]", "", cleaned)
    cleaned = cleaned.strip()[:_FOLDER_MAX].strip().strip(".")
    return cleaned or None


def folder_name_from_info(info: dict) -> str | None:
    """Folder name for a yt-dlp `-J --flat-playlist` dump: the channel or the playlist title.

    A channel page's `title` can carry a tab suffix ("Name - Shorts"), so a channel — its `id`
    is the channel id or an `@handle` — is named by `channel`. A real playlist is named by its
    `title`. A single video falls under its uploader, never its own title.
    """
    ident, chan_id = info.get("id"), info.get("channel_id")
    is_playlist = info.get("_type") == "playlist"
    is_channel_page = is_playlist and (
        bool(chan_id and ident == chan_id) or str(ident or "").startswith("@")
    )
    title, channel, uploader = info.get("title"), info.get("channel"), info.get("uploader")
    if is_playlist and not is_channel_page:
        candidates = (title, channel, uploader)
    else:
        candidates = (channel, uploader, title)
    for candidate in candidates:
        if name := safe_folder_name(candidate):
            return name
    return None


def probe_ytdl_folder(url: str, cookies_file: str | None) -> str | None:
    """Ask yt-dlp what *url* is (one cheap flat dump) and name the folder after it.

    gallery-dl resolves every playlist entry on its own, which drops the playlist metadata, so
    the playlist/channel name has to be learned up front. None on any failure — the caller
    falls back to a per-video `{channel|uploader}` template.
    """
    cmd = [sys.executable, "-m", "yt_dlp", "-J", "--flat-playlist", "--playlist-items", "1"]
    cmd += ["--js-runtimes", f"deno:{DENO_BIN}", "--no-warnings"]
    if cookies_file:
        cmd += ["--cookies", cookies_file]
    cmd.append(url)
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60, env=_gallery_dl_env()
        )
        if result.returncode != 0:
            return None
        return folder_name_from_info(json.loads(result.stdout))
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


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


def build_gallerydl_cmd(
    url: str,
    opts: GalleryOptions,
    cookies_file: str | None,
    *,
    backend: str = "native",
    folder: str | None = None,
) -> list[str]:
    """argv for one gallery-dl run. *backend* is "native" (the URL as given), "ytdl" or
    "generic" (the URL behind gallery-dl's `ytdl:` / `generic:` prefix). *folder* names the
    ytdl output directory; without it each video is foldered under its own uploader."""
    cmd: list[str] = [
        *_gallery_dl_argv_prefix(),
        "--no-part",
        "--no-colors",
        "--retries",
        str(opts.retries),
        "-d",
        opts.baseDir,
        "-o",
        f"downloader.http.timeout={opts.httpTimeout}",
    ]

    # ytdl items carry `extension: None` until they are downloaded, so an extension filter
    # silently drops every one of them (and gallery-dl still exits 0).
    expr = None if backend == "ytdl" else type_filter_expr(opts)
    if expr:
        cmd += ["--filter", expr]

    if backend == "ytdl":
        # generic=false: a page only yt-dlp's own generic extractor claims is "unsupported"
        # (exit 64) so the ladder moves on to gallery-dl's generic instead of yt-dlp guessing.
        # ignoreerrors: one private/removed video must not abort a whole channel or playlist.
        raw = {"ignoreerrors": True, "js_runtimes": {"deno": {"path": DENO_BIN}}}
        directory = ["{extractor}", folder or "{channel|uploader}"]
        cmd += ["-o", "extractor.ytdl.generic=false"]
        cmd += ["-o", f"extractor.ytdl.raw-options={json.dumps(raw)}"]
        cmd += ["-o", f"extractor.ytdl.directory={json.dumps(directory)}"]

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
        cmd.append(url if backend == "native" else f"{backend}:{url}")

    return cmd


def _num(v: float) -> str:
    """3.0 -> '3', 3.5 -> '3.5' for size suffixes."""
    return str(int(v)) if float(v).is_integer() else str(v)


def _redacted_argv(cmd: list[str]) -> list[str]:
    """cmd with the value following --cookies masked (never log a cookies path)."""
    out: list[str] = []
    mask_next = False
    for arg in cmd:
        if mask_next:
            out.append("***")
            mask_next = False
        else:
            out.append(arg)
            mask_next = arg == "--cookies"
    return out


_STALL_TIMEOUT = 1200  # 20 min of zero output on either pipe
_RECENT_CAP = 15
_LOG_CAP = 200
_FLUSH_INTERVAL = 1.0

_pg = ProcessGroup()

_gallery_semaphore: ResizableSemaphore | None = None
_gallery_limit = 0


def classify_line(line: str) -> tuple[str, str] | None:
    """Classify one gallery-dl stdout line (PipeOutput format).

    '# <path>' -> ("skip", <path>);  '<path>' -> ("file", <path>);  '' -> None.
    """
    line = line.rstrip("\n")
    if not line:
        return None
    if line.startswith("# "):
        return "skip", line[2:]
    return "file", line


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
        try:
            s.commit()
        except StaleDataError:
            # Row was deleted by another session (e.g. user deleted this
            # download from the UI) between our get() and commit() — same
            # as the row-is-None case above, just caught later.
            s.rollback()


def _kill(proc: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, OSError):
        proc.kill()


_PREFIX_BACKENDS = {"ytdl": "ytdl", "generic": "generic"}


def _split_prefix(url: str) -> tuple[str, str]:
    """(backend, bare url): a hand-typed `ytdl:` / `generic:` prefix picks that backend."""
    head, sep, rest = url.partition(":")
    if sep and head.lower() in _PREFIX_BACKENDS and not rest.startswith("//"):
        return _PREFIX_BACKENDS[head.lower()], rest
    return "native", url


def _ladder(url: str, opts: GalleryOptions) -> list[str]:
    """Backends to try in order. gallery-dl's own extractors first; a plain http(s) URL it has
    no extractor for (exit 64) falls through to yt-dlp, then to gallery-dl's generic scraper.
    A URL the user already routed with `ytdl:` / `generic:` runs only that backend, once; any
    other prefix (`recursive:`, …) and file mode run as given. directlink needs no rung — it
    matches file-extension URLs natively."""
    backend, _ = _split_prefix(url)
    if backend != "native":
        return [backend]
    if opts.inputMode == "paste" and re.match(r"https?://", url, re.IGNORECASE):
        return ["native", "ytdl", "generic"]
    return ["native"]


class _RunState:
    """Counters and tails for one row, carried through every attempt of its ladder."""

    def __init__(self) -> None:
        self.done = self.skipped = self.failed = 0
        self.last_filename: str | None = None
        self.recent: deque[str] = deque(maxlen=_RECENT_CAP)
        self.stderr_tail: deque[str] = deque(maxlen=_LOG_CAP)

    def fields(self) -> dict:
        return {
            "files_done": self.done,
            "files_skipped": self.skipped,
            "files_failed": self.failed,
            "last_filename": self.last_filename,
            "recent_files": json.dumps(list(self.recent)),
            "log_tail": "\n".join(self.stderr_tail),
        }

    def hop(self, note: str) -> None:
        """Forget a superseded attempt — its "Unsupported URL" error is not a failed file."""
        self.done = self.skipped = self.failed = 0
        self.last_filename = None
        self.recent.clear()
        self.stderr_tail.clear()
        self.stderr_tail.append(note)


def _run_attempt(row_id: int, cmd: list[str], state: _RunState) -> tuple[int | None, bool]:
    """Run one gallery-dl process to completion, feeding *state*.

    Returns ``(returncode, stalled)``; ``(None, False)`` when the binary is missing.
    """
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
        return None, False

    _pg.register(row_id, proc)
    stalled = False
    try:
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
                        state.stderr_tail.append(line)
                        dirty = True
                        if "][error]" in line:
                            state.failed += 1
                    continue
                hit = classify_line(line)
                if hit is None:
                    continue
                kind, path = hit
                base = os.path.basename(path)
                if kind == "file":
                    state.done += 1
                    state.last_filename = base
                    state.recent.append(base)
                elif kind == "skip":
                    state.skipped += 1
                dirty = True

            if dirty and time.time() - last_flush >= _FLUSH_INTERVAL:
                _set_status(row_id, **state.fields())
                last_flush = time.time()
                dirty = False

        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    finally:
        _pg.unregister(row_id)
    return proc.returncode, stalled


def _prepare_ytdl(url: str, cookies_file: str | None, state: _RunState) -> str | None:
    """Make sure deno is present and learn the folder name. Both best-effort: without deno
    yt-dlp only warns, and without a name the template falls back to per-video uploaders."""
    try:
        ensure_deno()
    except Exception as exc:
        state.stderr_tail.append(f"[parallax] could not fetch deno: {exc}")
    return probe_ytdl_folder(url, cookies_file)


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
    state = _RunState()
    backend = "native"
    returncode: int | None = None
    stalled = False

    try:
        rungs = _ladder(url, opts)
        bare = _split_prefix(url)[1]
        for i, backend in enumerate(rungs):
            target = url if backend == "native" else bare
            folder = _prepare_ytdl(target, cookies_tmp, state) if backend == "ytdl" else None
            cmd = build_gallerydl_cmd(target, opts, cookies_tmp, backend=backend, folder=folder)
            logger.info(
                "gallery-dl row %s: backend=%s baseDir=%s argv=%s",
                row_id,
                backend,
                opts.baseDir,
                _redacted_argv(cmd),
            )
            returncode, stalled = _run_attempt(row_id, cmd, state)
            if returncode is None:
                _set_status(
                    row_id,
                    status=GalleryDownloadStatus.FAILED,
                    error="gallery-dl not found. Use the Update button to install it.",
                    finished_at=now(),
                )
                return
            cancelled = _pg.is_cancel_requested(row_id) or _pg.is_cancelled(row_id)
            # 64 = "Unsupported URL" — no extractor claimed it. Anything else means an
            # extractor did claim it, so trying another backend would be wrong.
            if returncode & 64 and not cancelled and i + 1 < len(rungs):
                state.hop(f"[parallax] unsupported as-is — trying {rungs[i + 1]}")
                continue
            break

        cancelled = _pg.is_cancel_requested(row_id) or _pg.is_cancelled(row_id)
        tail = "\n".join(list(state.stderr_tail)[-40:])
        error = None
        if cancelled:
            final_status = GalleryDownloadStatus.CANCELLED
        elif returncode == 0 and not stalled:
            final_status = GalleryDownloadStatus.COMPLETED
            if backend == "ytdl" and not (state.done or state.skipped) and state.failed:
                # ignoreerrors makes yt-dlp exit 0 even when every entry failed
                final_status = GalleryDownloadStatus.FAILED
                error = f"yt-dlp reported errors and nothing was downloaded\n\n{tail}"
        else:
            final_status = GalleryDownloadStatus.FAILED
            error = (
                f"[parallax] stalled — no output for {_STALL_TIMEOUT}s\n\n{tail}"
                if stalled
                else f"gallery-dl exited {returncode}\n\n{tail}"
            )

        _set_status(row_id, status=final_status, error=error, finished_at=now(), **state.fields())
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("gallery-dl worker crashed for row %s", row_id)
        _set_status(
            row_id,
            status=GalleryDownloadStatus.FAILED,
            error=str(exc),
            finished_at=now(),
        )
    finally:
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

    Downloaded files arrive on stdout as bare path lines and skips as `# `-prefixed
    lines (gallery-dl's native PipeOutput) — there is no `error:` stdout event — so
    `last_filename` is the basename of the most recent downloaded-file line. We only
    know that basename, so walk the base dir for a match and remove it. Best effort —
    the row may already be gone by the time the escalation thread runs, so the two
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
    """pip-install the gallery-dl and yt-dlp nightlies into GALLERY_DL_PKG_DIR, atomically.
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
                YTDLP_NIGHTLY_SPEC,
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
    except subprocess.CalledProcessError as e:
        shutil.rmtree(staging, ignore_errors=True)
        tail = (e.stderr or e.stdout or "").strip()[-800:]
        raise RuntimeError(f"pip install failed (exit {e.returncode}): {tail}") from e
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
