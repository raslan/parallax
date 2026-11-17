"""POST /subtitles/searches: start the search job for a folder."""

import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.job import Job, JobStatus, JobType


@pytest.fixture
def queued(monkeypatch):
    calls = []

    async def fake_enqueue(*a):
        calls.append(a)

    monkeypatch.setattr("app.api.subtitle_run.enqueue", fake_enqueue)
    return calls


@pytest.fixture
def jobs(engine):
    Session = sessionmaker(bind=engine)

    def search_jobs():
        s = Session()
        try:
            return [
                (j.id, j.status, json.loads(j.settings), j.total_files)
                for j in s.query(Job).filter(Job.type == JobType.SUBTITLE_SEARCH).order_by(Job.id)
            ]
        finally:
            s.close()

    yield search_jobs
    s = Session()
    try:
        s.query(Job).delete()
        s.commit()
    finally:
        s.close()


def body(folder, videos, **over):
    rows = [
        {
            "key": f"{v}\0en",
            "title_key": "t1",
            "video_path": str(v),
            "language": "en",
            "season": 1,
            "episode": i,
        }
        for i, v in enumerate(videos, 1)
    ]
    base = {
        "path": str(folder),
        "providers": ["subf2m"],
        "languages": ["en"],
        "scope": "missing",
        "check_lengths": True,
        "save": None,
        "titles": [
            {
                "key": "t1",
                "identity": {"title": "Show", "year": 2016, "type": "tv"},
                "certain": True,
            }
        ],
        "rows": rows,
    }
    base.update(over)
    return base


@pytest.fixture
def folder(tmp_path):
    d = tmp_path / "Show"
    d.mkdir()
    return d


@pytest.fixture
def videos(folder):
    out = []
    for n in (1, 2):
        v = folder / f"Show.S01E0{n}.mkv"
        v.write_bytes(b"v")
        out.append(v)
    return out


def test_creating_returns_a_job_id_and_a_pending_job_with_every_row_pending(
    client, queued, jobs, folder, videos
):
    r = client.post("/api/subtitles/searches", json=body(folder, videos))
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    [(jid, status, settings, total)] = jobs()
    assert (jid, status, total) == (job_id, JobStatus.PENDING, 2)
    assert settings["path"] == str(folder)
    assert settings["providers"] == ["subf2m"] and settings["check_lengths"] is True
    assert settings["save"] is None
    assert settings["titles"][0]["certain"] is True
    results = settings["results"]
    assert list(results) == [f"{v}\0en" for v in videos]
    first = results[f"{videos[0]}\0en"]
    assert first["state"] == "pending" and first["candidates"] == [] and first["length"] is None
    assert first["video_path"] == str(videos[0]) and first["episode"] == 1
    assert [c[0] for c in queued] == [job_id] and queued[0][2] == job_id


def test_a_second_search_for_the_same_folder_is_refused_and_creates_nothing(
    client, queued, jobs, folder, videos
):
    assert client.post("/api/subtitles/searches", json=body(folder, videos)).status_code == 202
    r = client.post("/api/subtitles/searches", json=body(folder, videos))
    assert r.status_code == 409
    assert r.json()["detail"] == "A search is already running for this folder"
    assert len(jobs()) == 1 and len(queued) == 1


def test_a_finished_search_does_not_block_a_new_one(client, queued, jobs, folder, videos, engine):
    r = client.post("/api/subtitles/searches", json=body(folder, videos))
    S = sessionmaker(bind=engine)
    s = S()
    s.get(Job, r.json()["job_id"]).status = JobStatus.COMPLETED
    s.commit()
    s.close()
    assert client.post("/api/subtitles/searches", json=body(folder, videos)).status_code == 202


def test_a_different_folder_gets_its_own_job(client, queued, jobs, folder, videos, tmp_path):
    other = tmp_path / "Other"
    other.mkdir()
    video = other / "Other.S01E01.mkv"
    video.write_bytes(b"v")
    assert client.post("/api/subtitles/searches", json=body(folder, videos)).status_code == 202
    assert client.post("/api/subtitles/searches", json=body(other, [video])).status_code == 202
    assert len(jobs()) == 2


def test_two_simultaneous_requests_for_one_folder_make_one_job(
    client, queued, jobs, folder, videos
):
    def post(_):
        return client.post("/api/subtitles/searches", json=body(folder, videos)).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = sorted(pool.map(post, range(2)))
    assert codes == [202, 409]
    assert len(jobs()) == 1


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.update(rows=[]),
        lambda b: b.update(rows=b["rows"] * 2500 + b["rows"][:1]),  # 5001
        lambda b: b["rows"][0].update(title_key="nope"),
        lambda b: b["rows"][0].update(language="de"),  # not one of the languages
        lambda b: b.update(providers=["nosuchsite"]),
        lambda b: b.update(providers=[]),
        lambda b: b.update(
            save={"keep_existing": False, "sync_after": False, "engine": None}, check_lengths=False
        ),
        lambda b: b.update(scope="everything"),
        lambda b: b["rows"][1].update(key=b["rows"][0]["key"]),  # duplicate row key
    ],
)
def test_validation_refuses_a_bad_request_and_creates_nothing(
    client, queued, jobs, folder, videos, mutate
):
    b = body(folder, videos)
    mutate(b)
    assert client.post("/api/subtitles/searches", json=b).status_code == 422
    assert jobs() == [] and queued == []


def test_a_path_that_is_not_a_video_is_refused(client, queued, jobs, folder, videos, tmp_path):
    readme = tmp_path / "notes.txt"
    readme.write_text("hi")
    r = client.post("/api/subtitles/searches", json=body(folder, [readme]))
    assert r.status_code == 400 and jobs() == []


def test_a_video_that_is_gone_is_refused(client, queued, jobs, folder, videos):
    r = client.post("/api/subtitles/searches", json=body(folder, [folder / "Gone.mkv"]))
    assert r.status_code == 400 and jobs() == []


def test_save_with_checked_lengths_is_accepted_and_stored(client, queued, jobs, folder, videos):
    save = {"keep_existing": True, "sync_after": False, "engine": "ffsubsync"}
    r = client.post("/api/subtitles/searches", json=body(folder, videos, save=save))
    assert r.status_code == 202
    assert jobs()[0][2]["save"] == save


def test_a_search_needs_a_signed_in_user(anon_client, folder, videos):
    assert anon_client.post("/api/subtitles/searches", json=body(folder, videos)).status_code == 401
