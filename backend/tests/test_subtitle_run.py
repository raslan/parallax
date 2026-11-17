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


def test_cache_key_differs_by_subf2m_path():
    def q(path):
        return SearchQuery(
            identity=Identity("Movie", 2020, "movie", subf2m_path=path),
            languages=("en",),
            season=None,
            episode=None,
            video_path=None,
        )

    assert sr._cache_key("subf2m", q("/subtitles/a")) != sr._cache_key("subf2m", q("/subtitles/b"))
    assert sr._cache_key("subf2m", q("/subtitles/a")) != sr._cache_key("subf2m", q(None))


def test_tv_candidates_get_release_kind_and_episode_first(monkeypatch):
    sub = FakeProvider(
        "subf2m",
        results=[
            {"score": 80, "subtitle_id": "pack", "release": "Show S01-S02-S03-S04 Web-dl"},
            {"score": 50, "subtitle_id": "ep", "release": "Show.S01E01.720p.WEB"},
        ],
    )
    use(monkeypatch, sub)
    out = sr.search_candidates(query("tv"), ["subf2m"])
    assert [(c["subtitle_id"], c["release_kind"]) for c in out["candidates"]] == [
        ("ep", "episode"),
        ("pack", "season_pack"),
    ]


def test_movie_candidates_have_no_release_kind_and_keep_score_order(monkeypatch):
    sub = FakeProvider(
        "subf2m",
        results=[
            {"score": 20, "subtitle_id": "low", "release": "Movie.2020.S01E01"},
            {"score": 80, "subtitle_id": "high", "release": "Movie.2020.720p"},
        ],
    )
    use(monkeypatch, sub)
    out = sr.search_candidates(query("movie", imdb="tt1"), ["subf2m"])
    assert [c["subtitle_id"] for c in out["candidates"]] == ["high", "low"]
    assert all("release_kind" not in c for c in out["candidates"])


def test_ranking_uses_video_name_from_query(monkeypatch):
    sub = FakeProvider(
        "subf2m",
        results=[
            {"score": 80, "subtitle_id": "other", "release": "Show.S01E01.720p.WEB.x264-XYZ"},
            {"score": 20, "subtitle_id": "same", "release": "Show.S01E01.1080p.BluRay.x264-GRP"},
        ],
    )
    use(monkeypatch, sub)
    q = query("tv")
    q = SearchQuery(
        identity=q.identity,
        languages=q.languages,
        season=1,
        episode=1,
        video_path="/v/Show.S01E01.1080p.BluRay.x264-GRP.mkv",
    )
    out = sr.search_candidates(q, ["subf2m"])
    assert out["candidates"][0]["subtitle_id"] == "same"
    no_path = SearchQuery(
        identity=q.identity, languages=q.languages, season=1, episode=1, video_path=None
    )
    sr._CACHE.clear()
    out = sr.search_candidates(no_path, ["subf2m"])
    assert out["candidates"][0]["subtitle_id"] == "other"  # nothing to match: score decides


def test_cached_results_are_not_changed_by_ranking(monkeypatch):
    sub = FakeProvider("subf2m", results=[{"score": 1, "subtitle_id": "a", "release": "S01E01"}])
    use(monkeypatch, sub)
    sr.search_candidates(query("tv"), ["subf2m"])
    ((_, cached),) = sr._CACHE.values()
    assert "release_kind" not in cached[0]


def test_network_error_is_flagged(monkeypatch):
    from app.services.subtitle_providers import ProviderNetworkError

    down = FakeProvider("yts", media_types=("movie",), error=ProviderNetworkError("no route"))
    rude = FakeProvider("subf2m", error=ProviderError("Subf2m refused the request (403)"))
    use(monkeypatch, down, rude)
    out = sr.search_candidates(query("movie", imdb="tt1"), ["yts", "subf2m"])
    assert out["errors"] == [
        {"provider": "yts", "message": "no route", "network": True},
        {"provider": "subf2m", "message": "Subf2m refused the request (403)"},
    ]


def test_force_bypasses_the_cache_read(monkeypatch):
    sub = FakeProvider("subf2m", results=[{"score": 1, "subtitle_id": "a"}])
    use(monkeypatch, sub)
    sr.search_candidates(query(), ["subf2m"])
    sr.search_candidates(query(), ["subf2m"])
    assert sub.searches == 1
    sr.search_candidates(query(), ["subf2m"], force=True)
    assert sub.searches == 2
    sr.search_candidates(query(), ["subf2m"])  # the forced search still wrote the cache
    assert sub.searches == 2


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
    unknown = item(video, provider="nosuchsite")
    r = client.post("/api/subtitles/run", json={"path": str(tmp_path), "items": [unknown]})
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


