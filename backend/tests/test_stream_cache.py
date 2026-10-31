import json
import shutil
import subprocess
import time

import pytest

from app.services import stream_cache as sc


@pytest.fixture(autouse=True)
def cache(tmp_path, monkeypatch):
    """Point the single-slot cache at tmp_path and start from a blank state."""
    monkeypatch.setattr(sc, "CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(sc, "_sweeper_thread", None)
    monkeypatch.setattr(sc, "_proc", None)
    monkeypatch.setattr(
        sc,
        "_state",
        {
            "path": None,
            "sid": None,
            "status": "idle",
            "progress": 0.0,
            "error": None,
            "touched": 0.0,
        },
    )
    return tmp_path


def _session(tmp_path, sid="abcd1234", *, segments=0, ended=False):
    d = tmp_path / sid
    d.mkdir()
    lines = ["#EXTM3U", "#EXT-X-VERSION:7"]
    for i in range(segments):
        lines += ["#EXTINF:6.0,", f"seg_{i:05d}.m4s"]
    if ended:
        lines.append("#EXT-X-ENDLIST")
    (d / "index.m3u8").write_text("\n".join(lines))
    (d / "master.m3u8").write_text("#EXTM3U\n")
    return d


def test_video_codec_string_h264():
    assert sc._video_codec_string(b"..avcC" + bytes([1, 0x64, 0, 0x1E]) + b"..") == "avc1.64001e"


def test_video_codec_string_hevc():
    hvcc = b"hvcC" + bytes([1, 0x01]) + (0x60000000).to_bytes(4, "big")
    hvcc += bytes([0x90, 0, 0, 0, 0, 0, 120])
    assert sc._video_codec_string(b"xx" + hvcc) == "hvc1.1.6.L120.90"


def test_video_codec_string_unknown():
    assert sc._video_codec_string(b"nothing here") is None


def test_read_playlist_drops_partial_tail(tmp_path):
    p = tmp_path / "index.m3u8"
    p.write_text(
        "#EXTM3U\n#EXTINF:6.0,\nseg_00000.m4s\n#EXTINF:6.0,\nseg_00001.m4s\n#EXTINF:6.0,\nseg_0"
    )
    assert (
        sc.read_playlist(str(p))
        == b"#EXTM3U\n#EXTINF:6.0,\nseg_00000.m4s\n#EXTINF:6.0,\nseg_00001.m4s\n"
    )
    p.write_text("#EXTM3U\n#EXTINF:6.0,\nseg_00000.m4s\n#EXTINF:6.0,\n")
    assert sc.read_playlist(str(p)) == b"#EXTM3U\n#EXTINF:6.0,\nseg_00000.m4s\n"
    p.write_text("#EXTM3U\n#EXTINF:6.0,\nseg_00000.m4s\n#EXT-X-ENDLIST\n")
    assert sc.read_playlist(str(p)).endswith(b"#EXT-X-ENDLIST\n")


def test_playable_needs_master(cache):
    d = _session(cache, segments=3)
    (d / "master.m3u8").unlink()
    assert not sc._playable("abcd1234", done=False)


def test_start_sweeper_clears_leftover_unconditionally(cache):
    _session(cache)
    (cache / "current.mp4").write_bytes(b"x")  # pre-HLS leftover
    try:
        sc.start_sweeper()
        assert list(cache.iterdir()) == []
    finally:
        sc.stop_sweeper()


def test_sweep_evicts_idle_finished_session(cache):
    d = _session(cache, segments=3, ended=True)
    sc._state.update(
        path="/a.mkv", sid="abcd1234", status="done", touched=time.time() - sc._IDLE_TTL_SECONDS - 1
    )
    with sc._lock:
        sc._sweep_locked()
    assert not d.exists()
    assert sc._state["sid"] is None


def test_sweep_keeps_recent_finished_session(cache):
    d = _session(cache, segments=3, ended=True)
    sc._state.update(path="/a.mkv", sid="abcd1234", status="done", touched=time.time())
    with sc._lock:
        sc._sweep_locked()
    assert d.exists()


def test_sweep_stops_stalled_run(cache):
    _session(cache)
    proc = subprocess.Popen(["sleep", "30"])
    sc._proc = proc
    sc._state.update(
        path="/a.mkv", sid="abcd1234", status="running", touched=time.time() - sc._STALL_SECONDS - 1
    )
    try:
        with sc._lock:
            sc._sweep_locked()
        proc.wait(timeout=5)
        assert sc._state["status"] == "stopped"
    finally:
        proc.kill()


def test_playable_needs_two_segments_until_done(cache):
    _session(cache, segments=1)
    assert not sc._playable("abcd1234", done=False)
    assert sc._playable("abcd1234", done=True)
    shutil.rmtree(cache / "abcd1234")
    _session(cache, segments=2)
    assert sc._playable("abcd1234", done=False)


def test_playable_false_without_playlist(cache):
    assert not sc._playable("abcd1234", done=False)


def test_hls_file_path_only_serves_current_session(cache):
    d = _session(cache)
    (d / "seg_00000.m4s").write_bytes(b"x")
    sc._state.update(sid="abcd1234", status="running")
    assert sc.hls_file_path("abcd1234", "index.m3u8") == str(d / "index.m3u8")
    assert sc.hls_file_path("abcd1234", "seg_00000.m4s") == str(d / "seg_00000.m4s")
    assert sc.hls_file_path("abcd1234", "seg_00009.m4s") is None  # not on disk
    assert sc.hls_file_path("ffffffff", "index.m3u8") is None  # not the live session
    assert sc.hls_file_path("abcd1234", "../index.m3u8") is None
    assert sc.hls_file_path("abcd1234", "x.txt") is None
    assert sc.hls_file_path("../", "index.m3u8") is None


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_ac3_source_is_served_as_aac_hls(cache, tmp_path_factory):
    src = tmp_path_factory.mktemp("src") / "movie.mkv"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=24:duration=14",
            "-f", "lavfi", "-i", "sine=duration=14", "-c:v", "libx264", "-g", "24",
            "-c:a", "ac3", "-ac", "6", str(src),
        ],
        check=True,
    )  # fmt: skip

    assert sc.needs_prepare(str(src))["status"] == "not_started"
    status = sc.start_prepare(str(src))
    assert status["mode"] == "hls"

    deadline = time.time() + 60
    while status["status"] != "ready" and time.time() < deadline:
        assert status["status"] != "error", status["error"]
        time.sleep(0.3)
        status = sc.needs_prepare(str(src))
    assert status["status"] == "ready"
    assert status["url"] == f"/stream/hls/{sc._state['sid']}/master.m3u8"

    d = cache / sc._state["sid"]
    playlist = (d / "index.m3u8").read_text()
    assert "#EXT-X-ENDLIST" in playlist and "#EXT-X-MAP" in playlist
    assert 'CODECS="avc1.' in (d / "master.m3u8").read_text()
    assert (d / "init.mp4").is_file() and (d / "seg_00000.m4s").is_file()

    probe = json.loads(
        subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_entries",
             "stream=codec_type,codec_name,channels", str(d / "init.mp4")],
            capture_output=True, text=True, check=True,
        ).stdout
    )  # fmt: skip
    codecs = {s["codec_type"]: s["codec_name"] for s in probe["streams"]}
    assert codecs == {"video": "h264", "audio": "aac"}


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_web_safe_audio_plays_direct(cache, tmp_path_factory):
    src = tmp_path_factory.mktemp("src") / "movie.mp4"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=24:duration=2",
            "-f", "lavfi", "-i", "sine=duration=2", "-c:v", "libx264", "-c:a", "aac", str(src),
        ],
        check=True,
    )  # fmt: skip
    status = sc.start_prepare(str(src))
    assert (status["status"], status["mode"], status["url"]) == ("ready", "direct", None)
    assert sc._state["sid"] is None
