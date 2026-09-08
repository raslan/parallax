import json
import os
import shlex
import sys

import app.services.gallery_dl as gallery_dl
from app.database import SessionLocal, init_db
from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus
from app.schemas import GalleryOptions
from app.services.gallery_dl import (
    GALLERY_DL_NIGHTLY_SPEC,
    SENTINEL_ERROR,
    SENTINEL_FILE,
    SENTINEL_SKIP,
    _run_gallery_sync,
    build_gallerydl_cmd,
    classify_line,
    type_filter_expr,
)


def test_nightly_spec_is_git_free():
    # git binary is absent from all three base images — nightly must fetch a plain
    # HTTPS tarball, never a git+ VCS URL.
    assert GALLERY_DL_NIGHTLY_SPEC.startswith("gallery-dl @ https://")
    assert "git+" not in GALLERY_DL_NIGHTLY_SPEC


def test_gallery_options_defaults():
    o = GalleryOptions()
    assert o.baseDir == ""
    assert o.maxParallel == 2
    assert o.retries == 3
    assert o.httpTimeout == 30
    assert o.typeVideo is True
    assert o.typeAudio is False
    assert o.typeAny is False
    assert o.maxSizeValue is None
    assert o.maxSizeUnit == "M"
    assert o.useArchive is True
    assert o.inputMode == "paste"


def test_gallery_options_parses_partial_blob():
    o = GalleryOptions.model_validate({"baseDir": "/media/g", "retries": 5, "typeImage": True})
    assert o.baseDir == "/media/g"
    assert o.retries == 5
    assert o.typeImage is True
    assert o.typeVideo is True  # untouched default
    assert json.loads(o.model_dump_json())["maxParallel"] == 2


def _opts(**kw):
    return GalleryOptions(baseDir="/media/g", **kw)


def test_type_filter_union_and_any():
    assert type_filter_expr(_opts(typeVideo=True, typeAudio=False, typeImage=True)) == (
        "extension in ('mp4','mkv','m4v','webm','mov','avi','wmv','flv','mpg','mpeg','3gp','ts',"
        "'jpg','jpeg','png','gif','webp','bmp','avif','heic','heif','tiff','svg')"
    )
    assert type_filter_expr(_opts(typeAny=True, typeVideo=True)) is None
    assert type_filter_expr(_opts(typeVideo=False, typeAudio=False, typeImage=False)) is None


def test_build_cmd_core_and_conditionals():
    opts = _opts(
        retries=5,
        httpTimeout=45,
        maxSizeValue=3,
        maxSizeUnit="G",
        stopAfterExisting=10,
        useArchive=True,
        range="30-50",
        browser="chrome:windows",
        userAgent="UA/1.0",
        limitRate="1M",
        sleepRequest="0.5-1.5",
        filenameTemplate="{id}.{extension}",
        extraArgs="--verbose",
    )
    cmd = build_gallerydl_cmd("https://x.com/g/1", opts, "/tmp/c.txt")

    assert cmd[:3] == [sys.executable, "-m", "gallery_dl"]
    assert "--no-part" in cmd
    assert "--no-colors" in cmd
    assert cmd[cmd.index("-o") + 1] == "output.mode=null"
    assert f"file:{SENTINEL_FILE}{{_path}}" in cmd
    assert cmd[cmd.index("--retries") + 1] == "5"
    assert cmd[cmd.index("-d") + 1] == "/media/g"
    assert "downloader.http.timeout=45" in cmd
    assert cmd[cmd.index("--filter") + 1].startswith("extension in (")
    assert cmd[cmd.index("--filesize-max") + 1] == "3G"
    assert cmd[cmd.index("-T") + 1] == "10"
    assert "--download-archive" in cmd
    assert cmd[cmd.index("--range") + 1] == "30-50"
    assert "extractor.*.browser=chrome:windows" in cmd
    assert cmd[cmd.index("--user-agent") + 1] == "UA/1.0"
    assert cmd[cmd.index("--limit-rate") + 1] == "1M"
    assert cmd[cmd.index("--sleep-request") + 1] == "0.5-1.5"
    assert cmd[cmd.index("--filename") + 1] == "{id}.{extension}"
    assert cmd[cmd.index("--cookies") + 1] == "/tmp/c.txt"
    assert "--verbose" in cmd
    assert cmd[-1] == "https://x.com/g/1"
    assert "\x00" not in "".join(cmd)  # NUL in any argv element crashes subprocess.Popen


def test_build_cmd_file_mode_uses_input_file():
    cmd = build_gallerydl_cmd("ignored", _opts(inputMode="file"), None)
    assert cmd[-2] == "-i"
    assert cmd[-1].endswith("urls.txt")
    assert "--cookies" not in cmd


def test_build_cmd_omits_disabled_conditionals():
    cmd = build_gallerydl_cmd("https://x.com/g/1", _opts(useArchive=False, typeAny=True), None)
    assert "--filter" not in cmd
    assert "--filesize-max" not in cmd
    assert "--download-archive" not in cmd
    assert "-T" not in cmd
    assert "--range" not in cmd


