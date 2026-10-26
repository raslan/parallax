import asyncio
import os
import signal
import subprocess
import sys

import pytest

from app.services.download_common import (
    ProcessGroup,
    ResizableSemaphore,
    cookies_to_tempfile,
    resolve_binary,
)


def test_resizable_semaphore_grows_and_shrinks():
    async def run():
        sem = ResizableSemaphore(1)
        await sem.__aenter__()  # take the only permit
        sem.resize(3)  # +2 permits released immediately
        await asyncio.wait_for(sem.__aenter__(), timeout=0.1)
        await asyncio.wait_for(sem.__aenter__(), timeout=0.1)
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(sem.__aenter__(), timeout=0.1)
        await sem.__aexit__()
        await sem.__aexit__()
        await sem.__aexit__()
        sem.resize(1)  # shrink; 2 permits become pending
        await asyncio.wait_for(sem.__aenter__(), timeout=0.1)
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(sem.__aenter__(), timeout=0.1)

    asyncio.run(run())


def test_cookies_to_tempfile_roundtrip_and_blank():
    assert cookies_to_tempfile("") is None
    assert cookies_to_tempfile("   \n  ") is None
    path = cookies_to_tempfile("# Netscape HTTP Cookie File\n.x.com\tTRUE\t/\tTRUE\t0\ta\tb\n")
    try:
        assert path is not None and os.path.isfile(path)
        assert ".x.com" in open(path).read()
    finally:
        os.remove(path)


def test_resolve_binary_prefers_dest_then_path(tmp_path):
    missing = tmp_path / "nope"
    assert resolve_binary(str(missing), "definitely-not-a-real-bin-xyz") is None
    real = tmp_path / "mybin"
    real.write_text("#!/bin/sh\necho hi\n")
    os.chmod(real, 0o755)
    assert resolve_binary(str(real), "whatever") == str(real)


