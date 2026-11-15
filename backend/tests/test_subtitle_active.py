"""GET /subtitles/active: running and waiting subtitle work, grouped by folder."""

import json

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.job import Job, JobStatus, JobType
from app.models.settings import set_setting


@pytest.fixture
def jobs(engine, monkeypatch):
    Session = sessionmaker(bind=engine)
    # The route opens its own short-lived session; point it at the test database.
    monkeypatch.setattr("app.database.SessionLocal", Session)

    def add(type_, status, settings="__path__", path="/m/a", **kw):
        s = Session()
        try:
            if settings == "__path__":
                settings = json.dumps({"path": path})
            j = Job(type=type_, status=status, settings=settings, **kw)
            s.add(j)
            s.commit()
            return j.id
        finally:
            s.close()

    yield add
    s = Session()
    try:
        s.query(Job).delete()
        set_setting(s, "max_concurrent_jobs", "1")
        s.commit()
    finally:
        s.close()


def test_active_groups_by_folder_and_types(client, jobs):
    a = jobs(JobType.SUBTITLE_DOWNLOAD, JobStatus.RUNNING, path="/m/a", progress=0.5)
    b = jobs(JobType.SUBTITLE_SYNC, JobStatus.RUNNING, path="/m/b", current_file="x.mkv")
    c = jobs(JobType.SUBTITLE_TRANSLATE, JobStatus.RUNNING, path="/m/a")
    d = jobs(JobType.SUBTITLE_GENERATE, JobStatus.RUNNING, path="/m/a")
    r = client.get("/api/subtitles/active")
    assert r.status_code == 200
    groups = {g["path"]: g["jobs"] for g in r.json()}
    assert [j["id"] for j in groups["/m/a"]] == [a, c, d]
    assert groups["/m/a"][0]["type"] == "subtitle_download"
    assert groups["/m/a"][0]["progress"] == 0.5
    assert groups["/m/a"][0]["status"] == "running"
    assert groups["/m/b"][0]["id"] == b
    assert groups["/m/b"][0]["current_file"] == "x.mkv"
    assert groups["/m/b"][0]["queue_position"] is None


def test_active_ignores_finished_and_other_types(client, jobs):
    jobs(JobType.COMPRESS, JobStatus.RUNNING)
    jobs(JobType.SUBTITLE_DOWNLOAD, JobStatus.COMPLETED)
    jobs(JobType.SUBTITLE_SYNC, JobStatus.FAILED)
    assert client.get("/api/subtitles/active").json() == []


def test_active_survives_bad_settings_json(client, jobs):
    jobs(JobType.SUBTITLE_SYNC, JobStatus.RUNNING, settings="{not json")
    jobs(JobType.SUBTITLE_SYNC, JobStatus.RUNNING, settings=None)
    jobs(JobType.SUBTITLE_SYNC, JobStatus.RUNNING, settings=json.dumps({"items": []}))
    jobs(JobType.SUBTITLE_SYNC, JobStatus.RUNNING, settings=json.dumps([1]))
    ok = jobs(JobType.SUBTITLE_SYNC, JobStatus.RUNNING, path="/m/ok")
    r = client.get("/api/subtitles/active")
    assert r.status_code == 200
    assert [(g["path"], g["jobs"][0]["id"]) for g in r.json()] == [("/m/ok", ok)]


def test_queue_position_counts_pending_ahead(client, jobs, engine):
    s = sessionmaker(bind=engine)()
    set_setting(s, "max_concurrent_jobs", "1")
    s.commit()
    s.close()
    jobs(JobType.SUBTITLE_SYNC, JobStatus.RUNNING)
    other = jobs(JobType.COMPRESS, JobStatus.PENDING)  # a pending job of another type counts
    p1 = jobs(JobType.SUBTITLE_DOWNLOAD, JobStatus.PENDING)
    p2 = jobs(JobType.SUBTITLE_TRANSLATE, JobStatus.PENDING)
    pos = {
        j["id"]: j["queue_position"]
        for g in client.get("/api/subtitles/active").json()
        for j in g["jobs"]
    }
    assert other not in pos
    assert pos[p1] == 2 and pos[p2] == 3


def test_queue_position_none_while_a_slot_is_free(client, jobs, engine):
    s = sessionmaker(bind=engine)()
    set_setting(s, "max_concurrent_jobs", "2")
    s.commit()
    s.close()
    jobs(JobType.SUBTITLE_SYNC, JobStatus.RUNNING)
    p = jobs(JobType.SUBTITLE_DOWNLOAD, JobStatus.PENDING)
    out = client.get("/api/subtitles/active").json()
    assert [j["queue_position"] for g in out for j in g["jobs"] if j["id"] == p] == [None]


def test_translate_and_generate_store_path(client, tmp_path, monkeypatch):
    from app.api import subtitles

    assert "path" in subtitles.TranslateRequest.model_fields
    assert "path" in subtitles.GenerateRequest.model_fields


def test_active_requires_auth(anon_client):
    assert anon_client.get("/api/subtitles/active").status_code == 401
