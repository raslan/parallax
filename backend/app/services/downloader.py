"""yt-dlp download service.

Manages yt-dlp subprocesses for downloading videos.  All blocking I/O
runs in a thread via asyncio.to_thread so the FastAPI event loop stays
responsive.
"""

import asyncio
import json
import os
import re
import shlex
import subprocess
import threading
import urllib.request
from typing import Optional

from app.config import DATA_DIR
from app.database import SessionLocal
from app.models.download import Download, DownloadStatus
from app.services.common import now

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_active_procs: dict[int, subprocess.Popen] = {}  # download_id → process
_active_procs_lock = threading.Lock()
_cancelled_ids: set[int] = set()
_download_semaphore: Optional[asyncio.Semaphore] = None
_semaphore_limit: int = 0

# ---------------------------------------------------------------------------
# yt-dlp management
# ---------------------------------------------------------------------------


def _ytdlp_bin() -> str | None:
    """Return path to yt-dlp binary: data-volume location first, then PATH fallback."""
    if os.path.isfile(_YTDLP_BIN) and os.access(_YTDLP_BIN, os.X_OK):
        return _YTDLP_BIN
    import shutil
    return shutil.which("yt-dlp")


def get_ytdlp_info() -> dict:
    """Return {"installed": bool, "version": str | None, "path": str | None}."""
    path = _ytdlp_bin()
    if path is None:
        return {"installed": False, "version": None, "path": None}
    try:
        result = subprocess.run(
            [path, "--version"],
            capture_output=True, text=True, timeout=10,
        )
        version = result.stdout.strip() if result.returncode == 0 else None
        return {"installed": True, "version": version, "path": path}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"installed": False, "version": None, "path": None}


_YTDLP_BIN = os.path.join(DATA_DIR, "yt-dlp")  # stored in data volume, writable by container user
_YTDLP_URLS = {
    "stable":  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
    "nightly": "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux",
}


def install_ytdlp(channel: str = "stable") -> None:
    """Download latest yt-dlp standalone binary from GitHub releases.

    The binary bundles all dependencies including curl-cffi.
    Blocking — callers must wrap in asyncio.to_thread if called from async context.
    """
    url = _YTDLP_URLS.get(channel, _YTDLP_URLS["stable"])
    tmp = _YTDLP_BIN + ".tmp"
    try:
        urllib.request.urlretrieve(url, tmp)
        os.chmod(tmp, 0o755)
        os.replace(tmp, _YTDLP_BIN)  # atomic replace
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


# ---------------------------------------------------------------------------
# Command builder
# ---------------------------------------------------------------------------


_CODEC_VCODEC: dict[str, str] = {
    "h264": "avc",
    "hevc": "hev",   # matches hev1, hevc; hvc1 handled via fallback
    "av1":  "av01",
    "vp9":  "vp9",
}
_CODEC_CONTAINER: dict[str, str] = {
    "h264": "mp4",
    "hevc": "mp4",
    "av1":  "webm",
    "vp9":  "webm",
    "auto": "mkv",
}
_AUDIO_CONTAINERS = {"mp3", "m4a", "opus", "flac", "wav"}


def _format_selector(quality: str, codec: str) -> tuple[str, str]:
    """Return (format_string, merge_container) for a quality+codec combination."""
    h = f"[height<={quality}]" if quality != "best" else ""
    vc = _CODEC_VCODEC.get(codec, "")
    container = _CODEC_CONTAINER.get(codec, "mkv")

    # Fallback chain priority: preferred codec → any codec (quality preserved) → combined stream
    # This ensures quality is never sacrificed — codec degrades gracefully instead.
    any_at_quality = f"bestvideo{h}+bestaudio"  # no codec filter, respects height limit
    combined = f"best{h}"                        # last resort: pre-muxed stream

    if not vc:  # auto
        fmt = f"{any_at_quality}/{combined}"
    elif codec == "hevc":
        # HEVC streams tagged as hev1/hevc or hvc1 — try both naming conventions
        fmt = (
            f"bestvideo{h}[vcodec*={vc}]+bestaudio"
            f"/bestvideo{h}[vcodec*=hvc]+bestaudio"
            f"/{any_at_quality}/{combined}"
        )
    else:
        fmt = f"bestvideo{h}[vcodec*={vc}]+bestaudio/{any_at_quality}/{combined}"

    return fmt, container


