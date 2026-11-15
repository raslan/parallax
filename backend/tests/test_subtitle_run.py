import json
import os
import threading

import pytest

from app.models.job import Job, JobStatus, JobType
from app.services import subtitle_run as sr
from app.services.common import request_cancel
from app.services.subtitle_providers import Identity, ProviderError, SearchQuery


def srt(text="Hello.", n=3):
    return "".join(
        f"{i + 1}\n00:00:{i * 2 + 1:02d},000 --> 00:00:{i * 2 + 2:02d},000\n{text} {i}\n\n"
        for i in range(n)
    ).encode()


class FakeProvider:
    def __init__(self, name, media_types=("movie", "tv"), results=None, error=None, files=None):
        self.name = name
        self.media_types = frozenset(media_types)
        self.results = results or []
        self.error = error
        self.files = files or {}
        self.searches = 0
        self.downloads = []

    def search(self, q):
        self.searches += 1
        if self.error:
            raise self.error
        return [dict(r) for r in self.results]

    def download(self, subtitle_id):
        self.downloads.append(subtitle_id)
        value = self.files[subtitle_id]
        if isinstance(value, Exception):
            raise value
        if callable(value):
            return value()
        return value

    def close(self):
        pass


@pytest.fixture(autouse=True)
def _clear_cache():
    sr._CACHE.clear()
    yield
    sr._CACHE.clear()


def use(monkeypatch, *providers):
    table = {p.name: p for p in providers}

    def get(name):
        if name not in table:
            raise ValueError("Unknown source")
        return table[name]

    monkeypatch.setattr(sr, "get_provider", get)
    return table


def query(kind="movie", imdb=None):
    return SearchQuery(
        identity=Identity("Movie", 2020, kind, imdb_id=imdb),
        languages=("en",),
        season=1 if kind == "tv" else None,
        episode=1 if kind == "tv" else None,
        video_path="/v/Movie.mkv",
    )


# ---------------------------------------------------------------- search


def test_search_skips_yts_for_tv_and_says_why(monkeypatch):
    yts = FakeProvider("yts", media_types=("movie",), results=[{"score": 9}])
    sub = FakeProvider("subf2m", results=[{"score": 1, "subtitle_id": "a"}])
    use(monkeypatch, yts, sub)
    out = sr.search_candidates(query("tv"), ["yts", "subf2m"])
    assert out["errors"] == [{"provider": "yts", "message": "Films only"}]
    assert yts.searches == 0
    assert [c["subtitle_id"] for c in out["candidates"]] == ["a"]


def test_search_provider_error_becomes_entry(monkeypatch):
    bad = FakeProvider("yts", media_types=("movie",), error=ProviderError("boom"))
    good = FakeProvider(
        "subf2m", results=[{"score": 1, "subtitle_id": "low"}, {"score": 5, "subtitle_id": "hi"}]
    )
    use(monkeypatch, bad, good)
    out = sr.search_candidates(query("movie", imdb="tt1"), ["yts", "subf2m"])
    assert out["errors"] == [{"provider": "yts", "message": "boom"}]
    assert [c["subtitle_id"] for c in out["candidates"]] == ["hi", "low"]


def test_search_cache_reused_within_ttl(monkeypatch):
    sub = FakeProvider("subf2m", results=[{"score": 1, "subtitle_id": "a"}])
    use(monkeypatch, sub)
    t = [1000.0]
    clock = lambda: t[0]  # noqa: E731
    first = sr.search_candidates(query(), ["subf2m"], clock=clock)
    t[0] += sr.CACHE_TTL_SECONDS - 1
    second = sr.search_candidates(query(), ["subf2m"], clock=clock)
    assert sub.searches == 1
    assert second == first
    t[0] += 2
    sr.search_candidates(query(), ["subf2m"], clock=clock)
    assert sub.searches == 2
    assert sr.CACHE_TTL_SECONDS == 600


# ---------------------------------------------------------------- run


@pytest.fixture
def env(tmp_path, monkeypatch, fs_db):
    media = tmp_path / "media"
    media.mkdir()
    video = media / "Movie.mkv"
    video.write_bytes(b"v")
    synced = []

    def fake_sync(video_path, sub_path, engine="alass"):
        synced.append((sub_path, engine))
        return True

    monkeypatch.setattr(sr, "sync_subtitle", fake_sync)
    return video, fs_db, synced


def _job(fs_db, items=None) -> int:
    db = fs_db()
    job = Job(
        type=JobType.SUBTITLE_DOWNLOAD,
        status=JobStatus.PENDING,
        settings=json.dumps({"path": "/x", "items": items or []}),
    )
    db.add(job)
    db.commit()
    jid = job.id
    db.close()
    return jid


