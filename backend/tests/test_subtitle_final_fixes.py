"""Fixes from the final whole-branch review of the Subtitles redesign."""

import json
import os
import threading

import pytest

from app.models.job import Job, JobStatus, JobType
from app.services import subtitle_files as sf
from app.services import subtitle_service as svc
from app.services import subtitle_sync as ss

SRT = "1\n00:00:01,000 --> 00:00:02,000\nHi.\n\n"


def touch(path, text=SRT):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return str(path)


def _no_walk(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("os.walk must not run for a non-video path")

    monkeypatch.setattr(os, "walk", boom)


# ---------------------------------------------------------------- B1


@pytest.mark.parametrize(
    "route, body",
    [
        ("sync-file", {}),
        ("translate", {"language": "ar"}),
        ("generate", {}),
    ],
)
def test_non_video_path_is_refused_before_any_walk(client, tmp_path, monkeypatch, route, body):
    txt = touch(tmp_path / "vmlinuz")
    _no_walk(monkeypatch)
    payload = {"file_path": txt} if route == "sync-file" else {"file_paths": [txt]}
    r = client.post(f"/api/subtitles/{route}", json={**payload, **body})
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "That is not a video file."


# ---------------------------------------------------------------- B2


def test_sync_files_precheck_walks_each_folder_once(client, tmp_path, monkeypatch):
    videos = []
    for i in range(3):
        videos.append(touch(tmp_path / f"V{i}.mkv", "v"))
    calls = []
    real = svc._subtitle_search_dirs
    monkeypatch.setattr(svc, "_subtitle_search_dirs", lambda p: calls.append(p) or real(p))
    r = client.post("/api/subtitles/sync-files", json={"video_paths": videos})
    assert r.status_code == 422
    assert len(calls) == 1


# ---------------------------------------------------------------- B3


def _assert_lock_free_walk(monkeypatch, walked):
    real = os.walk

    def walk(*a, **k):
        walked.append(sf._WRITE_LOCK._is_owned())
        return real(*a, **k)

    monkeypatch.setattr(os, "walk", walk)


def test_tidy_walks_without_the_write_lock(tmp_path, monkeypatch):
    video = touch(tmp_path / "M.mkv", "v")
    touch(tmp_path / "M.en.generated.srt")
    walked = []
    _assert_lock_free_walk(monkeypatch, walked)
    assert sf.tidy([video], "generated_translated") == 1
    assert walked and not any(walked)


def test_unmatched_actions_walk_without_the_write_lock(tmp_path, monkeypatch):
    root = tmp_path / "lib"
    touch(root / "Show.mkv", "v")
    stray = touch(root / "Subs" / "2_English.srt")
    other = touch(root / "Subs" / "3_Arabic.srt")
    walked = []
    _assert_lock_free_walk(monkeypatch, walked)
    new = sf.rename_unmatched(str(root), stray, "Fixed.srt")["path"]
    assert os.path.exists(new)
    assert sf.delete_unmatched(str(root), [other]) == 1
    assert walked and not any(walked)


def test_lock_is_not_held_by_a_walking_thread(tmp_path, monkeypatch):
    video = touch(tmp_path / "M.mkv", "v")
    touch(tmp_path / "M.en.generated.srt")
    inside, release = threading.Event(), threading.Event()
    real = os.walk

    def walk(*a, **k):
        inside.set()
        release.wait(5)
        return real(*a, **k)

    monkeypatch.setattr(os, "walk", walk)
    t = threading.Thread(target=sf.tidy, args=([video], "generated_translated"))
    t.start()
    assert inside.wait(5)
    got = []

    def other():
        got.append(sf._WRITE_LOCK.acquire(timeout=1))
        if got[0]:
            sf._WRITE_LOCK.release()

    o = threading.Thread(target=other)
    o.start()
    o.join()
    release.set()
    t.join()
    assert got == [True]


# ---------------------------------------------------------------- B4


def test_extra_versions_keeps_a_hearing_impaired_file_that_is_not_an_extra(tmp_path):
    video = touch(tmp_path / "M.mkv", "v")
    touch(tmp_path / "M.en.srt")
    hi = touch(tmp_path / "M.en.hi.subf2m.srt")
    extra = touch(tmp_path / "M.en.subf2m.srt")
    assert sf.tidy([video], "extra_versions") == 1
    assert os.path.exists(hi) and not os.path.exists(extra)


def test_extra_versions_still_removes_a_labelled_hi_beside_a_plain_hi(tmp_path):
    video = touch(tmp_path / "M.mkv", "v")
    touch(tmp_path / "M.en.hi.srt")
    extra = touch(tmp_path / "M.en.hi.subf2m.srt")
    assert sf.tidy([video], "extra_versions") == 1
    assert not os.path.exists(extra)


# ---------------------------------------------------------------- B5


def test_find_subtitle_path_never_serves_a_backup(tmp_path):
    video = touch(tmp_path / "M.mkv", "v")
    real = touch(tmp_path / "M.en.srt")
    touch(tmp_path / "M.en.original.srt")
    assert svc.find_subtitle_path(video) == real


def test_find_subtitle_path_prefers_real_over_machine_made(tmp_path):
    video = touch(tmp_path / "M.mkv", "v")
    touch(tmp_path / "M.en.generated.srt")
    labelled = touch(tmp_path / "M.en.subf2m.srt")
    assert svc.find_subtitle_path(video) == labelled
    plain = touch(tmp_path / "M.en.srt")
    assert svc.find_subtitle_path(video) == plain


def test_find_subtitle_path_falls_back_to_machine_made(tmp_path):
    video = touch(tmp_path / "M.mkv", "v")
    gen = touch(tmp_path / "M.en.generated.srt")
    touch(tmp_path / "M.en.original.srt")
    assert svc.find_subtitle_path(video) == gen


# ---------------------------------------------------------------- B6


def _engine(monkeypatch, inspect):
    monkeypatch.setattr(ss, "ensure_alass", lambda: None)
    monkeypatch.setattr(ss, "_alass_bin", lambda: "alass")

    def fake_run(cmd, label, tmp_out):
        inspect(tmp_out)
        with open(tmp_out, "w") as f:
            f.write(SRT)

    monkeypatch.setattr(ss, "_run_synced", fake_run)


def test_sync_temp_file_is_hidden_and_never_listed(tmp_path, monkeypatch):
    video = touch(tmp_path / "Movie.mkv", "v")
    sub = touch(tmp_path / "Movie.en.srt")
    seen = {}

    def inspect(tmp_out):
        seen["tmp"] = tmp_out
        open(tmp_out, "w").write(SRT)  # it exists while the engine runs
        seen["listed"] = [f["name"] for f in sf.list_subtitle_files(video)]
        seen["tracks"] = [os.path.basename(t["path"]) for t in svc.find_all_subtitle_tracks(video)]
        seen["vtt"] = svc.find_subtitle_path(video)

    _engine(monkeypatch, inspect)
    assert ss.sync_alass(video, sub)
    name = os.path.basename(seen["tmp"])
    assert name.startswith(".") and name.endswith(".srt")
    assert name not in seen["listed"] and name not in seen["tracks"]
    assert seen["vtt"] == sub
    assert not os.path.exists(seen["tmp"])
    assert sorted(os.listdir(tmp_path)) == ["Movie.en.srt", "Movie.mkv"]


def test_sync_temp_names_are_unique_per_run(tmp_path):
    sub = str(tmp_path / "Movie.en.srt")
    assert ss._sync_tmp_path(sub) != ss._sync_tmp_path(sub)


def test_hidden_files_are_never_claimed_as_subtitles(tmp_path):
    video = touch(tmp_path / "Movie.mkv", "v")
    touch(tmp_path / "Movie.en.srt")
    touch(tmp_path / ".Movie.en.abcd.srt")
    assert [f["name"] for f in sf.list_subtitle_files(video)] == ["Movie.en.srt"]


# ---------------------------------------------------------------- B7


def test_imdb_id_must_look_like_one():
    from pydantic import ValidationError

    from app.api.subtitle_run import IdentityModel

    ok = IdentityModel(title="X", type="movie", imdb_id="tt0111161")
    assert ok.imdb_id == "tt0111161"
    assert IdentityModel(title="X", type="movie").imdb_id is None
    for bad in ("tt1; rm", "0111161", "tt12", "../tt0111161"):
        with pytest.raises(ValidationError):
            IdentityModel(title="X", type="movie", imdb_id=bad)


# ---------------------------------------------------------------- B8


def test_single_file_sync_job_cancelled_while_waiting_does_nothing(tmp_path, fs_db, monkeypatch):
    video = touch(tmp_path / "A.mkv", "v")
    sub = touch(tmp_path / "A.en.srt")
    called = []
    monkeypatch.setattr(ss, "sync_subtitle", lambda *a, **k: called.append(a) or True)
    db = fs_db()
    job = Job(type=JobType.SUBTITLE_SYNC, status=JobStatus.CANCELLED, settings=json.dumps({}))
    db.add(job)
    db.commit()
    jid = job.id
    db.close()
    ss.run_sync_job(jid, [(video, sub)], "alass")
    db = fs_db()
    assert db.get(Job, jid).status == JobStatus.CANCELLED
    db.close()
    assert called == []


# ---------------------------------------------------------------- B9


def test_last_cue_reads_at_most_the_cap(tmp_path, monkeypatch):
    from app.services import subtitle_lengths as sl
    from app.services.subtitle_providers import MAX_SUBTITLE_BYTES

    big = tmp_path / "big.srt"
    big.write_bytes(SRT.encode() + b"x" * (MAX_SUBTITLE_BYTES + 10))
    assert sl._last_cue(str(big)) is None
    small = tmp_path / "small.srt"
    small.write_text(SRT)
    assert sl._last_cue(str(small)) == 2.0


# ---------------------------------------------------------------- B10


def test_create_preview_closes_its_provider(tmp_path, monkeypatch):
    from app.services import subtitle_preview as sp
    from app.services.subtitle_providers import ProviderError

    monkeypatch.setattr(sp, "PREVIEW_DIR", str(tmp_path / "previews"))
    closed = []

    class P:
        def __init__(self, data):
            self.data = data

        def fetch(self, i):
            return self.data

        def extract(self, raw, season=None, episode=None):
            return raw

        def close(self):
            closed.append(1)

    monkeypatch.setattr(sp, "get_provider", lambda n: P(SRT.encode()))
    sp.create_preview("/v/M.mkv", "yts", "x", "en")
    assert closed == [1]
    monkeypatch.setattr(sp, "get_provider", lambda n: P(None))
    with pytest.raises(ProviderError):  # another candidate: the first one is cached
        sp.create_preview("/v/M.mkv", "yts", "y", "en")
    assert closed == [1, 1]


# ---------------------------------------------------------------- B11


def test_yts_poster_urls_are_https_or_dropped(monkeypatch):
    from app.services import ytssubs_provider as yp

    def card(src):
        return (
            '<ul class="media-list"><li class="media-movie-clickable">'
            f'<a href="/movie-imdb/tt0111161"><img class="media-object" src="{src}"></a>'
            '<h3 class="media-heading">X</h3></li></ul>'
        )

    pages = {}
    provider = yp.YtsSubsProvider()
    monkeypatch.setattr(provider, "_get_text", lambda url, timeout=20: pages["p"])
    pages["p"] = card("/img/cover-1994-tt0111161.jpg")
    assert provider.search_titles("x")[0]["poster_url"] == (
        "https://yts-subs.com/img/cover-1994-tt0111161.jpg"
    )
    pages["p"] = card("http://evil.example/p.jpg")
    assert provider.search_titles("x")[0]["poster_url"] is None
    pages["p"] = card("https://yts-subs.com/img/c.jpg")
    assert provider.search_titles("x")[0]["poster_url"] == "https://yts-subs.com/img/c.jpg"
    provider.close()