def build_ytdlp_cmd(url: str, output_dir: str, options: dict) -> list[str]:
    """Build yt-dlp command list from options dict.

    options keys (all optional):
      audio_only: bool
      quality: "best"|"2160"|"1440"|"1080"|"720"|"480"|"360"
      codec: "auto"|"h264"|"hevc"|"av1"|"vp9" (video) or audio container for audio_only
      trim_start: "00:01:30"
      trim_end: "00:05:00"
      download_subs: bool
      sub_langs: "en,fr"
      extra_args: str
      impersonate: str
      cookies_file: str — path to temp cookies file (caller manages lifecycle)
    """
    audio_only: bool = bool(options.get("audio_only", False))
    quality: str = options.get("quality", "best") or "best"
    codec: str = options.get("codec", "auto") or "auto"
    trim_start: Optional[str] = options.get("trim_start") or None
    trim_end: Optional[str] = options.get("trim_end") or None
    download_subs: bool = bool(options.get("download_subs", False))
    sub_langs: str = options.get("sub_langs") or "en"
    extra_args_str: str = options.get("extra_args") or ""
    impersonate: Optional[str] = options.get("impersonate") or None
    cookies_file: Optional[str] = options.get("cookies_file") or None

    cmd: list[str] = [_ytdlp_bin() or "yt-dlp"]

    # Always-on flags
    cmd += ["--progress", "--newline", "--no-warnings"]

    # Output template
    cmd += ["-o", f"{output_dir}/%(title)s.%(ext)s"]

    # Format / quality selection
    if audio_only:
        # codec field reused as audio container when audio_only=True
        audio_fmt = codec if codec in _AUDIO_CONTAINERS else "mp3"
        cmd += ["-x", "--audio-format", audio_fmt]
    else:
        fmt, container = _format_selector(quality, codec)
        cmd += ["-f", fmt, "--merge-output-format", container]

    # Trim / sections
    if trim_start or trim_end:
        start = trim_start or "0"
        end = trim_end or "inf"
        cmd += ["--download-sections", f"*{start}-{end}", "--force-keyframes-at-cuts"]

    # Subtitles
    if download_subs:
        cmd += ["--write-subs", "--write-auto-subs", "--sub-langs", sub_langs]

    # Cookies
    if cookies_file and os.path.isfile(cookies_file):
        cmd += ["--cookies", cookies_file]

    # Impersonation
    if impersonate:
        cmd += ["--impersonate", impersonate]

    # Extra user-supplied arguments
    if extra_args_str.strip():
        try:
            cmd += shlex.split(extra_args_str)
        except ValueError:
            cmd.append(extra_args_str)

    cmd.append(url)
    return cmd


def list_impersonate_targets() -> list[str]:
    """Return available impersonate target names from the installed yt-dlp binary.

    Blocking — callers must wrap in asyncio.to_thread if called from async context.
    """
    bin_path = _ytdlp_bin()
    if not bin_path:
        return []
    try:
        result = subprocess.run(
            [bin_path, "--list-impersonate-targets"],
            capture_output=True, text=True, timeout=15,
        )
        targets = []
        for line in result.stdout.splitlines():
            # Each line: "  chrome-131      curl_cffi"
            stripped = line.strip()
            if not stripped or stripped.startswith("Available") or stripped.startswith("Target") or set(stripped) <= {"-", "─"}:
                continue
            target = stripped.split()[0]
            targets.append(target)
        return targets
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Semaphore helper
# ---------------------------------------------------------------------------


