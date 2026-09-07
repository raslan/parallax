"""gallery-dl download service — self-contained, no imports from downloader.py.

Shared mechanism (semaphore, binary install/probe, cookies tempfile,
ProcessGroup) comes from download_common.
"""

import logging
import os
import shlex

from app.config import GALLERY_DL_DIR
from app.schemas import GalleryOptions
from app.services.download_common import resolve_binary

logger = logging.getLogger(__name__)

GALLERY_DL_BIN = os.path.join(GALLERY_DL_DIR, "gallery-dl")
URLS_FILE = os.path.join(GALLERY_DL_DIR, "urls.txt")
DEFAULT_ARCHIVE = os.path.join(GALLERY_DL_DIR, "archive.sqlite3")
NIGHTLY_URL = "https://github.com/gdl-org/builds/releases/latest/download/gallery-dl_linux"

SENTINEL_FILE = "\x00PXF\x00"
SENTINEL_SKIP = "\x00PXS\x00"
SENTINEL_ERROR = "\x00PXE\x00"

EXT_SETS: dict[str, tuple[str, ...]] = {
    "video": ("mp4", "mkv", "m4v", "webm", "mov", "avi", "wmv", "flv", "mpg", "mpeg", "3gp", "ts"),
    "audio": ("mp3", "m4a", "aac", "flac", "ogg", "opus", "wav", "wma"),
    "image": ("jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "heic", "heif", "tiff", "svg"),
}


def gallery_dl_bin() -> str:
    return resolve_binary(GALLERY_DL_BIN, "gallery-dl") or "gallery-dl"


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
        gallery_dl_bin(),
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
