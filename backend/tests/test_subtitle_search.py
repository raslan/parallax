"""The subtitle search job: search every row, check lengths, retry a dead network once."""

import json
import threading

import pytest

from app.models.job import Job, JobLog, JobStatus, JobType
from app.services import subtitle_search as ss
from app.services.common import request_cancel
from app.services.subtitle_providers import ProviderError, ProviderNetworkError


def cand(n, release_kind="episode", provider="subf2m", score=50):
    return {
        "provider": provider,
        "subtitle_id": f"id{n}",
        "release": f"Show.S01E01.{n}",
        "score": score,
        "language": "en",
        "hearing_impaired": False,
        "release_kind": release_kind,
    }


def row_key(name, lang="en"):
    return f"/v/{name}\0{lang}"


def make_settings(names, *, languages=("en",), check_lengths=True, save=None, certain=True):
    results = {}
    for i, name in enumerate(names, 1):
        for lang in languages:
            results[row_key(name, lang)] = {
                "title_key": "t1",
                "video_path": f"/v/{name}",
                "language": lang,
                "season": 1,
                "episode": i,
                "state": "pending",
                "candidates": [],
                "errors": [],
                "length": None,
                "outcome": None,
                "reason": None,
                "detail": None,
                "saved": None,
            }
    return {
        "path": "/v",
        "providers": ["subf2m"],
        "languages": list(languages),
        "scope": "missing",
        "check_lengths": check_lengths,
        "save": save,
        "titles": [
            {
                "key": "t1",
                "identity": {"title": "Show", "year": 2016, "type": "tv"},
                "certain": certain,
            }
        ],
        "results": results,
    }


@pytest.fixture
def env(fs_db, monkeypatch):
    """A search job row plus fakes for the sources, the probe, the check and the clock."""

    class Env:
        pass

    e = Env()
    e.db = fs_db
    e.events = []
    e.sleeps = []
    e.search_outcomes = {}  # (basename) -> outcome or list of outcomes (one per call)
    e.search_calls = []
    e.check_outcomes = {}
    e.duration = 3000.0

    def search(q, providers, clock=None, force=False):
        name = q.video_path.rsplit("/", 1)[-1]
        e.events.append(("search", name))
        e.search_calls.append((name, force))
        outcome = e.search_outcomes.get(name, {"candidates": [cand(1)], "errors": []})
        if isinstance(outcome, list):
            outcome = outcome.pop(0)
        if callable(outcome):
            outcome = outcome()
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def check(
        video_path,
        provider,
        subtitle_id,
        language,
        *,
        season=None,
        episode=None,
        video_duration=None,
    ):
        name = video_path.rsplit("/", 1)[-1]
        e.events.append(("check", name))
        outcome = e.check_outcomes.get(
            name,
            {
                "cues": 5,
                "first": 1.0,
                "last": 2900.0,
                "length": "ok",
                "video_duration": video_duration,
            },
        )
        if isinstance(outcome, list):
            outcome = outcome.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def probe(path):
        e.events.append(("probe", path.rsplit("/", 1)[-1]))
        return {"duration": e.duration, "probe_ok": True}

    monkeypatch.setattr(ss, "search_candidates", search)
    monkeypatch.setattr(ss, "check_candidate_length", check)
    monkeypatch.setattr(ss, "probe_metadata", probe)
    monkeypatch.setattr(ss, "_sleep", e.sleeps.append)

    def new_job(settings, status=JobStatus.PENDING):
        db = fs_db()
        job = Job(
            type=JobType.SUBTITLE_SEARCH,
            status=status,
            settings=json.dumps(settings),
            total_files=len(settings["results"]),
        )
        db.add(job)
        db.commit()
        jid = job.id
        db.close()
        return jid

    def load(jid):
        db = fs_db()
        job = db.get(Job, jid)
        out = {
            "status": job.status,
            "error": job.error,
            "current_file": job.current_file,
            "progress": job.progress,
            "processed": job.processed_files,
            "total": job.total_files,
            "settings": json.loads(job.settings or "{}"),
        }
        db.close()
        return out

    def logs(jid):
        db = fs_db()
        rows = [
            r.message for r in db.query(JobLog).filter(JobLog.job_id == jid).order_by(JobLog.id)
        ]
        db.close()
        return rows

    e.new_job, e.load, e.logs = new_job, load, logs
    return e