def get_semaphore(max_concurrent: int) -> asyncio.Semaphore:
    """Return the module-level download semaphore, creating it once on first call.

    The initial limit is used for the life of the process — settings changes
    take effect on next restart.
    """
    global _download_semaphore, _semaphore_limit
    if _download_semaphore is None:
        _download_semaphore = asyncio.Semaphore(max_concurrent)
        _semaphore_limit = max_concurrent
    return _download_semaphore


# ---------------------------------------------------------------------------
# Progress parsing helpers
# ---------------------------------------------------------------------------

_PROGRESS_RE = re.compile(
    r"\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)"
)
_DESTINATION_RE = re.compile(r"\[download\] Destination: (.+)$")
_MERGER_RE = re.compile(r'Merging formats into "(.+)"')


def _parse_progress(line: str) -> Optional[tuple[float, str, str]]:
    """Return (pct, speed, eta) if line is a yt-dlp progress line, else None."""
    m = _PROGRESS_RE.search(line)
    if m:
        return float(m.group(1)), m.group(2), m.group(3)
    return None


def _parse_output_path(line: str) -> Optional[str]:
    """Return output file path from destination/merger lines, else None."""
    m = _DESTINATION_RE.search(line)
    if m:
        return m.group(1).strip()
    m = _MERGER_RE.search(line)
    if m:
        return m.group(1).strip()
    return None


# ---------------------------------------------------------------------------
# Part-file cleanup
# ---------------------------------------------------------------------------

def _cleanup_part_files(output_dir: str, title: str | None = None) -> None:
    """Delete yt-dlp temp files (.part, .ytdl) belonging to this download."""
    import unicodedata
    print(f"[cleanup] output_dir={output_dir!r} title={title!r}", flush=True)
    print(f"[cleanup] dir_exists={os.path.isdir(output_dir) if output_dir else False}", flush=True)
    if not output_dir or not os.path.isdir(output_dir):
        return
    if title:
        prefix = unicodedata.normalize("NFC", title).replace("/", "_").replace("\x00", "").strip()
    else:
        prefix = None
    try:
        all_files = os.listdir(output_dir)
        print(f"[cleanup] files_in_dir={all_files}", flush=True)
        for fname in all_files:
            if not (fname.endswith(".part") or fname.endswith(".ytdl")):
                continue
            if prefix:
                norm_fname = unicodedata.normalize("NFC", fname)
                rest = norm_fname[len(prefix):]
                print(f"[cleanup] candidate={fname!r} rest={rest!r}", flush=True)
                if not (rest.startswith(".") or rest.startswith(" [")):
                    print(f"[cleanup] SKIP {fname!r} (no match)", flush=True)
                    continue
            print(f"[cleanup] DELETE {fname!r}", flush=True)
            try:
                os.remove(os.path.join(output_dir, fname))
            except OSError as e:
                print(f"[cleanup] ERROR deleting {fname!r}: {e}", flush=True)
    except OSError as e:
        print(f"[cleanup] listdir error: {e}", flush=True)


# ---------------------------------------------------------------------------
# Blocking download worker (runs in thread)
# ---------------------------------------------------------------------------


