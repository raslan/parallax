import json
import os
import sys

import pytest
from pydantic import ValidationError

import app.services.gallery_dl as gallery_dl
from app.database import SessionLocal, init_db
from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus
from app.schemas import GalleryOptions
from app.services.gallery_dl import (
    GALLERY_DL_NIGHTLY_SPEC,
    YTDLP_NIGHTLY_SPEC,
    _ladder,
    _run_gallery_sync,
    build_gallerydl_cmd,
    classify_line,
    deno_url,
    folder_name_from_info,
    install_gallerydl,
    safe_folder_name,
    type_filter_expr,
    ytdl_stop_position,
    ytdlp_args,
    ytdlp_sleep_requests,
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


def test_throttled_rate_must_contain_a_digit():
    for ok in ("", "5", "5.", "0.5", ".5", "100"):
        GalleryOptions(ytThrottledRateValue=ok)
    for bad in (".", "..", "fast", "1.2.3"):
        with pytest.raises(ValidationError):
            GalleryOptions(ytThrottledRateValue=bad)


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
    assert "--print" not in cmd
    assert "output.mode=null" not in cmd
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
    assert classify_line("/media/g/x/001.jpg") == ("file", "/media/g/x/001.jpg")
    assert classify_line("# /media/g/x/002.jpg") == ("skip", "/media/g/x/002.jpg")
    assert classify_line("/media/g/x/003.jpg\n") == ("file", "/media/g/x/003.jpg")
    assert classify_line("") is None
    assert classify_line("\n") is None


def _fake_gallerydl(tmp_path, *, exit_code):
    """Write an executable stand-in for the gallery-dl binary.

    Emits gallery-dl's native PipeOutput format on stdout (a bare path is a
    download, a ``# ``-prefixed path is a skip) plus one ``[error]`` line on
    stderr, so the worker's real parsing path is exercised. ``exit_code`` is the
    process status.
    """
    lines = [
        "#!/bin/sh",
        'echo "/out/a.jpg"',
        'echo "/out/b.jpg"',
        'echo "# /out/c.jpg"',
        'echo "[extractor.foo][error] boom" >&2',
        f"exit {exit_code}",
    ]
    script = tmp_path / "gallery-dl"
    script.write_text("\n".join(lines) + "\n")
    os.chmod(script, 0o755)
    return str(script)


def _drive_worker(tmp_path, monkeypatch, *, exit_code):
    """Point ``_run_gallery_sync`` at the fake binary and run it once.

    The REAL ``build_gallerydl_cmd`` runs here — only ``_gallery_dl_argv_prefix``
    (argv[0]) is faked. This exercises the actual builder output through a real
    ``subprocess.Popen``, covering the stdout-PipeOutput -> counter ->
    terminal-status contract of the worker plus the stderr ``[error]`` count.
    """
    fake = _fake_gallerydl(tmp_path, exit_code=exit_code)
    monkeypatch.setattr(gallery_dl, "_gallery_dl_argv_prefix", lambda: [fake])
    row_id = _seed_gallery_row()
    _run_gallery_sync(row_id, "")
    return row_id


def _seed_gallery_row(url: str = "https://example.com/g/1") -> int:
    init_db()
    with SessionLocal() as s:
        row = GalleryDownload(
            url=url,
            status=GalleryDownloadStatus.PENDING,
            output_dir="/tmp/px-gallery-test",
        )
        s.add(row)
        s.commit()
        return row.id


def test_run_gallery_sync_counts_and_completes(tmp_path, monkeypatch):
    row_id = _drive_worker(tmp_path, monkeypatch, exit_code=0)

    with SessionLocal() as s:
        row = s.get(GalleryDownload, row_id)
        assert row.files_done == 2
        assert row.files_skipped == 1
        assert row.files_failed == 1
        assert row.last_filename == "b.jpg"
        assert json.loads(row.recent_files) == ["a.jpg", "b.jpg"]
        assert row.status == GalleryDownloadStatus.COMPLETED
        assert row.error is None
        assert "boom" in (row.log_tail or "")
        s.delete(row)
        s.commit()


def test_run_gallery_sync_nonzero_exit_fails_with_stderr_tail(tmp_path, monkeypatch):
    row_id = _drive_worker(tmp_path, monkeypatch, exit_code=1)

    with SessionLocal() as s:
        row = s.get(GalleryDownload, row_id)
        assert row.status == GalleryDownloadStatus.FAILED
        assert row.error is not None
        assert "boom" in row.error
        assert "exited 1" in row.error
        assert "boom" in (row.log_tail or "")
        s.delete(row)
        s.commit()


# ── ytdl / generic backends ──────────────────────────────────────────────────


def test_ytdlp_nightly_spec_allows_prereleases_for_ytdlp_only():
    # a `.dev0` bound lets pip pick yt-dlp nightlies without a global --pre
    # (which would also open up pre-release *dependencies*)
    assert YTDLP_NIGHTLY_SPEC.startswith("yt-dlp[default,curl-cffi]>=")
    assert YTDLP_NIGHTLY_SPEC.endswith(".dev0")


def test_install_gallerydl_installs_gallerydl_and_ytdlp_together(tmp_path, monkeypatch):
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        os.makedirs(cmd[cmd.index("--target") + 1])  # pip would create the staging dir

    monkeypatch.setattr(gallery_dl, "GALLERY_DL_DIR", str(tmp_path))
    monkeypatch.setattr(gallery_dl, "GALLERY_DL_PKG_DIR", str(tmp_path / "site"))
    monkeypatch.setattr(gallery_dl.subprocess, "run", fake_run)
    install_gallerydl()

    assert GALLERY_DL_NIGHTLY_SPEC in seen["cmd"]
    assert YTDLP_NIGHTLY_SPEC in seen["cmd"]
    assert "--pre" not in seen["cmd"]
    assert (tmp_path / "site").is_dir()


def test_deno_url_by_arch():
    assert deno_url("x86_64").endswith("deno-x86_64-unknown-linux-gnu.zip")
    assert deno_url("aarch64").endswith("deno-aarch64-unknown-linux-gnu.zip")
    assert deno_url("arm64").endswith("deno-aarch64-unknown-linux-gnu.zip")
    assert deno_url("riscv64") is None


def test_safe_folder_name():
    assert safe_folder_name("Tommy Moran") == "Tommy Moran"
    assert safe_folder_name("AC/DC live") == "AC_DC live"  # never a subfolder
    assert safe_folder_name("a\\b") == "a_b"
    assert safe_folder_name("{title} {x}") == "title x"  # braces would be read as fields
    assert safe_folder_name("a\x00b\nc") == "abc"
    assert safe_folder_name("  spaced  ") == "spaced"
    assert safe_folder_name("x" * 300) == "x" * 120
    for bad in ("", "   ", ".", "..", "...", None):
        assert safe_folder_name(bad) is None


def test_folder_name_from_info():
    playlist = {"_type": "playlist", "id": "PLabc", "channel_id": "UC1", "title": "Clips 2"}
    playlist |= {"channel": "raslan", "uploader": "raslan"}
    assert folder_name_from_info(playlist) == "Clips 2"

    chan = {"_type": "playlist", "id": "@thomasmorana", "channel_id": "UC1"}
    chan |= {"title": "Tommy Moran", "channel": "Tommy Moran"}
    assert folder_name_from_info(chan) == "Tommy Moran"

    # a channel *tab* is titled "<name> - Shorts"; the folder must stay the channel name
    tab = {"_type": "playlist", "id": "UC1", "channel_id": "UC1"}
    tab |= {"title": "Tommy Moran - Shorts", "channel": "Tommy Moran"}
    assert folder_name_from_info(tab) == "Tommy Moran"

    # a single video is foldered under its uploader, not its own title
    video = {"_type": "video", "id": "v1", "title": "Heron", "uploader": "Tommy Moran"}
    assert folder_name_from_info(video) == "Tommy Moran"

    # non-YouTube playlist without a channel: title
    assert folder_name_from_info({"_type": "playlist", "id": "9", "title": "Album"}) == "Album"

    assert folder_name_from_info({}) is None
    assert folder_name_from_info({"_type": "playlist", "title": ".."}) is None


def test_build_cmd_ytdl_backend():
    cmd = build_gallerydl_cmd(
        "https://youtube.com/@x", _opts(), None, backend="ytdl", folder="Chan"
    )
    assert cmd[-1] == "ytdl:https://youtube.com/@x"
    # the ytdl extractor sets `extension` to None, so an extension filter drops every item
    assert "--filter" not in cmd
    assert "extractor.ytdl.generic=false" in cmd
    directory = next(a for a in cmd if a.startswith("extractor.ytdl.directory="))
    assert json.loads(directory.split("=", 1)[1]) == ["{extractor}", "Chan"]
    raw = next(a for a in cmd if a.startswith("extractor.ytdl.raw-options="))
    raw = json.loads(raw.split("=", 1)[1])
    assert raw["ignoreerrors"] is True
    assert raw["js_runtimes"] == {"deno": {"path": gallery_dl.DENO_BIN}}
    # the shared options still apply
    assert "--download-archive" in cmd
    assert cmd[cmd.index("-d") + 1] == "/media/g"


def test_build_cmd_ytdl_folder_fallback_and_stop_after_existing():
    cmd = build_gallerydl_cmd("https://v/1", _opts(stopAfterExisting=1), None, backend="ytdl")
    directory = next(a for a in cmd if a.startswith("extractor.ytdl.directory="))
    assert json.loads(directory.split("=", 1)[1]) == ["{extractor}", "{channel|uploader}"]
    assert cmd[cmd.index("-T") + 1] == "1"


def test_build_cmd_generic_backend_keeps_native_options():
    cmd = build_gallerydl_cmd("https://x.com/p", _opts(), None, backend="generic")
    assert cmd[-1] == "generic:https://x.com/p"
    assert cmd[cmd.index("--filter") + 1].startswith("extension in (")
    assert not any(a.startswith("extractor.ytdl.") for a in cmd)


def test_build_cmd_native_backend_unchanged():
    cmd = build_gallerydl_cmd("https://x.com/g/1", _opts(), None)
    assert cmd[-1] == "https://x.com/g/1"
    assert not any(a.startswith("extractor.ytdl.") for a in cmd)


def test_ladder():
    assert _ladder("https://x.com/g", _opts()) == ["native", "ytdl", "generic"]
    assert _ladder("HTTPS://x.com/g", _opts()) == ["native", "ytdl", "generic"]
    # YouTube has no native extractor — skip straight to ytdl (look-alike hosts don't count)
    assert _ladder("https://www.youtube.com/@x/videos", _opts()) == ["ytdl", "generic"]
    assert _ladder("https://youtu.be/abc", _opts()) == ["ytdl", "generic"]
    assert _ladder("https://notyoutube.com/g", _opts()) == ["native", "ytdl", "generic"]
    # a hand-typed backend prefix runs that backend only
    assert _ladder("ytdl:https://x.com/g", _opts()) == ["ytdl"]
    assert _ladder("generic:https://x.com/g", _opts()) == ["generic"]
    # anything else is the user's own routing / file mode — run as given
    assert _ladder("recursive:https://x.com/g", _opts()) == ["native"]
    assert _ladder("https://x.com/g", _opts(inputMode="file")) == ["native"]


# ── the ladder through the real worker ───────────────────────────────────────


def _fake_ladder_binary(tmp_path, *, native, ytdl=(0, [], []), generic=(0, [], [])):
    """Fake gallery-dl that behaves per backend prefix and logs every invocation.

    Each behaviour is ``(exit_code, stdout_lines, stderr_lines)``. Returns
    ``(binary, call_log_path)``.
    """
    log = tmp_path / "calls.log"

    def branch(name, spec):
        code, out, err = spec
        body = [f"echo {json.dumps(line)}" for line in out]
        body += [f"echo {json.dumps(line)} >&2" for line in err]
        body.append(f"exit {code}")
        return f"  *{name}*) " + "; ".join(body) + " ;;"

    lines = [
        "#!/bin/sh",
        f'echo "$*" >> "{log}"',
        'case "$*" in',
        branch("ytdl:", ytdl),
        branch("generic:", generic),
        branch("", native),
        "esac",
    ]
    script = tmp_path / "gallery-dl"
    script.write_text("\n".join(lines) + "\n")
    os.chmod(script, 0o755)
    return str(script), log


def _drive_ladder(tmp_path, monkeypatch, *, url="https://example.com/g/1", **behaviours):
    fake, log = _fake_ladder_binary(tmp_path, **behaviours)
    monkeypatch.setattr(gallery_dl, "_gallery_dl_argv_prefix", lambda: [fake])
    monkeypatch.setattr(gallery_dl, "ensure_deno", lambda: None)
    monkeypatch.setattr(gallery_dl, "probe_ytdl_folder", lambda url, cookies: "Chan")
    row_id = _seed_gallery_row(url)
    _run_gallery_sync(row_id, "")
    calls = log.read_text().splitlines() if log.exists() else []
    with SessionLocal() as s:
        row = s.get(GalleryDownload, row_id)
        snapshot = {
            "status": row.status,
            "done": row.files_done,
            "skipped": row.files_skipped,
            "failed": row.files_failed,
            "error": row.error,
            "log_tail": row.log_tail or "",
        }
        s.delete(row)
        s.commit()
    return calls, snapshot


UNSUPPORTED = (64, [], ["[gallery-dl][error] Unsupported URL 'x'"])


def test_ladder_falls_through_native_to_ytdl_and_stops_on_success(tmp_path, monkeypatch):
    calls, row = _drive_ladder(
        tmp_path, monkeypatch, native=UNSUPPORTED, ytdl=(0, ["/out/youtube/Chan/a.mkv"], [])
    )
    assert len(calls) == 2
    assert calls[1].endswith("ytdl:https://example.com/g/1")
    assert row["status"] == GalleryDownloadStatus.COMPLETED
    assert row["done"] == 1
    assert "trying ytdl" in row["log_tail"]


def test_ladder_falls_through_to_generic(tmp_path, monkeypatch):
    calls, row = _drive_ladder(
        tmp_path,
        monkeypatch,
        native=UNSUPPORTED,
        ytdl=UNSUPPORTED,
        generic=(0, ["/out/generic/a.jpg"], []),
    )
    assert len(calls) == 3
    assert calls[2].endswith("generic:https://example.com/g/1")
    assert row["status"] == GalleryDownloadStatus.COMPLETED
    assert row["done"] == 1
    assert "trying generic" in row["log_tail"]


def test_ladder_exhausted_fails_with_exit_64(tmp_path, monkeypatch):
    calls, row = _drive_ladder(
        tmp_path, monkeypatch, native=UNSUPPORTED, ytdl=UNSUPPORTED, generic=UNSUPPORTED
    )
    assert len(calls) == 3
    assert row["status"] == GalleryDownloadStatus.FAILED
    assert "exited 64" in row["error"]


def test_ladder_does_not_fall_through_on_real_errors(tmp_path, monkeypatch):
    # exit 4 = the extractor recognised the URL and failed — retrying elsewhere is wrong
    calls, row = _drive_ladder(tmp_path, monkeypatch, native=(4, [], ["[x][error] denied"]))
    assert len(calls) == 1
    assert row["status"] == GalleryDownloadStatus.FAILED


def test_hand_typed_ytdl_prefix_runs_the_ytdl_backend_once(tmp_path, monkeypatch):
    calls, row = _drive_ladder(
        tmp_path,
        monkeypatch,
        url="ytdl:https://example.com/v",
        native=UNSUPPORTED,
        ytdl=(0, ["/out/youtube/Chan/a.mkv"], []),
    )
    assert len(calls) == 1
    assert calls[0].endswith(" ytdl:https://example.com/v")  # prefix not doubled
    assert "--filter" not in calls[0]  # would silently drop every ytdl item
    assert "extractor.ytdl.directory=" in calls[0]
    assert row["status"] == GalleryDownloadStatus.COMPLETED


def test_other_prefixes_run_once_as_given(tmp_path, monkeypatch):
    calls, row = _drive_ladder(
        tmp_path, monkeypatch, url="recursive:https://example.com/v", native=UNSUPPORTED
    )
    assert len(calls) == 1
    assert calls[0].endswith(" recursive:https://example.com/v")
    assert row["status"] == GalleryDownloadStatus.FAILED


def test_ytdl_run_with_only_errors_is_failed_not_completed(tmp_path, monkeypatch):
    # ignoreerrors makes yt-dlp exit 0 even when every entry failed
    err = ["[ytdl][error] ERROR: [youtube] abc: Sign in to confirm you're not a bot"]
    calls, row = _drive_ladder(tmp_path, monkeypatch, native=UNSUPPORTED, ytdl=(0, [], err))
    assert len(calls) == 2
    assert row["status"] == GalleryDownloadStatus.FAILED
    assert row["failed"] == 1
    assert "not a bot" in row["error"]


def test_ytdl_run_with_skips_only_is_completed(tmp_path, monkeypatch):
    # the maintain-a-channel case: everything already archived, terminate after 1 skip
    calls, row = _drive_ladder(
        tmp_path,
        monkeypatch,
        native=UNSUPPORTED,
        ytdl=(0, ["# /out/youtube/Chan/newest"], ["[ytdl][error] ERROR: private video"]),
    )
    assert row["status"] == GalleryDownloadStatus.COMPLETED
    assert row["skipped"] == 1


def test_subprocess_env_pins_caches_into_the_data_volume(monkeypatch):
    # the container user has no home dir, so yt-dlp / gallery-dl would fall back to an
    # unwritable `/.cache` — yt-dlp then re-solves the JS challenge for every video
    want = os.path.join(gallery_dl.GALLERY_DL_DIR, "cache")
    monkeypatch.delenv("XDG_CACHE_HOME", raising=False)
    assert gallery_dl._gallery_dl_env()["XDG_CACHE_HOME"] == want
    monkeypatch.setenv("XDG_CACHE_HOME", "/somewhere/else")
    assert gallery_dl._gallery_dl_env()["XDG_CACHE_HOME"] == want


def test_ytdl_backend_passes_cmdline_args_but_native_does_not():
    ytdl = build_gallerydl_cmd("https://youtube.com/@x", _opts(), None, backend="ytdl")
    assert any(a.startswith("extractor.ytdl.cmdline-args=") for a in ytdl)
    native = build_gallerydl_cmd("https://x.com/g/1", _opts(), None)
    assert not any("extractor.ytdl" in a for a in native)


def test_ytdlp_args_defaults_match_downloads_selector():
    args = ytdlp_args(_opts(), "https://youtube.com/@x")
    assert args[args.index("-f") + 1] == "bestvideo+bestaudio/best"
    assert args[args.index("--merge-output-format") + 1] == "mkv"
    assert args[args.index("--concurrent-fragments") + 1] == "4"
    assert "--embed-metadata" in args and "--embed-chapters" in args
    # gallery-dl drops its own retry/timeout defaults when cmdline-args is set
    assert "--retries" in args and "--socket-timeout" in args
    for absent in ("-x", "--write-subs", "--impersonate", "--referer", "--throttled-rate"):
        assert absent not in args


def test_ytdlp_args_quality_codec_and_audio_only():
    args = ytdlp_args(_opts(ytQuality="1080", ytCodec="hevc"), "u")
    # cap is a short-side sort (`res`), never a height filter — vertical videos would break
    assert "height" not in args[args.index("-f") + 1]
    assert args[args.index("-S") + 1] == "res:1080"
    assert args[args.index("--merge-output-format") + 1] == "mp4"
    assert "-S" not in ytdlp_args(_opts(), "u")  # "best" = no cap
    assert "-S" not in ytdlp_args(_opts(ytAudioOnly=True, ytQuality="720"), "u")
    audio = ytdlp_args(_opts(ytAudioOnly=True, ytCodec="opus"), "u")
    assert audio[audio.index("--audio-format") + 1] == "opus"
    assert "-f" not in audio
    # a video codec left over from video mode falls back to mp3
    assert ytdlp_args(_opts(ytAudioOnly=True, ytCodec="av1"), "u").count("mp3") == 1


def test_ytdlp_args_subs_impersonate_referer_throttle_and_extra():
    url = "https://www.youtube.com/watch?v=1"
    args = ytdlp_args(
        _opts(
            ytDownloadSubs=True,
            ytSubLangs="en,fr",
            ytImpersonate="chrome",
            ytRefererMode="site",
            ytThrottledRateValue="100",
            ytThrottledRateUnit="K",
            ytExtraArgs="--no-mtime --sleep-interval 2",
        ),
        url,
    )
    assert args[args.index("--sub-langs") + 1] == "en,fr"
    assert "--write-auto-subs" in args
    assert args[args.index("--impersonate") + 1] == "chrome"
    assert args[args.index("--referer") + 1] == "https://www.youtube.com/"
    assert args[args.index("--throttled-rate") + 1] == "100K"
    assert args[-3:] == ["--no-mtime", "--sleep-interval", "2"]
    assert ytdlp_args(_opts(ytRefererMode="url"), url)[-1] == url
    custom = ytdlp_args(_opts(ytRefererMode="custom", ytReferer="https://r/"), url)
    assert custom[custom.index("--referer") + 1] == "https://r/"


def test_ytdlp_args_use_their_own_archive_only_when_the_archive_is_on():
    on = ytdlp_args(_opts(archivePath="/d/a.sqlite3"), "u")
    assert on[on.index("--download-archive") + 1] == "/d/a.sqlite3.yt-dlp.txt"
    assert "--download-archive" not in ytdlp_args(_opts(useArchive=False), "u")


def test_ytdlp_sleep_requests_translates_gallery_dl_format():
    assert ytdlp_sleep_requests("2.5") == "2.5"
    assert ytdlp_sleep_requests("3") == "3"
    assert ytdlp_sleep_requests("0.5-1.5") == "1.5"  # yt-dlp has no range: use the upper bound
    for bad in ("", "  ", "abc", "0", "1-x"):
        assert ytdlp_sleep_requests(bad) is None
    args = ytdlp_args(_opts(sleepRequest="2.5"), "u")
    assert args[args.index("--sleep-requests") + 1] == "2.5"
    assert "--sleep-requests" not in ytdlp_args(_opts(), "u")


def test_ytdlp_args_playlist_end():
    args = ytdlp_args(_opts(), "u", playlist_end=7)
    assert args[args.index("--playlist-end") + 1] == "7"
    assert "--playlist-end" not in ytdlp_args(_opts(), "u")


class _FakeProc:
    def __init__(self, lines):
        self.stdout = iter(lines)

    def kill(self):
        pass

    def wait(self):
        pass


def _stop_position(monkeypatch, tmp_path, listing, archived, stop_after):
    archive = tmp_path / "yt.txt"
    archive.write_text("".join(f"youtube {i}\n" for i in archived))
    monkeypatch.setattr(
        gallery_dl.subprocess,
        "Popen",
        lambda *a, **k: _FakeProc([f"Youtube {i}\n" for i in listing]),
    )
    return ytdl_stop_position("u", None, stop_after, str(archive))


def test_ytdl_stop_position_is_the_nth_consecutive_archived_entry(monkeypatch, tmp_path):
    # two new videos, then the archive begins: stop 2 archived in a row -> position 4
    assert _stop_position(monkeypatch, tmp_path, ["n1", "n2", "a", "b", "c"], "abc", 2) == 4
    assert _stop_position(monkeypatch, tmp_path, ["n1", "n2", "a", "b", "c"], "abc", 1) == 3


def test_ytdl_stop_position_a_new_entry_resets_the_streak(monkeypatch, tmp_path):
    # a(arch) n(new) b(arch) c(arch): the streak of 2 only completes at position 4
    assert _stop_position(monkeypatch, tmp_path, ["a", "n", "b", "c"], "abc", 2) == 4


def test_ytdl_stop_position_ids_are_case_sensitive_and_extractor_key_is_not(monkeypatch, tmp_path):
    # real YouTube ids mix case; only the "Youtube" key is lowercased in the archive
    assert _stop_position(monkeypatch, tmp_path, ["_d0vSZxixBE", "x"], ["_d0vSZxixBE"], 1) == 1
    assert _stop_position(monkeypatch, tmp_path, ["_d0vSZxixBE"], ["_d0vszxixbe"], 1) is None


def test_ytdl_stop_position_never_reached_or_no_archive(monkeypatch, tmp_path):
    assert _stop_position(monkeypatch, tmp_path, ["n1", "a", "n2"], "a", 2) is None
    assert ytdl_stop_position("u", None, 2, str(tmp_path / "missing.txt")) is None