def test_build_cmd_bad_extra_args_falls_back_to_raw():
    cmd = build_gallerydl_cmd("https://x.com/g/1", _opts(extraArgs='--foo "unbalanced'), None)
    assert '--foo "unbalanced' in cmd


def test_redacted_argv_masks_cookies_value():
    from app.services.gallery_dl import _redacted_argv

    assert _redacted_argv(["gallery-dl", "--cookies", "/tmp/parallax_cookies_x.txt", "url"]) == [
        "gallery-dl",
        "--cookies",
        "***",
        "url",
    ]
    # no --cookies → unchanged
    assert _redacted_argv(["gallery-dl", "-d", "/x", "url"]) == ["gallery-dl", "-d", "/x", "url"]
    # --cookies as the last arg (defensive)
    assert _redacted_argv(["gallery-dl", "--cookies"]) == ["gallery-dl", "--cookies"]


def test_classify_line():
    assert classify_line(f"{SENTINEL_FILE}/media/g/x/001.jpg") == ("file", "/media/g/x/001.jpg")
    assert classify_line(f"{SENTINEL_SKIP}/media/g/x/002.jpg") == ("skip", "/media/g/x/002.jpg")
    assert classify_line(f"{SENTINEL_ERROR}/media/g/x/003.jpg") == ("error", "/media/g/x/003.jpg")
    assert classify_line("[extractor] some noise") is None
    assert classify_line("") is None


def _fake_gallerydl(tmp_path, *, emit, exit_code):
    """Write an executable stand-in for the gallery-dl binary.

    ``emit`` is a list of ``(sentinel, path)`` tuples echoed to stdout the way
    the worker's ``--print`` hooks would; ``exit_code`` is the process status.
    A line of stderr noise is always written so the FAILED path has a tail.
    The sentinel's control byte (ASCII 31) is reproduced verbatim via ``printf``
    octal escapes so ``classify_line`` sees exactly what it would in production.
    """
    lines = ["#!/bin/sh"]
    for sentinel, path in emit:
        octal = sentinel.replace("\x1f", "\\037")
        lines.append(f"printf '{octal}%s\\n' {shlex.quote(path)}")
        lines.append("sleep 0.02")
    lines.append("echo 'some stderr noise: boom' >&2")
    lines.append(f"exit {exit_code}")
    script = tmp_path / "gallery-dl"
    script.write_text("\n".join(lines) + "\n")
    os.chmod(script, 0o755)
    return str(script)


def _drive_worker(tmp_path, monkeypatch, *, emit, exit_code):
    """Point ``_run_gallery_sync`` at the fake binary and run it once.

    The REAL ``build_gallerydl_cmd`` runs here — only ``_gallery_dl_argv_prefix``
    (argv[0]) is faked. This exercises the actual builder output through a real
    ``subprocess.Popen``, so a reintroduced NUL sentinel would make Popen raise
    and fail this test, on top of covering the stdout-sentinel -> counter ->
    terminal-status contract of the worker.
    """
    fake = _fake_gallerydl(tmp_path, emit=emit, exit_code=exit_code)
    monkeypatch.setattr(gallery_dl, "_gallery_dl_argv_prefix", lambda: [fake])
    row_id = _seed_gallery_row()
    _run_gallery_sync(row_id, "")
    return row_id


def _seed_gallery_row() -> int:
    init_db()
    with SessionLocal() as s:
        row = GalleryDownload(
            url="https://example.com/g/1",
            status=GalleryDownloadStatus.PENDING,
            output_dir="/tmp/px-gallery-test",
        )
        s.add(row)
        s.commit()
        return row.id


def test_run_gallery_sync_counts_and_completes(tmp_path, monkeypatch):
    row_id = _drive_worker(
        tmp_path,
        monkeypatch,
        emit=[
            (SENTINEL_FILE, "/out/a.jpg"),
            (SENTINEL_FILE, "/out/b.jpg"),
            (SENTINEL_SKIP, "/out/c.jpg"),
            (SENTINEL_ERROR, "/out/d.jpg"),
        ],
        exit_code=0,
    )

    with SessionLocal() as s:
        row = s.get(GalleryDownload, row_id)
        assert row.files_done == 2
        assert row.files_skipped == 1
        assert row.files_failed == 1
        assert row.last_filename == "b.jpg"
        assert json.loads(row.recent_files) == ["a.jpg", "b.jpg"]
        assert row.status == GalleryDownloadStatus.COMPLETED
        assert row.error is None
        s.delete(row)
        s.commit()


def test_run_gallery_sync_nonzero_exit_fails_with_stderr_tail(tmp_path, monkeypatch):
    row_id = _drive_worker(
        tmp_path,
        monkeypatch,
        emit=[(SENTINEL_FILE, "/out/a.jpg")],
        exit_code=1,
    )

    with SessionLocal() as s:
        row = s.get(GalleryDownload, row_id)
        assert row.status == GalleryDownloadStatus.FAILED
        assert row.error is not None
        assert "boom" in row.error
        assert "exited 1" in row.error
        s.delete(row)
        s.commit()