def _run_download_sync(download_id: int) -> None:
    """Blocking download worker. Intended to be called via asyncio.to_thread."""
    download: Optional["Download"] = None
    cookies_tmp: Optional[str] = None
    db = SessionLocal()
    try:
        download = db.get(Download, download_id)
        if download is None:
            return

        # Mark running
        download.status = DownloadStatus.RUNNING
        download.started_at = now()
        db.commit()

        # Prefetch metadata (best-effort — don't fail if this errors)
        try:
            meta_result = subprocess.run(
                [_ytdlp_bin() or "yt-dlp", "--dump-json", "--no-playlist", download.url],
                capture_output=True, text=True, timeout=30
            )
            if meta_result.returncode == 0 and meta_result.stdout.strip():
                import json as _json
                meta = _json.loads(meta_result.stdout.strip().splitlines()[0])
                download.title = meta.get("title") or meta.get("fulltitle")
                download.uploader = meta.get("uploader") or meta.get("channel")
                download.thumbnail_url = meta.get("thumbnail")
                download.duration = meta.get("duration")
                db.commit()
        except Exception:
            pass  # metadata prefetch failure is non-fatal

        # Build command — write cookies to temp file if provided
        options = json.loads(download.options or "{}")
        raw_cookies: str = options.pop("cookies", "") or ""
        if raw_cookies.strip():
            import tempfile
            fd, cookies_tmp = tempfile.mkstemp(prefix="parallax_cookies_", suffix=".txt")
            try:
                with os.fdopen(fd, "w") as f:
                    f.write(raw_cookies)
            except Exception:
                cookies_tmp = None
            else:
                options["cookies_file"] = cookies_tmp

        try:
            cmd = build_ytdlp_cmd(download.url, download.output_dir, options)
        except Exception as exc:
            download.status = DownloadStatus.FAILED
            download.error = f"Failed to build yt-dlp command: {exc}"
            download.finished_at = now()
            db.commit()
            return

        # Start subprocess
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
        except FileNotFoundError:
            download.status = DownloadStatus.FAILED
            download.error = "yt-dlp not found. Go to Settings → Downloads and click Install."
            download.finished_at = now()
            db.commit()
            return

        with _active_procs_lock:
            _active_procs[download_id] = proc

        last_pct: float = -1.0
        output_path: Optional[str] = None
        output_lines: list[str] = []

        try:
            if proc.stdout is None:
                raise RuntimeError("subprocess stdout is None")
            for line in iter(proc.stdout.readline, ""):
                line = line.rstrip("\n")
                output_lines.append(line)

                # Try to extract output path
                detected_path = _parse_output_path(line)
                if detected_path:
                    output_path = detected_path

                # Parse progress
                parsed = _parse_progress(line)
                if parsed:
                    pct, speed, eta = parsed
                    # Only commit when progress advances by ≥1 %
                    if pct - last_pct >= 1.0:
                        download.progress = pct
                        download.speed = speed
                        download.eta = eta
                        db.commit()
                        last_pct = pct

            proc.wait()

        finally:
            with _active_procs_lock:
                _active_procs.pop(download_id, None)

        # Determine final status
        ytdlp_version = get_ytdlp_info().get("version") or "unknown"
        if proc.returncode == 0:
            download.status = DownloadStatus.COMPLETED
            download.progress = 100.0
            download.finished_at = now()
            if output_path:
                download.output_path = output_path
        elif download_id in _cancelled_ids:
            _cancelled_ids.discard(download_id)
            download.status = DownloadStatus.CANCELLED
            download.finished_at = now()
            # Clean up partial files left by yt-dlp after cancellation
            _cleanup_part_files(download.output_dir, download.title)
        else:
            tail = "\n".join(line for line in output_lines[-20:] if line.strip())
            download.status = DownloadStatus.FAILED
            download.error = f"[yt-dlp {ytdlp_version}] exited with code {proc.returncode}\n\n{tail}"
            download.finished_at = now()

        db.commit()

    except Exception as exc:
        if download is not None:
            try:
                download.status = DownloadStatus.FAILED
                download.error = str(exc)
                download.finished_at = now()
                db.commit()
            except Exception:
                pass
    finally:
        db.close()
        if cookies_tmp and os.path.exists(cookies_tmp):
            try:
                os.remove(cookies_tmp)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Async entry point
# ---------------------------------------------------------------------------


async def run_download(download_id: int, max_concurrent: int = 2) -> None:
    """Main download coroutine. Acquire semaphore then run blocking worker in thread."""
    sem = get_semaphore(max_concurrent)
    async with sem:
        await asyncio.to_thread(_run_download_sync, download_id)


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def cancel_download(download_id: int) -> bool:
    """Kill active subprocess. Return True if killed, False if not found."""
    with _active_procs_lock:
        proc = _active_procs.get(download_id)
        if proc:
            _cancelled_ids.add(download_id)
            proc.kill()
            return True
    return False