def rows_of(state):
    return state["settings"]["results"]


def test_searches_then_checks_in_order(env):
    jid = env.new_job(make_settings(["a.mkv", "b.mkv", "c.mkv"]))
    ss.run_subtitle_search_job(jid)
    kinds = [k for k, _ in env.events if k in ("search", "check")]
    assert kinds == ["search"] * 3 + ["check"] * 3  # every search before any check
    st = env.load(jid)
    assert st["status"] == JobStatus.COMPLETED
    assert {r["state"] for r in rows_of(st).values()} == {"checked"}
    assert all(r["length"]["verdict"] == "ok" for r in rows_of(st).values())
    assert st["current_file"] == "3 of 3 found"
    assert st["progress"] == 100.0
    assert st["total"] == 3 and st["processed"] == 3  # the check phase's own count


def test_progress_counts_follow_the_phase(env, monkeypatch):
    seen = {}

    def spy_first_check(video_path, *a, **k):
        if "check" not in seen:
            seen["check"] = env.load(jid)
        return {"cues": 5, "first": 1.0, "last": 2900.0, "length": "ok", "video_duration": 3000.0}

    jid = env.new_job(make_settings(["a.mkv", "b.mkv"]))
    monkeypatch.setattr(ss, "check_candidate_length", spy_first_check)
    ss.run_subtitle_search_job(jid)
    mid = seen["check"]
    assert mid["total"] == 2 and mid["processed"] == 0
    assert mid["current_file"] == "Checking length of a.mkv"
    assert 49 <= mid["progress"] <= 50  # the search half is done


