"""Every flow that replaces a file with new content keeps the old file's dates and mode.

A photo manager or media server sees a replaced file as new when its mtime jumps to "now", so
each replace path copies the old file's properties onto the finished temp file first
(`file_props.copy_props`). Real files and tiny ffmpeg fixtures; only the encoder is pinned so the
test never depends on the host's GPU.
"""

import os
import shutil
import stat
import subprocess
from types import SimpleNamespace

import pytest

from app.services import audio_compressor as ac
from app.services import audio_toolbox as at
from app.services import compressor as c
from app.services import image_upscaler as iu
from app.services import subtitle_sync as ss
from app.services import toolbox as tb

OLD_NS = 1_500_000_000_123_456_789
OLD_MODE = 0o640

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg missing")


def _age(path):
    """Give a file an old mtime and a distinctive mode, as a long-lived library file has."""
    os.chmod(path, OLD_MODE)
    os.utime(path, ns=(OLD_NS, OLD_NS))
    return str(path)


def _kept(path):
    st = os.stat(path)
    assert st.st_mtime_ns == OLD_NS
    assert stat.S_IMODE(st.st_mode) == OLD_MODE


def _ffmpeg(path, *inputs, args=()):
    cmd = ["ffmpeg", "-v", "error", "-y"]
    for i in inputs:
        cmd += ["-f", "lavfi", "-i", i]
    subprocess.run([*cmd, *args, str(path)], check=True)
    return str(path)


@needs_ffmpeg
def test_video_compress_keeps_the_original_dates_and_mode(tmp_path, monkeypatch):
    monkeypatch.setattr(c, "_resolve_encoder", lambda codec: "libx264")
    src = _age(
        _ffmpeg(
            tmp_path / "clip.mp4",
            "testsrc=d=1:s=64x64:r=10",
            args=["-c:v", "libx264", "-pix_fmt", "yuv420p"],
        )
    )
    ok, error, final = c._compress_one(src, "h264", 35, "ultrafast", 1, keep_original=False)
    assert ok, error
    _kept(final)


@needs_ffmpeg
def test_video_toolbox_keeps_the_original_dates_and_mode(tmp_path):
    src = _age(
        _ffmpeg(
            tmp_path / "clip.mp4",
            "testsrc=d=1:s=64x64:r=10",
            args=["-c:v", "libx264", "-pix_fmt", "yuv420p"],
        )
    )
    ok, error, final = tb._toolbox_fix_one(src, {"faststart": True}, 1, keep_original=False)
    assert ok, error
    _kept(final)


@needs_ffmpeg
def test_audio_compress_keeps_the_original_dates_and_mode(fs_db, tmp_path):
    src = _age(_ffmpeg(tmp_path / "song.mp3", "sine=d=1", args=["-c:a", "libmp3lame"]))
    ok, error = ac._compress_one(src, "libmp3lame", ".mp3", 64, 1, 1.0, keep_original=False)
    assert ok, error
    _kept(src)


@needs_ffmpeg
def test_audio_toolbox_keeps_the_original_dates_and_mode(fs_db, tmp_path):
    # no database row, so the toolbox re-encodes as AAC: the source has to be an AAC container
    src = _age(_ffmpeg(tmp_path / "song.m4a", "sine=d=1", args=["-ac", "2", "-c:a", "aac"]))
    ok, error = at._toolbox_fix_one(src, {"channel_op": "mono"}, False, 1)
    assert ok, error
    _kept(src)


def test_upscale_replace_keeps_the_original_dates_and_mode(fs_db, tmp_path):
    (tmp_path / "photo.jpg").write_bytes(b"original")
    original = _age(tmp_path / "photo.jpg")
    new = tmp_path / ".compressing-photo.jpg"
    new.write_bytes(b"upscaled")
    source = SimpleNamespace(id=1, path=original)
    iu._replace_original(source, str(new), False)
    assert open(original, "rb").read() == b"upscaled"
    _kept(original)


@pytest.mark.parametrize("engine", ["ffsubsync", "alass"])
def test_subtitle_sync_keeps_the_original_dates_and_mode(tmp_path, monkeypatch, engine):
    sub = tmp_path / "movie.en.srt"
    sub.write_text("old timing")
    _age(sub)
    monkeypatch.setattr(ss, "ensure_alass", lambda: None)
    monkeypatch.setattr(ss, "_alass_bin", lambda: "alass")

    def fake_run(_cmd, _label, tmp_out):
        with open(tmp_out, "w") as fh:
            fh.write("new timing")

    monkeypatch.setattr(ss, "_run_synced", fake_run)
    sync = ss.sync_alass if engine == "alass" else ss.sync_ffsubsync
    assert sync(str(tmp_path / "movie.mkv"), str(sub))
    assert sub.read_text() == "new timing"
    _kept(sub)
