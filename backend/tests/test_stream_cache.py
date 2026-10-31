import shutil
import subprocess
import time

import pytest

from app.services import hls_plan, keyframes
from app.services import stream_cache as sc

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")


@pytest.fixture(autouse=True)
def cache(tmp_path, monkeypatch):
    """Point the single-slot cache at tmp_path and start from a blank state."""
    monkeypatch.setattr(sc, "CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(sc, "_sweeper_thread", None)
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
            "plan": [],
            "playlist": None,
            "master": None,
            "run": None,
            "next_run": 0,
            "last_requested": 0,
            "video_codec": None,
        },
    )
    yield tmp_path
    with sc._lock:
        sc._stop_run_locked()


def test_video_codec_string_h264():
    assert sc._video_codec_string(b"..avcC" + bytes([1, 0x64, 0, 0x1E]) + b"..") == "avc1.64001e"


def test_video_codec_string_hevc():
    hvcc = b"hvcC" + bytes([1, 0x01]) + (0x60000000).to_bytes(4, "big")
    hvcc += bytes([0x90, 0, 0, 0, 0, 0, 120])
    assert sc._video_codec_string(b"xx" + hvcc) == "hvc1.1.6.L120.90"


def test_video_codec_string_hevc_profile_space_letter():
    hvcc = b"hvcC" + bytes([1, 0x41]) + (0).to_bytes(4, "big") + bytes([0] * 6) + bytes([90])
    assert sc._video_codec_string(hvcc) == "hvc1.A1.0.L90"


def test_video_codec_string_unknown():
    assert sc._video_codec_string(b"nothing here") is None


def test_start_sweeper_clears_leftover_unconditionally(cache):
    (cache / "abcd1234").mkdir()
    (cache / "current.mp4").write_bytes(b"x")  # pre-HLS leftover
    try:
        sc.start_sweeper()
        assert list(cache.iterdir()) == []
    finally:
        sc.stop_sweeper()


def test_sweep_evicts_idle_session(cache):
    d = cache / "abcd1234"
    d.mkdir()
    sc._state.update(path="/a.mkv", sid="abcd1234", status="ready", touched=1.0)
    with sc._lock:
        sc._sweep_locked()
    assert not d.exists()
    assert sc._state["sid"] is None


def test_sweep_keeps_recent_session(cache):
    d = cache / "abcd1234"
    d.mkdir()
    sc._state.update(path="/a.mkv", sid="abcd1234", status="ready", touched=time.time())
    with sc._lock:
        sc._sweep_locked()
    assert d.exists()


def test_sweep_stops_stalled_run(cache):
    (cache / "abcd1234").mkdir()
    proc = subprocess.Popen(["sleep", "30"])
    run = {"proc": proc, "cancelled": False, "finished": False}
    sc._state.update(
        sid="abcd1234", status="ready", run=run, touched=time.time() - sc._STALL_SECONDS - 1
    )
    try:
        with sc._lock:
            sc._sweep_locked()
        proc.wait(timeout=5)
        assert run["cancelled"]
    finally:
        proc.kill()


def test_hls_resource_serves_only_the_live_ready_session(cache):
    sc._state.update(
        sid="abcd1234", status="ready", master="#EXTM3U\nm\n", playlist="#EXTM3U\np\n", plan=[1]
    )
    assert sc.hls_resource("abcd1234", "master.m3u8") == ("bytes", b"#EXTM3U\nm\n")
    assert sc.hls_resource("abcd1234", "index.m3u8") == ("bytes", b"#EXTM3U\np\n")
    assert sc.hls_resource("ffffffff", "index.m3u8") is None  # not the live session
    assert sc.hls_resource("abcd1234", "../index.m3u8") is None
    assert sc.hls_resource("abcd1234", "x.txt") is None
    assert sc.hls_resource("abcd1234", "init.mp4") is None  # not written yet
    sc._state["status"] = "planning"
    assert sc.hls_resource("abcd1234", "index.m3u8") is None


