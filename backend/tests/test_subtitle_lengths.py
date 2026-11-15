import os

import pytest

from app.services import scanner
from app.services import subtitle_lengths as sl

SRT_2462 = "1\n00:00:01,000 --> 00:00:02,000\nHi.\n\n2\n00:41:00,000 --> 00:41:02,000\nBye.\n\n"


def touch(path, text="x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return str(path)


def fake_probe(monkeypatch, duration=3070.0, ok=True):
    monkeypatch.setattr(
        scanner, "probe_metadata", lambda p: {"duration": duration if ok else None, "probe_ok": ok}
    )


def test_check_lengths_flags_short_subtitle(tmp_path, monkeypatch):
    fake_probe(monkeypatch)
    video = touch(tmp_path / "Movie.mkv")
    touch(tmp_path / "Movie.en.srt", SRT_2462)
    out = sl.check_lengths([video])
    assert out[video]["duration"] == 3070.0
    (sub,) = out[video]["subtitles"]
    assert sub["last_cue"] == pytest.approx(2462.0)
    assert sub["length"] == "short"
    assert sub["path"] == str(tmp_path / "Movie.en.srt")


def test_original_backups_are_not_checked(tmp_path, monkeypatch):
    fake_probe(monkeypatch)
    video = touch(tmp_path / "Movie.mkv")
    touch(tmp_path / "Movie.en.srt", SRT_2462)
    touch(tmp_path / "Movie.en.original.srt", SRT_2462)
    touch(tmp_path / "Movie.ar.translated.srt", SRT_2462)
    touch(tmp_path / "Movie.en.hi.srt", SRT_2462)
    names = [os.path.basename(s["path"]) for s in sl.check_lengths([video])[video]["subtitles"]]
    assert sorted(names) == ["Movie.ar.translated.srt", "Movie.en.hi.srt", "Movie.en.srt"]


def test_unparseable_subtitle_is_unknown_not_error(tmp_path, monkeypatch):
    fake_probe(monkeypatch)
    video = touch(tmp_path / "Movie.mkv")
    with open(tmp_path / "Movie.en.srt", "wb") as f:
        f.write(b"\xff\xfe\x00garbage\x80\x81")
    (sub,) = sl.check_lengths([video])[video]["subtitles"]
    assert sub["last_cue"] is None
    assert sub["length"] == "unknown"


def test_vanished_path_is_null(client, tmp_path, monkeypatch):
    fake_probe(monkeypatch)
    video = touch(tmp_path / "Movie.mkv")
    gone = str(tmp_path / "Gone.mkv")
    notvideo = touch(tmp_path / "notes.txt")
    r = client.post(
        "/api/subtitles/check-lengths", json={"video_paths": [video, gone, notvideo, "/a\0b.mkv"]}
    )
    assert r.status_code == 200
    body = r.json()
    assert body[video] == {"duration": 3070.0, "subtitles": []}
    assert body[gone] is None
    assert body[notvideo] is None


def test_more_than_25_paths_is_400(client, tmp_path):
    paths = [str(tmp_path / f"{i}.mkv") for i in range(26)]
    r = client.post("/api/subtitles/check-lengths", json={"video_paths": paths})
    assert r.status_code == 400
    r = client.post("/api/subtitles/check-lengths", json={"video_paths": paths[:25]})
    assert r.status_code == 200


def test_probe_failure_gives_unknown(tmp_path, monkeypatch):
    fake_probe(monkeypatch, ok=False)
    video = touch(tmp_path / "Movie.mkv")
    touch(tmp_path / "Movie.en.srt", SRT_2462)
    out = sl.check_lengths([video])[video]
    assert out["duration"] is None
    assert out["subtitles"][0]["last_cue"] == pytest.approx(2462.0)
    assert out["subtitles"][0]["length"] == "unknown"


def test_probe_exception_gives_unknown(tmp_path, monkeypatch):
    def boom(p):
        raise OSError("dead mount")

    monkeypatch.setattr(scanner, "probe_metadata", boom)
    video = touch(tmp_path / "Movie.mkv")
    assert sl.check_lengths([video])[video]["duration"] is None


def test_one_folder_is_walked_once(tmp_path, monkeypatch):
    fake_probe(monkeypatch)
    vids = [touch(tmp_path / f"M{i}.mkv") for i in range(5)]
    from app.services import subtitle_files

    calls = []
    real = subtitle_files._subtitle_search_dirs
    monkeypatch.setattr(
        subtitle_files, "_subtitle_search_dirs", lambda p: calls.append(p) or real(p)
    )
    sl.check_lengths(vids)
    assert len(calls) == 1
