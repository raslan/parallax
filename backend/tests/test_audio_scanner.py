from unittest.mock import patch

from app.services import audio_scanner


def test_probe_audio_metadata_prefers_embedded_date_over_mtime():
    fake_probe = {
        "format": {
            "duration": "212.5",
            "size": "3400000",
            "bit_rate": "128000",
            "tags": {"creation_time": "2019-05-01T00:00:00.000000Z"},
        },
        "streams": [
            {
                "codec_name": "mp3",
                "sample_rate": "44100",
                "channels": 2,
                "channel_layout": "stereo",
                "bit_rate": "128000",
            }
        ],
    }
    with (
        patch.object(audio_scanner, "probe_audio", return_value=fake_probe),
        patch("os.path.getmtime", return_value=1_700_000_000.0),
        patch("os.stat") as st,
    ):
        st.return_value.st_size = 3_400_000
        meta = audio_scanner._probe_audio_metadata("/x/song.mp3")

    assert meta["probe_ok"] is True
    assert meta["codec_name"] == "mp3"
    assert meta["sample_rate"] == 44100
    assert meta["channels"] == 2
    assert meta["channel_layout"] == "stereo"
    assert meta["bitrate"] == 128000
    assert meta["file_mtime"] == 1_700_000_000.0
    # embedded 2019 date wins over the 2023 mtime
    assert meta["file_date"] < meta["file_mtime"]


def test_probe_audio_metadata_falls_back_to_mtime_when_no_tag():
    fake_probe = {"format": {"duration": "10", "size": "1000"}, "streams": [{"codec_name": "opus"}]}
    with (
        patch.object(audio_scanner, "probe_audio", return_value=fake_probe),
        patch("os.path.getmtime", return_value=1_600_000_000.0),
        patch("os.stat") as st,
    ):
        st.return_value.st_size = 1000
        meta = audio_scanner._probe_audio_metadata("/x/a.opus")
    assert meta["file_date"] == meta["file_mtime"] == 1_600_000_000.0


def test_find_audio_files_skips_originals(tmp_path):
    (tmp_path / "a.mp3").write_bytes(b"x")
    (tmp_path / "b.txt").write_bytes(b"x")
    orig = tmp_path / "_originals"
    orig.mkdir()
    (orig / "old.mp3").write_bytes(b"x")
    found = audio_scanner._find_audio_files(str(tmp_path))
    assert found == [str(tmp_path / "a.mp3")]
