import shutil
import subprocess

import pytest

from app.services import keyframes

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")


def _make_mkv(path, force_keyframes: str):
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", "testsrc=size=128x72:rate=24:duration=40",
            "-c:v", "libx264", "-preset", "ultrafast", "-g", "100000", "-keyint_min", "1",
            "-sc_threshold", "0", "-force_key_frames", force_keyframes, str(path),
        ],
        check=True,
    )  # fmt: skip


def _ffprobe_keyframes(path) -> list[float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "packet=pts_time,flags", "-select_streams",
         "v:0", "-of", "csv", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    rows = (ln.split(",") for ln in out.splitlines() if ln.startswith("packet"))
    return sorted({float(r[1]) for r in rows if r[2].startswith("K")})


@needs_ffmpeg
def test_matroska_cues_match_ffprobe_keyframes(tmp_path):
    src = tmp_path / "irregular.mkv"
    _make_mkv(src, "3,4.5,11,12,20.5,33")
    duration, cues = keyframes._matroska(str(src))
    assert duration == pytest.approx(40.0, abs=0.1)
    assert cues == pytest.approx(_ffprobe_keyframes(src), abs=0.002)
    assert len(cues) >= 6


@needs_ffmpeg
def test_extract_keyframes_prefers_cues(tmp_path, monkeypatch):
    src = tmp_path / "a.mkv"
    _make_mkv(src, "5,10")
    monkeypatch.setattr(keyframes, "_ffprobe", lambda *a: pytest.fail("fell back to ffprobe"))
    duration, times = keyframes.extract_keyframes(str(src))
    assert times[0] == 0.0 and 5.0 in times and 10.0 in times


@needs_ffmpeg
def test_non_matroska_falls_back_to_ffprobe(tmp_path):
    src = tmp_path / "a.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "lavfi", "-i", "testsrc=size=128x72:rate=24:duration=20",
         "-c:v", "libx264", "-g", "48", str(src)],
        check=True,
    )  # fmt: skip
    seen = []
    duration, times = keyframes.extract_keyframes(str(src), seen.append)
    assert duration == pytest.approx(20.0, abs=0.2)
    assert times == pytest.approx(_ffprobe_keyframes(src), abs=0.002)
    assert seen and seen[-1] <= 1.0


def test_unreadable_file_yields_nothing(tmp_path):
    junk = tmp_path / "junk.mkv"
    junk.write_bytes(b"not a video at all")
    assert keyframes.extract_keyframes(str(junk)) is None