def test_process_group_cancel_sends_signal_then_escalates():
    pg = ProcessGroup()
    code = (
        "import signal, sys, time; "
        "signal.signal(signal.SIGINT, signal.SIG_IGN); "
        "sys.stdout.write('ready\\n'); sys.stdout.flush(); "
        "time.sleep(30)"
    )
    proc = subprocess.Popen(
        [sys.executable, "-c", code],
        stdout=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    assert proc.stdout.readline() == "ready\n"
    pg.register(1, proc)
    escalated = []
    assert (
        pg.cancel(
            1,
            sig=signal.SIGINT,
            escalate_after=0.5,
            on_escalated=escalated.append,
        )
        is True
    )
    proc.wait(timeout=5)
    assert proc.returncode is not None
    assert escalated == [1]
    pg.unregister(1)
    assert pg.is_cancelled(1) is True
    pg.discard(1)
    assert pg.is_cancelled(1) is False


def test_process_group_cancel_no_process_returns_false():
    pg = ProcessGroup()
    assert pg.cancel(99) is False
    assert pg.is_cancel_requested(99) is True
    pg.clear_cancel_requested(99)
    assert pg.is_cancel_requested(99) is False


def _output_template(cmd: list[str]) -> str:
    return cmd[cmd.index("-o") + 1]


def test_build_ytdlp_cmd_group_by_uploader_toggles_dir_segment():
    from app.services.downloader import build_ytdlp_cmd

    plain = build_ytdlp_cmd("http://x/v", "/out", {})
    assert _output_template(plain) == "/out/%(title)s.%(ext)s"

    grouped = build_ytdlp_cmd("http://x/v", "/out", {"group_by_uploader": True})
    assert _output_template(grouped) == "/out/%(uploader,channel,Unknown)s/%(title)s.%(ext)s"

    # Collision avoidance appends only a ` (N)` counter — the title stays
    # `%(title)s` so yt-dlp sanitises it (a raw `/` in a title must never reach
    # `-o` as a literal or yt-dlp splits it into a folder).
    grouped_suffix = build_ytdlp_cmd(
        "http://x/v", "/out", {"group_by_uploader": True, "_output_title_suffix": " (2)"}
    )
    assert (
        _output_template(grouped_suffix)
        == "/out/%(uploader,channel,Unknown)s/%(title)s (2).%(ext)s"
    )


def test_build_ytdlp_cmd_never_puts_raw_title_in_output_template():
    from app.services.downloader import build_ytdlp_cmd

    # No option carries the title into `-o`; the filename is always `%(title)s`.
    tmpl = _output_template(
        build_ytdlp_cmd("http://x/v", "/out", {"_output_title_override": "AC/DC – Live"})
    )
    assert tmpl == "/out/%(title)s.%(ext)s"
    assert "AC/DC" not in tmpl


def test_collision_suffix_returns_counter_not_title(tmp_path):
    from app.services.downloader import _collision_suffix

    assert _collision_suffix(str(tmp_path), "Some Title") == ""
    # yt-dlp writes `/` as U+29F8 — seed a matching on-disk name.
    (tmp_path / "AC⧸DC – Live.mp3").write_bytes(b"x")
    assert _collision_suffix(str(tmp_path), "AC/DC – Live") == " (1)"
    (tmp_path / "AC⧸DC – Live (1).m4a").write_bytes(b"x")
    assert _collision_suffix(str(tmp_path), "AC/DC – Live") == " (2)"


def test_build_ytdlp_cmd_always_embeds_chapters():
    from app.services.downloader import build_ytdlp_cmd

    assert "--embed-chapters" in build_ytdlp_cmd("http://x/v", "/out", {})


def test_build_ytdlp_cmd_no_limit_rate_support():
    from app.services.downloader import build_ytdlp_cmd

    # limit-rate was removed from the UI/schema — a stale option must not resurrect it
    assert "--limit-rate" not in build_ytdlp_cmd("http://x/v", "/out", {"limit_rate": "2M"})


def test_install_zip_binary_extracts_member_and_marks_executable(tmp_path):
    import zipfile

    from app.services.download_common import install_zip_binary

    archive = tmp_path / "tool.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("tool", "#!/bin/sh\necho hi\n")
        zf.writestr("LICENSE", "x")
    dest = tmp_path / "bin" / "tool"
    dest.parent.mkdir()

    install_zip_binary(archive.as_uri(), "tool", str(dest))

    assert dest.read_text().startswith("#!/bin/sh")
    assert os.access(dest, os.X_OK)
    assert sorted(p.name for p in dest.parent.iterdir()) == ["tool"]  # no .tmp left behind


def test_install_zip_binary_missing_member_leaves_nothing(tmp_path):
    import zipfile

    from app.services.download_common import install_zip_binary

    archive = tmp_path / "tool.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("other", "x")
    dest = tmp_path / "tool"

    with pytest.raises(KeyError):
        install_zip_binary(archive.as_uri(), "tool", str(dest))
    assert list(tmp_path.glob("tool*")) == [archive]


def test_format_sort_caps_the_short_side_and_selector_has_no_height_filter():
    from app.services.download_common import format_selector, format_sort

    assert format_sort("best") is None
    assert format_sort("1080") == "res:1080"
    for codec in ("auto", "h264", "hevc", "av1", "vp9"):
        fmt, _ = format_selector("1080", codec)
        # a [height<=N] filter would turn a 1080x1920 portrait video into ~480p
        assert "height" not in fmt
        assert fmt.endswith("/best")


def test_build_ytdlp_cmd_caps_resolution_with_sort_not_height():
    from app.services.downloader import build_ytdlp_cmd

    capped = build_ytdlp_cmd("http://x/v", "/out", {"quality": "720"})
    assert capped[capped.index("-S") + 1] == "res:720"
    assert "height" not in capped[capped.index("-f") + 1]
    assert "-S" not in build_ytdlp_cmd("http://x/v", "/out", {})
    assert "-S" not in build_ytdlp_cmd("http://x/v", "/out", {"quality": "720", "audio_only": True})


def test_parse_impersonate_targets_skips_headers_rules_and_unavailable():
    from app.services.download_common import parse_impersonate_targets

    out = """[info] Available impersonate targets
Client    OS          Source
--------------------------------------------
Chrome    windows-10  curl_cffi
Chrome    macos-14    curl_cffi
Edge      -           curl_cffi (unavailable)
Safari    -           curl_cffi
"""
    assert parse_impersonate_targets(out) == ["Chrome", "Safari"]
    # legacy layout without the [info] banner / Client header
    legacy = "Available impersonate targets:\n----\n  chrome-131   curl_cffi\n"
    assert parse_impersonate_targets(legacy) == ["chrome-131"]
    assert parse_impersonate_targets("") == []
