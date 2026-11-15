import os
import time

import pytest

from app.services import subtitle_preview as sp
from app.services.subtitle_lengths import length_verdict
from app.services.subtitle_providers import ProviderError


def make_srt(n=5, step=10.0):
    from app.services.srt_io import Cue, write_srt

    return write_srt([Cue(i * step + 1, i * step + 3, f"Line {i}") for i in range(n)])


class FakeProvider:
    def __init__(self, data):
        self.data = data

    def download(self, subtitle_id):
        return self.data


@pytest.fixture
def preview_dir(tmp_path, monkeypatch):
    d = tmp_path / "previews"
    monkeypatch.setattr(sp, "PREVIEW_DIR", str(d))
    return d


def use(monkeypatch, data):
    monkeypatch.setattr(sp, "get_provider", lambda name: FakeProvider(data))


def test_preview_writes_only_to_preview_dir(tmp_path, preview_dir, monkeypatch):
    folder = tmp_path / "videos"
    folder.mkdir()
    (folder / "Movie.mkv").write_bytes(b"video")
    before = {p.name: p.read_bytes() for p in folder.iterdir()}
    use(monkeypatch, make_srt().encode())
    out = sp.create_preview(str(folder / "Movie.mkv"), "subf2m", "x", "en", video_duration=60)
    assert {p.name: p.read_bytes() for p in folder.iterdir()} == before
    assert os.listdir(preview_dir) == [out["preview_id"] + ".vtt"]
    assert open(preview_dir / (out["preview_id"] + ".vtt")).read().startswith("WEBVTT")


def test_preview_stats(preview_dir, monkeypatch):
    use(monkeypatch, make_srt(500).encode())
    out = sp.create_preview("/v/Movie.mkv", "yts", "x", "en", video_duration=None)
    assert out["cues"] == 500
    assert out["first"] == 1.0 and out["last"] == 4993.0
    assert out["length"] == "unknown" and out["video_duration"] is None
    assert len(out["lines"]) <= 200
    assert out["lines"][0]["start"] == 1.0 and out["lines"][-1]["start"] == 4991.0
    assert all(len(line["text"]) <= 120 for line in out["lines"])


def test_length_verdict_boundaries():
    d = 51 * 60 + 10
    assert length_verdict(41 * 60 + 2, d) == "short"
    assert length_verdict(51 * 60 + 4, d) == "ok"
    assert length_verdict(d * 1.2, d) == "long"
    assert length_verdict(100, None) == "unknown"


def test_preview_route_rejects_bad_ids(client):
    for bad in ("short", "a..b12345678", "x" * 40, "ab cd efgh12"):
        assert client.get(f"/api/subtitles/preview/{bad}.vtt").status_code == 404
    for bad in ("../x", "../../etc/passwd", "a/b12345678", "..", ""):
        assert sp.preview_path(bad) is None
    assert client.get("/api/subtitles/preview/abcdefgh12.vtt").status_code == 404


def test_preview_route_serves_vtt(client, preview_dir, monkeypatch):
    use(monkeypatch, make_srt().encode())
    out = sp.create_preview("/v/M.mkv", "yts", "x", "en", video_duration=None)
    r = client.get(f"/api/subtitles/preview/{out['preview_id']}.vtt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/vtt")


def test_preview_sweep_deletes_old_files(preview_dir):
    preview_dir.mkdir()
    old, new = preview_dir / "old.vtt", preview_dir / "new.vtt"
    old.write_text("x")
    new.write_text("x")
    t = time.time() - 7200
    os.utime(old, (t, t))
    assert sp.sweep_previews() == 1
    assert not old.exists() and new.exists()


def test_release_tokens_match_and_mismatch():
    r = sp.release_tokens("Show.S01E01.1080p.WEB-DL.NTb", "Show.S01E01.1080p.WEB-DL.NTb.mkv")
    assert r["resolution"] == {"value": "1080p", "match": True}
    assert r["source"]["match"] is True and r["group"]["match"] is True
    assert r["group"]["value"] == "NTb"
    r = sp.release_tokens("Show.720p.WEB", "Show.1080p.WEB-DL.mkv")
    assert r["resolution"]["match"] is False
    r = sp.release_tokens("Show", "Show.mkv")
    assert r["resolution"] == {"value": None, "match": None}


def test_preview_non_utf8_decodes(preview_dir, monkeypatch):
    srt = "1\n00:00:01,000 --> 00:00:02,000\nمرحبا بالعالم\n\n"
    use(monkeypatch, srt.encode("cp1256"))
    out = sp.create_preview("/v/M.mkv", "subf2m", "x", "ar", video_duration=None)
    assert out["lines"][0]["text"] == "مرحبا بالعالم"


def test_preview_download_failures_are_named(preview_dir, monkeypatch):
    use(monkeypatch, None)
    with pytest.raises(ProviderError):
        sp.create_preview("/v/M.mkv", "yts", "x", "en", video_duration=None)
    use(monkeypatch, b"not a subtitle at all")
    with pytest.raises(ProviderError):
        sp.create_preview("/v/M.mkv", "yts", "x", "en", video_duration=None)
    use(monkeypatch, b"x" * (6 * 1024 * 1024))
    with pytest.raises(ProviderError):
        sp.create_preview("/v/M.mkv", "yts", "x", "en", video_duration=None)
    assert not preview_dir.exists() or os.listdir(preview_dir) == []


def test_preview_post_route(client, tmp_path, preview_dir, monkeypatch):
    use(monkeypatch, make_srt().encode())
    v = tmp_path / "M.mkv"
    v.write_bytes(b"v")
    monkeypatch.setattr("app.api.subtitle_run.probe_duration", lambda p: 100.0)
    body = {"video_path": str(v), "provider": "yts", "subtitle_id": "x", "language": "en"}
    r = client.post("/api/subtitles/preview", json=body)
    assert r.status_code == 200 and r.json()["video_duration"] == 100.0
    assert (
        client.post(
            "/api/subtitles/preview", json={**body, "video_path": "/etc/passwd"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/subtitles/preview", json={**body, "video_path": "/nope/x.mkv"}
        ).status_code
        == 404
    )
    use(monkeypatch, None)
    assert client.post("/api/subtitles/preview", json=body).status_code == 502


def test_preview_route_foreign_id_makes_no_request(client, tmp_path, preview_dir, monkeypatch):
    from app.services import subf2m_provider as sf

    calls = []
    monkeypatch.setattr(sf.Subf2mProvider, "_get_text", lambda self, *a, **k: calls.append(a))
    v = tmp_path / "M.mkv"
    v.write_bytes(b"v")
    monkeypatch.setattr("app.api.subtitle_run.probe_duration", lambda p: 100.0)
    r = client.post(
        "/api/subtitles/preview",
        json={
            "video_path": str(v),
            "provider": "subf2m",
            "subtitle_id": "https://subf2m.co@evil.com/x",
            "language": "en",
        },
    )
    assert r.status_code == 502 and "Not a subtitle from this source" in r.json()["detail"]
    assert calls == []


def test_preview_route_vtt_has_nosniff(client, preview_dir, monkeypatch):
    use(monkeypatch, make_srt().encode())
    out = sp.create_preview("/v/M.mkv", "yts", "x", "en", video_duration=None)
    r = client.get(f"/api/subtitles/preview/{out['preview_id']}.vtt")
    assert r.headers["x-content-type-options"] == "nosniff"
