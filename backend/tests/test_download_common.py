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

    # A collision-avoidance title override keeps a literal filename, templated dir
    grouped_override = build_ytdlp_cmd(
        "http://x/v", "/out", {"group_by_uploader": True, "_output_title_override": "My Vid (2)"}
    )
    assert (
        _output_template(grouped_override) == "/out/%(uploader,channel,Unknown)s/My Vid (2).%(ext)s"
    )


def test_build_ytdlp_cmd_always_embeds_chapters():
    from app.services.downloader import build_ytdlp_cmd

    assert "--embed-chapters" in build_ytdlp_cmd("http://x/v", "/out", {})


def test_build_ytdlp_cmd_no_limit_rate_support():
    from app.services.downloader import build_ytdlp_cmd

    # limit-rate was removed from the UI/schema — a stale option must not resurrect it
    assert "--limit-rate" not in build_ytdlp_cmd("http://x/v", "/out", {"limit_rate": "2M"})