def _state(fs_db, jid):
    db = fs_db()
    job = db.get(Job, jid)
    out = (job.status, job.current_file, job.error, json.loads(job.settings or "{}"))
    db.close()
    return out


def item(video, sid="a", lang="en", provider="subf2m", sync=False):
    return {
        "video_path": str(video),
        "language": lang,
        "provider": provider,
        "subtitle_id": sid,
        "sync": sync,
    }


def test_run_saves_plain_file_when_none_exists(env, monkeypatch):
    video, fs_db, _ = env
    use(monkeypatch, FakeProvider("subf2m", files={"a": srt("New")}))
    jid = _job(fs_db)
    sr.run_subtitle_job(jid, [item(video)], False, False, None)
    plain = video.parent / "Movie.en.srt"
    assert plain.read_bytes() == srt("New")
    status, _cur, _err, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED
    assert settings["results"] == [
        {"video_path": str(video), "language": "en", "status": "saved", "path": str(plain)}
    ]
    assert settings["path"] == "/x"  # the stored plan is kept beside the results


def test_run_overwrites_plain_and_removes_machine_made_when_not_keeping(env, monkeypatch):
    video, fs_db, _ = env
    (video.parent / "Movie.en.srt").write_bytes(srt("Old"))
    (video.parent / "Movie.en.generated.srt").write_bytes(srt("Gen"))
    (video.parent / "Movie.ar.translated.srt").write_bytes(srt("Other language"))
    use(monkeypatch, FakeProvider("subf2m", files={"a": srt("New")}))
    sr.run_subtitle_job(_job(fs_db), [item(video)], False, False, None)
    assert (video.parent / "Movie.en.srt").read_bytes() == srt("New")
    assert not (video.parent / "Movie.en.generated.srt").exists()
    assert (video.parent / "Movie.ar.translated.srt").exists()


def test_run_keep_existing_writes_source_label(env, monkeypatch):
    video, fs_db, _ = env
    (video.parent / "Movie.en.srt").write_bytes(srt("Old"))
    (video.parent / "Movie.en.generated.srt").write_bytes(srt("Gen"))
    use(monkeypatch, FakeProvider("subf2m", files={"a": srt("New"), "b": srt("Newer")}))
    sr.run_subtitle_job(_job(fs_db), [item(video, "a")], True, False, None)
    assert (video.parent / "Movie.en.subf2m.srt").read_bytes() == srt("New")
    assert (video.parent / "Movie.en.srt").read_bytes() == srt("Old")
    assert (video.parent / "Movie.en.generated.srt").exists()
    sr.run_subtitle_job(_job(fs_db), [item(video, "b")], True, False, None)
    assert (video.parent / "Movie.en.subf2m-2.srt").read_bytes() == srt("Newer")
    assert (video.parent / "Movie.en.subf2m.srt").read_bytes() == srt("New")


def test_run_sync_after_and_row_sync_flag(env, monkeypatch):
    video, fs_db, synced = env
    other = video.parent / "Other.mkv"
    other.write_bytes(b"v")
    use(monkeypatch, FakeProvider("subf2m", files={"a": srt("A"), "b": srt("B")}))
    items = [item(video, "a"), item(other, "b")]
    sr.run_subtitle_job(_job(fs_db), items, False, True, "ffsubsync")
    assert synced == [
        (str(video.parent / "Movie.en.srt"), "ffsubsync"),
        (str(video.parent / "Other.en.srt"), "ffsubsync"),
    ]
    synced.clear()
    items = [item(video, "a"), item(other, "b", sync=True)]
    sr.run_subtitle_job(_job(fs_db), items, False, False, None)
    assert synced == [(str(video.parent / "Other.en.srt"), "alass")]  # the Settings default


def test_run_failure_isolated_and_results_stored(env, monkeypatch):
    video, fs_db, _ = env
    two = video.parent / "Two.mkv"
    three = video.parent / "Three.mkv"
    two.write_bytes(b"v")
    three.write_bytes(b"v")
    use(
        monkeypatch,
        FakeProvider(
            "subf2m",
            files={"a": srt("A"), "b": ProviderError("Subf2m did not answer in time"), "c": srt()},
        ),
    )
    jid = _job(fs_db)
    sr.run_subtitle_job(
        jid, [item(video, "a"), item(two, "b"), item(three, "c")], False, False, None
    )
    status, current, _err, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED
    assert "1 failed" in current
    results = settings["results"]
    assert [r["status"] for r in results] == ["saved", "failed", "saved"]
    assert results[1]["error"] == "Subf2m did not answer in time"
    assert (video.parent / "Movie.en.srt").exists() and (video.parent / "Three.en.srt").exists()
    assert not (video.parent / "Two.en.srt").exists()