# ── end to end against real ffmpeg ────────────────────────────────────────────


def _make_ac3_movie(path, seconds=150, keyframes_at=None):
    force = keyframes_at or "4,9.5,17,18,31,40,52,60.5,71,83,90,101,118,125,139"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", f"testsrc2=size=160x90:rate=24:duration={seconds}",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
            "-c:v", "libx264", "-preset", "ultrafast", "-g", "100000", "-keyint_min", "1",
            "-sc_threshold", "0", "-force_key_frames", force, "-c:a", "ac3", "-ac", "6", str(path),
        ],
        check=True,
    )  # fmt: skip


def _wait_ready(src, timeout=60):
    status = sc.start_prepare(str(src))
    deadline = time.time() + timeout
    while status["status"] == "running" and time.time() < deadline:
        time.sleep(0.1)
        status = sc.needs_prepare(str(src))
    return status


def _first_video_pts(cache, sid, segment) -> float:
    """Presentation time of the first video packet of a served segment (init + segment)."""
    init = sc.hls_resource(sid, "init.mp4")[1]
    seg = sc.hls_resource(sid, segment)[1]
    blob = cache / "probe.mp4"
    blob.write_bytes(open(init, "rb").read() + open(seg, "rb").read())
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "packet=pts_time", "-select_streams", "v:0",
         "-of", "csv", str(blob)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    return float(out.splitlines()[0].split(",")[1])


@needs_ffmpeg
def test_ac3_source_is_planned_and_converted_on_demand(cache, tmp_path_factory):
    src = tmp_path_factory.mktemp("src") / "movie.mkv"
    _make_ac3_movie(src)

    assert sc.needs_prepare(str(src))["status"] == "not_started"
    status = _wait_ready(src)
    assert status["status"] == "ready", status
    assert status["mode"] == "hls"
    sid = sc._state["sid"]
    assert status["url"] == f"/stream/hls/{sid}/master.m3u8"

    master = sc.hls_resource(sid, "master.m3u8")[1].decode()
    assert 'CODECS="avc1.' in master and "mp4a.40.2" in master

    # the full VOD playlist exists immediately and covers the whole file
    playlist = sc.hls_resource(sid, "index.m3u8")[1].decode()
    assert "#EXT-X-ENDLIST" in playlist and "#EXT-X-PLAYLIST-TYPE:VOD" in playlist
    plan = sc._state["plan"]
    assert len(plan) > hls_plan.CHUNK_SEGMENTS // 2
    assert sum(s.duration for s in plan) == pytest.approx(150.0, abs=0.2)

    # segments in later chunks are produced on request (ffmpeg restarts there) and start
    # exactly where the playlist says they do
    last = len(plan) - 1
    for index in (0, last // 2, last, 1):
        name = f"seg_{index:05d}.m4s"
        assert _first_video_pts(cache, sid, name) == pytest.approx(
            plan[index].start if index else 0.0, abs=0.06
        )


@needs_ffmpeg
def test_web_safe_audio_plays_direct(cache, tmp_path_factory):
    src = tmp_path_factory.mktemp("src") / "movie.mp4"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", "testsrc=size=160x90:rate=24:duration=2",
            "-f", "lavfi", "-i", "sine=duration=2", "-c:v", "libx264", "-c:a", "aac", str(src),
        ],
        check=True,
    )  # fmt: skip
    status = sc.start_prepare(str(src))
    assert (status["status"], status["mode"], status["url"]) == ("ready", "direct", None)
    assert sc._state["sid"] is None


@needs_ffmpeg
def test_unreadable_keyframes_report_an_error(cache, monkeypatch, tmp_path_factory):
    src = tmp_path_factory.mktemp("src") / "movie.mkv"
    _make_ac3_movie(src, seconds=10, keyframes_at="3")
    monkeypatch.setattr(keyframes, "extract_keyframes", lambda *a: None)
    status = _wait_ready(src)
    assert status["status"] == "error"
    assert "keyframes" in status["error"]