def test_the_search_phase_names_the_video_being_searched(env, monkeypatch):
    seen = []

    def spy():
        seen.append(env.load(jid)["current_file"])
        return {"candidates": [cand(1)], "errors": []}

    env.search_outcomes["a.mkv"] = spy
    jid = env.new_job(make_settings(["a.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    assert seen == ["Searching a.mkv"]
    assert env.load(jid)["progress"] == 100.0


def test_check_lengths_off_leaves_rows_searched(env):
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    st = env.load(jid)
    assert st["status"] == JobStatus.COMPLETED
    assert {r["state"] for r in rows_of(st).values()} == {"searched"}
    assert not [k for k, _ in env.events if k in ("check", "probe")]


def test_rows_without_candidates_are_not_checked(env):
    env.search_outcomes["b.mkv"] = {"candidates": [], "errors": []}
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"]))
    ss.run_subtitle_search_job(jid)
    st = env.load(jid)
    assert rows_of(st)[row_key("b.mkv")]["state"] == "searched"
    assert rows_of(st)[row_key("a.mkv")]["state"] == "checked"
    assert [n for k, n in env.events if k == "check"] == ["a.mkv"]
    assert st["current_file"] == "1 of 2 found"


def net(msg="no route"):
    return {"candidates": [], "errors": [{"provider": "subf2m", "message": msg, "network": True}]}


def test_all_network_errors_retry_once_after_five_seconds(env):
    env.search_outcomes["a.mkv"] = [net(), {"candidates": [cand(1)], "errors": []}]
    jid = env.new_job(make_settings(["a.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    assert sum(env.sleeps) == 5.0
    assert env.search_calls == [("a.mkv", False), ("a.mkv", True)]  # the retry is forced
    row = rows_of(env.load(jid))[row_key("a.mkv")]
    assert row["state"] == "searched" and len(row["candidates"]) == 1


def test_second_network_failure_fails_only_that_row(env):
    env.search_outcomes["a.mkv"] = [net("no route"), net("still no route")]
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    st = env.load(jid)
    a, b = rows_of(st)[row_key("a.mkv")], rows_of(st)[row_key("b.mkv")]
    assert a["state"] == "failed"
    assert a["errors"][0]["message"] == "no route"  # the first message
    assert b["state"] == "searched"
    assert st["status"] == JobStatus.COMPLETED


def test_one_source_down_other_answers_is_searched_not_failed(env):
    env.search_outcomes["a.mkv"] = {
        "candidates": [cand(1, provider="yts")],
        "errors": [{"provider": "subf2m", "message": "no route", "network": True}],
    }
    s = make_settings(["a.mkv"], check_lengths=False)
    s["providers"] = ["subf2m", "yts"]
    jid = env.new_job(s)
    ss.run_subtitle_search_job(jid)
    row = rows_of(env.load(jid))[row_key("a.mkv")]
    assert row["state"] == "searched" and row["errors"][0]["provider"] == "subf2m"
    assert env.sleeps == []


def test_a_source_that_answers_badly_is_not_retried(env):
    env.search_outcomes["a.mkv"] = {
        "candidates": [],
        "errors": [{"provider": "subf2m", "message": "Subf2m refused the request (403)"}],
    }
    jid = env.new_job(make_settings(["a.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    assert env.sleeps == [] and len(env.search_calls) == 1
    row = rows_of(env.load(jid))[row_key("a.mkv")]
    assert row["state"] == "searched" and row["candidates"] == []


def test_check_download_connection_error_retries_once(env):
    env.check_outcomes["a.mkv"] = [
        ProviderNetworkError("no route"),
        {"cues": 5, "first": 1.0, "last": 2900.0, "length": "ok", "video_duration": 3000.0},
    ]
    jid = env.new_job(make_settings(["a.mkv"]))
    ss.run_subtitle_search_job(jid)
    assert sum(env.sleeps) == 5.0
    row = rows_of(env.load(jid))[row_key("a.mkv")]
    assert row["length"]["verdict"] == "ok"


def test_check_that_fails_twice_leaves_a_length_error_and_keeps_the_row(env):
    env.check_outcomes["a.mkv"] = [
        ProviderNetworkError("no route"),
        ProviderNetworkError("no route"),
    ]
    env.check_outcomes["b.mkv"] = ProviderError("The download is not a readable subtitle file.")
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"]))
    ss.run_subtitle_search_job(jid)
    rows = rows_of(env.load(jid))
    assert rows[row_key("a.mkv")]["length"] == {"error": "no route"}
    assert rows[row_key("b.mkv")]["length"] == {
        "error": "The download is not a readable subtitle file."
    }
    assert rows[row_key("a.mkv")]["state"] == "checked"


def test_all_rows_failed_fails_the_job(env):
    env.search_outcomes["a.mkv"] = ProviderError("The source is down")
    env.search_outcomes["b.mkv"] = ProviderError("The source is still down")
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"]))
    ss.run_subtitle_search_job(jid)
    st = env.load(jid)
    assert st["status"] == JobStatus.FAILED
    assert st["error"] == "The source is down"
    assert {r["state"] for r in rows_of(st).values()} == {"failed"}  # partial results kept


def test_one_failed_row_completes_the_job(env):
    env.search_outcomes["a.mkv"] = ProviderError("The source is down")
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    st = env.load(jid)
    assert st["status"] == JobStatus.COMPLETED
    assert st["current_file"] == "1 of 2 found"


def test_an_unexpected_error_in_one_row_costs_only_that_row(env):
    env.search_outcomes["a.mkv"] = KeyError("boom")
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    rows = rows_of(env.load(jid))
    assert rows[row_key("a.mkv")]["state"] == "failed"
    assert rows[row_key("a.mkv")]["errors"][0]["message"] == "The search failed (KeyError)"
    assert rows[row_key("b.mkv")]["state"] == "searched"


def test_hung_video_probe_fails_that_row_and_continues(env, monkeypatch):
    release = threading.Event()
    monkeypatch.setattr(ss, "ROW_DEADLINE_SECONDS", 0.2)

    def probe(path):
        if path.endswith("a.mkv"):
            release.wait(5)
        return {"duration": 3000.0, "probe_ok": True}

    monkeypatch.setattr(ss, "probe_metadata", probe)
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"]))
    try:
        ss.run_subtitle_search_job(jid)
    finally:
        release.set()
    st = env.load(jid)
    rows = rows_of(st)
    assert rows[row_key("a.mkv")]["length"] == {"error": "Could not read the video: a.mkv"}
    assert rows[row_key("b.mkv")]["length"]["verdict"] == "ok"
    assert st["status"] == JobStatus.COMPLETED


def test_hung_search_fails_that_row_after_the_deadline(env, monkeypatch):
    release = threading.Event()
    monkeypatch.setattr(ss, "ROW_DEADLINE_SECONDS", 0.2)
    env.search_outcomes["a.mkv"] = lambda: release.wait(5) or {"candidates": [], "errors": []}
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"], check_lengths=False))
    try:
        ss.run_subtitle_search_job(jid)
    finally:
        release.set()
    rows = rows_of(env.load(jid))
    assert rows[row_key("a.mkv")]["state"] == "failed"
    assert rows[row_key("a.mkv")]["errors"][0]["message"] == "The source took too long to answer"
    assert rows[row_key("b.mkv")]["state"] == "searched"


def test_cancel_during_retry_sleep_is_immediate(env, monkeypatch):
    env.search_outcomes["a.mkv"] = [net(), {"candidates": [cand(1)], "errors": []}]
    jid = env.new_job(make_settings(["a.mkv", "b.mkv"], check_lengths=False))
    sleeps = []

    def cancelling_sleep(seconds):
        sleeps.append(seconds)
        request_cancel(jid)

    monkeypatch.setattr(ss, "_sleep", cancelling_sleep)
    ss.run_subtitle_search_job(jid)
    st = env.load(jid)
    assert sleeps == [1.0]  # stopped after the first second of the five
    assert st["status"] == JobStatus.CANCELLED
    assert len(env.search_calls) == 1  # no retry, no second row


def test_cancelled_while_queued_never_starts(env):
    jid = env.new_job(make_settings(["a.mkv"]), status=JobStatus.CANCELLED)
    ss.run_subtitle_search_job(jid)
    assert env.search_calls == [] and env.load(jid)["status"] == JobStatus.CANCELLED


def test_cancel_keeps_partial_results_and_says_n_of_m(env):
    count = []

    def second_row_cancels():
        count.append(1)
        if len(count) == 2:
            request_cancel(jid)
        return {"candidates": [cand(1)], "errors": []}

    for n in ("a.mkv", "b.mkv", "c.mkv"):
        env.search_outcomes[n] = second_row_cancels
    jid = env.new_job(make_settings(["a.mkv", "b.mkv", "c.mkv"]))
    ss.run_subtitle_search_job(jid)
    st = env.load(jid)
    assert st["status"] == JobStatus.CANCELLED
    assert st["current_file"] == "2 of 3 done before cancel"
    states = [r["state"] for r in rows_of(st).values()]
    assert states == ["searched", "searched", "pending"]  # nothing was checked either
    assert not [k for k, _ in env.events if k == "check"]


def test_top_five_candidates_are_stored_ranked(env):
    env.search_outcomes["a.mkv"] = {"candidates": [cand(n) for n in range(8)], "errors": []}
    jid = env.new_job(make_settings(["a.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    row = rows_of(env.load(jid))[row_key("a.mkv")]
    assert [c["subtitle_id"] for c in row["candidates"]] == [f"id{n}" for n in range(5)]
    assert {"provider", "subtitle_id", "release", "score", "language", "release_kind"} <= set(
        row["candidates"][0]
    )


def test_log_lines_are_capped(env):
    names = [f"v{n}.mkv" for n in range(60)]
    for n in names:
        env.search_outcomes[n] = ProviderError("The source is down")
    jid = env.new_job(make_settings(names, check_lengths=False))
    ss.run_subtitle_search_job(jid)
    lines = env.logs(jid)
    failures = [m for m in lines if m.startswith("v") and "The source is down" in m]
    assert len(failures) == 20
    assert any(m == "and 40 more" for m in lines)


def test_each_source_failure_is_logged_once(env):
    bad = {"candidates": [], "errors": [{"provider": "subf2m", "message": "Subf2m refused (403)"}]}
    for n in ("a.mkv", "b.mkv", "c.mkv"):
        env.search_outcomes[n] = bad
    jid = env.new_job(make_settings(["a.mkv", "b.mkv", "c.mkv"], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    assert len([m for m in env.logs(jid) if "Subf2m refused (403)" in m]) == 1


def test_start_and_summary_lines_and_the_settings_size_are_logged(env):
    jid = env.new_job(make_settings([f"v{n}.mkv" for n in range(600)], check_lengths=False))
    ss.run_subtitle_search_job(jid)
    lines = env.logs(jid)
    assert lines[0].startswith("Searching 600 rows in subf2m")
    assert any(m.startswith("Searched 600, 600 found") for m in lines)
    size_lines = [m for m in lines if m.startswith("Stored results:")]
    assert len(size_lines) == 1
    print("settings size for 600 rows:", size_lines[0])  # the one-off measurement (Task 11)