def test_run_all_failed_is_failed_with_first_reason(env, monkeypatch):
    video, fs_db, _ = env
    use(monkeypatch, FakeProvider("subf2m", files={"a": b"<html>not a subtitle</html>"}))
    jid = _job(fs_db)
    sr.run_subtitle_job(jid, [item(video)], False, False, None)
    status, _cur, err, settings = _state(fs_db, jid)
    assert status == JobStatus.FAILED
    assert err == "The download is not a readable subtitle file."
    assert settings["results"][0]["status"] == "failed"


def test_run_cancel_reports_progress(env, monkeypatch):
    video, fs_db, _ = env
    jid = _job(fs_db)
    two = video.parent / "Two.mkv"
    two.write_bytes(b"v")

    def first():
        request_cancel(jid)
        return srt("A")

    use(monkeypatch, FakeProvider("subf2m", files={"a": first, "b": srt("B")}))
    sr.run_subtitle_job(jid, [item(video, "a"), item(two, "b")], False, False, None)
    status, current, _err, settings = _state(fs_db, jid)
    assert status == JobStatus.CANCELLED
    assert current == "1 of 2 done before cancel"
    assert [r["status"] for r in settings["results"]] == ["saved", "skipped"]
    assert not (video.parent / "Two.en.srt").exists()


def test_run_requires_items_and_existing_videos(client, tmp_path, monkeypatch):
    queued = []

    async def fake_enqueue(*a):
        queued.append(a)

    monkeypatch.setattr("app.api.subtitle_run.enqueue", fake_enqueue)
    video = tmp_path / "Movie.mkv"
    video.write_bytes(b"v")
    r = client.post("/api/subtitles/run", json={"path": str(tmp_path), "items": []})
    assert r.status_code == 422
    missing = item(tmp_path / "Gone.mkv")
    r = client.post("/api/subtitles/run", json={"path": str(tmp_path), "items": [missing]})
    assert r.status_code == 400
    bad_lang = item(video, lang="../../x")
    r = client.post("/api/subtitles/run", json={"path": str(tmp_path), "items": [bad_lang]})
    assert r.status_code == 422
    assert queued == []
    r = client.post(
        "/api/subtitles/run",
        json={"path": str(tmp_path), "items": [item(video)], "sync_after": True},
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert len(queued) == 1 and queued[0][0] == job_id
    assert queued[0][2:] == (job_id, [item(video)], False, True, None)


def test_search_route_returns_entries(client, tmp_path, monkeypatch):
    video = tmp_path / "Show.S01E01.mkv"
    video.write_bytes(b"v")
    use(
        monkeypatch,
        FakeProvider("yts", media_types=("movie",)),
        FakeProvider("subf2m", results=[{"score": 1, "subtitle_id": "a"}]),
    )
    r = client.post(
        "/api/subtitles/search",
        json={
            "video_path": str(video),
            "identity": {"title": "Show", "year": None, "type": "tv"},
            "languages": ["en"],
            "providers": ["yts", "subf2m"],
            "season": 1,
            "episode": 1,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["errors"] == [{"provider": "yts", "message": "Films only"}]
    assert [c["subtitle_id"] for c in body["candidates"]] == ["a"]


def test_two_runs_same_target_do_not_corrupt(tmp_path):
    video = tmp_path / "Movie.mkv"
    video.write_bytes(b"v")
    payloads = [srt("A" * 2000, 300), srt("B" * 2000, 300)]
    errors = []

    def write(data):
        try:
            for _ in range(5):
                sr.save_subtitle(str(video), "en", "subf2m", data, ".srt", keep_existing=False)
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=write, args=(p,)) for p in payloads]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert (tmp_path / "Movie.en.srt").read_bytes() in payloads
    assert [n for n in os.listdir(tmp_path) if n.endswith(".tmp")] == []


def test_old_folder_download_runs_through_the_new_run(env, monkeypatch):
    video, fs_db, synced = env
    (video.parent / "Done.mkv").write_bytes(b"v")
    (video.parent / "Done.en.srt").write_bytes(srt("Have"))
    sub = FakeProvider(
        "subf2m",
        results=[
            {"provider": "subf2m", "language": "en", "subtitle_id": "a", "score": 5},
            {"provider": "subf2m", "language": "en", "subtitle_id": "worse", "score": 1},
        ],
        files={"a": srt("New")},
    )
    use(monkeypatch, sub)
    jid = _job(fs_db)
    sr.run_folder_download(jid, str(video.parent), ["en"])
    assert (video.parent / "Movie.en.srt").read_bytes() == srt("New")
    assert (video.parent / "Done.en.srt").read_bytes() == srt("Have")
    assert sub.searches == 1 and sub.downloads == ["a"]
    status, _cur, _err, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED
    assert [r["status"] for r in settings["results"]] == ["saved"]
    assert synced == []