ASS = b"[Script Info]\nTitle: x\n\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi\n"


def test_keep_existing_two_ass_downloads_both_survive(env, monkeypatch):
    video, fs_db, _ = env
    (video.parent / "Movie.en.ass").write_bytes(b"[Script Info]\nold\n")
    use(monkeypatch, FakeProvider("subf2m", files={"a": ASS + b"; one", "b": ASS + b"; two"}))
    sr.run_subtitle_job(_job(fs_db), [item(video, "a")], True, False, None)
    sr.run_subtitle_job(_job(fs_db), [item(video, "b")], True, False, None)
    assert (video.parent / "Movie.en.subf2m.ass").read_bytes() == ASS + b"; one"
    assert (video.parent / "Movie.en.subf2m-2.ass").read_bytes() == ASS + b"; two"
    assert (video.parent / "Movie.en.ass").read_bytes() == b"[Script Info]\nold\n"


def _srt_text(line):
    return f"1\n00:00:01,000 --> 00:00:02,000\n{line}\n\n2\n00:00:03,000 --> 00:00:04,000\nOK\n\n"


def _run_one(env, monkeypatch, data, lang="en"):
    video, fs_db, _ = env
    use(monkeypatch, FakeProvider("subf2m", files={"a": data}))
    jid = _job(fs_db)
    sr.run_subtitle_job(jid, [item(video, lang=lang)], False, False, None)
    status, _c, err, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED, err
    return (video.parent / f"Movie.{lang}.srt").read_bytes()


def test_cp1250_polish_saved_byte_for_byte(env, monkeypatch):
    data = _srt_text("Zażółć gęślą jaźń").encode("cp1250")
    with pytest.raises(UnicodeDecodeError):
        data.decode("utf-8")
    assert _run_one(env, monkeypatch, data, lang="pl") == data


def test_utf16_bom_saved_as_readable_utf8(env, monkeypatch):
    text = _srt_text("Grüße")
    data = "﻿".encode("utf-16-le") + text.encode("utf-16-le")
    assert _run_one(env, monkeypatch, data) == text.encode("utf-8")


def test_cp1256_arabic_reencoded_to_utf8(env, monkeypatch):
    text = _srt_text("مرحبا بالعالم")
    assert _run_one(env, monkeypatch, text.encode("cp1256"), lang="ar") == text.encode("utf-8")


def test_plain_utf8_saved_intact(env, monkeypatch):
    data = _srt_text("Café — naïve").encode("utf-8")
    assert _run_one(env, monkeypatch, data) == data


def test_cleanup_failure_after_save_keeps_item_saved(env, monkeypatch):
    video, fs_db, _ = env
    (video.parent / "Movie.en.generated.srt").write_bytes(srt("Gen"))

    def boom(*a):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(sr.subtitle_service, "remove_machine_made", boom)
    use(monkeypatch, FakeProvider("subf2m", files={"a": srt("New")}))
    jid = _job(fs_db)
    sr.run_subtitle_job(jid, [item(video)], False, False, None)
    status, _c, _e, settings = _state(fs_db, jid)
    assert status == JobStatus.COMPLETED
    (result,) = settings["results"]
    assert result["status"] == "saved"
    assert "Permission denied" in result["cleanup_error"]
    assert (video.parent / "Movie.en.srt").read_bytes() == srt("New")


def test_search_cache_is_capped_and_drops_expired(monkeypatch):
    sub = FakeProvider("subf2m", results=[])
    use(monkeypatch, sub)
    t = [0.0]

    def q(title):
        return SearchQuery(Identity(title, None, "movie"), ("en",), None, None, None)

    for n in range(sr.CACHE_MAX_ENTRIES + 1):
        t[0] += 0.001
        sr.search_candidates(q(f"T{n}"), ["subf2m"], clock=lambda: t[0])
    assert sr.CACHE_MAX_ENTRIES == 512
    assert len(sr._CACHE) == 512
    searches = sub.searches
    sr.search_candidates(q("T0"), ["subf2m"], clock=lambda: t[0])  # the oldest was dropped
    assert sub.searches == searches + 1
    t[0] += sr.CACHE_TTL_SECONDS + 1
    sr.search_candidates(q("fresh"), ["subf2m"], clock=lambda: t[0])
    assert len(sr._CACHE) == 1
