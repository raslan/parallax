"""The subtitle search job (`JobType.SUBTITLE_SEARCH`, "Subtitle search" on Jobs).

For a folder it searches every row (one video plus one wanted language), optionally checks the
top candidate's length against the video, and keeps the result of each row in `job.settings`
so the page can follow it, close, and come back to it. One row at a time: a steady trickle is
the point, and the sources pace themselves (`Politeness`).

A row whose search ends with no candidates and a connection-level failure from every source is
tried once more after five seconds; a source that answered badly is not retried. Each row's
search and each row's check run under a deadline, so one hung request or dead mount costs that
row, never the job. Nothing is written beside any video here: saving is the run job's work.
"""

import json
import logging
import os
import threading
import time
from collections.abc import Callable
from typing import TypeVar

from app.services.common import arm_cancel, clear_cancel, fail_job, should_cancel
from app.services.scanner import probe_metadata
from app.services.subtitle_preview import check_candidate_length
from app.services.subtitle_providers import (
    Identity,
    ProviderError,
    ProviderNetworkError,
    SearchQuery,
)
from app.services.subtitle_run import (
    _log_job,
    _run_item,
    _update_job,
    is_not_applicable,
    search_candidates,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

ROW_DEADLINE_SECONDS = 120
RETRY_DELAY_SECONDS = 5.0
STORED_CANDIDATES = 5
WRITE_INTERVAL_SECONDS = 2.0
MAX_ROW_FAILURE_LOGS = 20

_sleep = time.sleep
_clock = time.monotonic

SEARCH_TIMEOUT_MESSAGE = "The source took too long to answer"


class DeadlineExceeded(ProviderError):
    """A row's search or check did not finish in time."""


class WaitCancelled(Exception):
    """The job was cancelled while a row's call was still running (it is abandoned)."""


# Two probes in a row from one folder that run out of time look like a dead mount: the rest of
# that folder is failed at once instead of costing a deadline each.
DEAD_FOLDER_TIMEOUTS = 2


def run_with_deadline(
    fn: Callable[[], T],
    seconds: float,
    message: str = SEARCH_TIMEOUT_MESSAGE,
    is_cancelled: Callable[[], bool] | None = None,
) -> T:
    """`fn()`'s result, or DeadlineExceeded(message) when it takes longer than `seconds`, or
    WaitCancelled as soon as `is_cancelled()` says so (checked every quarter second).

    It runs in a daemon thread: a call stuck on a dead network or mount is abandoned, not
    killed (it ends when the OS gives up), and the caller moves on."""
    box: dict = {}

    def target() -> None:
        try:
            box["value"] = fn()
        except BaseException as exc:  # handed to the caller's thread
            box["error"] = exc

    worker = threading.Thread(target=target, daemon=True)
    worker.start()
    end = time.monotonic() + seconds
    while worker.is_alive():
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise DeadlineExceeded(message)
        worker.join(min(0.25, remaining))
        if worker.is_alive() and is_cancelled is not None and is_cancelled():
            raise WaitCancelled()
    if "error" in box:
        raise box["error"]
    return box["value"]


# The share of the progress bar each phase takes, by which phases are on.
_WEIGHTS = {1: (100,), 2: (50, 50), 3: (40, 30, 30)}


class _Run:
    """The job's in-memory state: its stored request, every row's result, and what to write."""

    def __init__(self, job_id: int, stored: dict) -> None:
        self.job_id = job_id
        self.results: dict[str, dict] = stored.pop("results", {})
        self.stored = stored
        self.providers: list[str] = stored.get("providers", [])
        self.engine = "alass"  # the sync engine for a save with sync after, set when it starts
        self.titles = {t["key"]: t for t in stored.get("titles", [])}
        self.phases: list[str] = ["search"]
        self.phase_index = 0
        self.processed = 0
        self.total = 0
        self.current: str | None = None
        self.last_flush = float("-inf")
        self.logged_sources: set[tuple[str, str]] = set()
        self.failure_logs = 0
        self.more_failures = 0
        self.folder_timeouts: dict[str, int] = {}  # folder -> probes in a row that timed out

    def settings_json(self) -> str:
        return json.dumps({**self.stored, "results": self.results})

    def progress(self) -> float:
        weights = _WEIGHTS[len(self.phases)]
        done = sum(weights[: self.phase_index])
        part = (self.processed / self.total) if self.total else 1.0
        return min(99.0, done + weights[self.phase_index] * part)

    def flush(self, force: bool = False) -> None:
        """Write the results and where the job is, at most every couple of seconds."""
        if not force and _clock() - self.last_flush < WRITE_INTERVAL_SECONDS:
            return
        self.last_flush = _clock()
        _update_job(
            self.job_id,
            settings=self.settings_json(),
            processed_files=self.processed,
            total_files=self.total,
            current_file=self.current,
            progress=self.progress(),
        )

    def begin_phase(self, index: int, total: int) -> None:
        self.phase_index = index
        self.processed = 0
        self.total = total
        self.flush(force=True)

    def begin_row(self, label: str, first: bool) -> None:
        self.current = label
        self.flush(force=first)

    def end_row(self) -> None:
        self.processed += 1
        self.flush()

    def log(self, message: str, level: str = "info") -> None:
        _log_job(self.job_id, message, level)

    def note_source_errors(self, errors: list[dict]) -> None:
        for e in errors:
            key = (e.get("provider", ""), e.get("message", ""))
            if key not in self.logged_sources:
                self.logged_sources.add(key)
                self.log(f"{key[0]}: {key[1]}", "warning")

    def note_row_failure(self, name: str, message: str) -> None:
        if self.failure_logs < MAX_ROW_FAILURE_LOGS:
            self.failure_logs += 1
            self.log(f"{name}: {message}", "warning")
        else:
            self.more_failures += 1


def _name(row: dict) -> str:
    return os.path.basename(row["video_path"])


def _all_network_failed(out: dict, providers: list[str]) -> bool:
    """No candidates, and every chosen source's failure is a connection-level one."""
    errors = out.get("errors") or []
    if out.get("candidates") or not errors:
        return False
    if not set(providers) <= {e.get("provider") for e in errors}:
        return False
    # A source that does not apply ("Films only" on a TV row) is no failure and never blocks
    # the retry of a source that was really down.
    failures = [e for e in errors if not is_not_applicable(e)]
    return bool(failures) and all(e.get("network") for e in failures)


def _wait_to_retry(job_id: int) -> bool:
    """Sleep the retry delay a second at a time; True if the job was cancelled meanwhile."""
    waited = 0.0
    while waited < RETRY_DELAY_SECONDS:
        if should_cancel(job_id):
            return True
        step = min(1.0, RETRY_DELAY_SECONDS - waited)
        _sleep(step)
        waited += step
    return should_cancel(job_id)


def _query_for(run: _Run, row: dict) -> SearchQuery:
    ident = run.titles[row["title_key"]]["identity"]
    return SearchQuery(
        identity=Identity(
            ident["title"],
            ident.get("year"),
            ident["type"],
            ident.get("imdb_id"),
            ident.get("tmdb_id"),
            ident.get("subf2m_path"),
        ),
        languages=(row["language"],),
        season=row.get("season"),
        episode=row.get("episode"),
        video_path=row["video_path"],
    )


def _fail_row(run: _Run, row: dict, message: str) -> None:
    row.update(state="failed", candidates=[], errors=[{"provider": "search", "message": message}])
    run.note_row_failure(_name(row), message)


def _search_row(run: _Run, row: dict) -> bool:
    """Search one row. True if the job was cancelled while waiting to retry it."""
    try:
        q = _query_for(run, row)

        def ask(force: bool) -> dict:
            return run_with_deadline(
                lambda: search_candidates(q, run.providers, force=force),
                ROW_DEADLINE_SECONDS,
                is_cancelled=lambda: should_cancel(run.job_id),
            )

        out = ask(False)
        if _all_network_failed(out, run.providers):
            first_errors = out["errors"]
            if _wait_to_retry(run.job_id):
                return True
            out = ask(True)
            if _all_network_failed(out, run.providers):
                # Failed the same way twice: the row says what the first attempt said.
                row.update(state="failed", candidates=[], errors=first_errors)
                run.note_row_failure(_name(row), first_errors[0]["message"])
                return False
        run.note_source_errors(out["errors"])
        row.update(
            state="searched",
            candidates=out["candidates"][:STORED_CANDIDATES],
            errors=out["errors"],
        )
    except WaitCancelled:
        return True  # the row stays as it was (pending), not shown as failed
    except ProviderError as exc:
        _fail_row(run, row, str(exc))
    except Exception as exc:  # a surprise in one row must not end the job
        logger.warning("subtitle search of one row failed: %s: %s", type(exc).__name__, exc)
        _fail_row(run, row, f"The search failed ({type(exc).__name__})")
    return False


def _probe_duration(path: str, name: str) -> float | None:
    meta = probe_metadata(path)
    if not meta.get("probe_ok"):
        raise ProviderError(f"Could not read the video: {name}")
    return meta.get("duration")


def _check_row(run: _Run, row: dict, durations: dict[str, tuple[str, object]]) -> bool:
    """Check the top candidate's length. True if the job was cancelled while waiting to retry."""
    name = _name(row)
    path = row["video_path"]
    folder = os.path.dirname(path)
    if path not in durations:
        unreadable = f"Could not read the video: {name}"
        if run.folder_timeouts.get(folder, 0) >= DEAD_FOLDER_TIMEOUTS:
            durations[path] = ("error", unreadable)
        else:
            try:
                value = run_with_deadline(
                    lambda: _probe_duration(path, name),
                    ROW_DEADLINE_SECONDS,
                    unreadable,
                    is_cancelled=lambda: should_cancel(run.job_id),
                )
                durations[path] = ("ok", value)
                run.folder_timeouts[folder] = 0
            except WaitCancelled:
                return True
            except Exception as exc:
                if isinstance(exc, DeadlineExceeded):
                    run.folder_timeouts[folder] = run.folder_timeouts.get(folder, 0) + 1
                durations[path] = (
                    "error",
                    str(exc) if isinstance(exc, ProviderError) else unreadable,
                )
    kind, value = durations[path]
    row["state"] = "checked"
    if kind == "error":
        row["length"] = {"error": value}
        run.note_row_failure(name, str(value))
        return False
    top = row["candidates"][0]

    def check() -> dict:
        return run_with_deadline(
            is_cancelled=lambda: should_cancel(run.job_id),
            fn=lambda: check_candidate_length(
                path,
                top["provider"],
                top["subtitle_id"],
                row["language"],
                season=row.get("season"),
                episode=row.get("episode"),
                video_duration=value,
            ),
            seconds=ROW_DEADLINE_SECONDS,
        )

    try:
        try:
            res = check()
        except ProviderNetworkError:
            if _wait_to_retry(run.job_id):
                row["state"] = "searched"
                return True
            res = check()
        row["length"] = {
            "last": res["last"],
            "video_duration": res["video_duration"],
            "verdict": res["length"],
        }
    except WaitCancelled:
        row["state"] = "searched"
        return True
    except ProviderError as exc:
        row["length"] = {"error": str(exc)}
        run.note_row_failure(name, str(exc))
    except Exception as exc:
        logger.warning("subtitle length check failed: %s: %s", type(exc).__name__, exc)
        row["length"] = {"error": f"The length check failed ({type(exc).__name__})"}
        run.note_row_failure(name, row["length"]["error"])
    return False


def judge_row(
    row: dict, title_certain: bool, is_movie: bool
) -> tuple[bool, str | None, str | None]:
    """Whether automatic save may save this row: `(sure, reason, detail)`.

    Sure needs all of: a certain identity; a top candidate that is the exact episode (a film
    has no release kind); a completed length check with the verdict `ok`. Otherwise the row is
    left for the user, with the first reason that applies: nothing to save (`failed`,
    `none_found`), then `identity_unconfirmed`, `episode_unknown` (a TV file whose season or
    episode could not be read, or a special: the search would have guessed), `only_season_pack`,
    and the length (`length_short`,
    `length_long`, `length_unchecked`: not checked, unreadable, or a runtime we do not know; a
    single `.ass` release cannot be checked, so it ends here)."""
    if row["state"] == "failed":
        errors = row.get("errors") or []
        return False, "failed", errors[0]["message"] if errors else None
    if not row["candidates"]:
        return False, "none_found", None
    if not title_certain:
        return False, "identity_unconfirmed", None
    if not is_movie and (row.get("season") in (None, 0) or row.get("episode") is None):
        # The search fell back to episode 1 of season 1, so whatever matched is not this file's.
        return False, "episode_unknown", None
    if not is_movie and row["candidates"][0].get("release_kind") != "episode":
        return False, "only_season_pack", None
    length = row.get("length")
    verdict = length.get("verdict") if isinstance(length, dict) else None
    if verdict == "short":
        return False, "length_short", None
    if verdict == "long":
        return False, "length_long", None
    if verdict != "ok":
        return False, "length_unchecked", None
    return True, None, None


def _found(results: dict[str, dict]) -> int:
    return sum(1 for r in results.values() if r["state"] != "failed" and r["candidates"])


def run_subtitle_search_job(job_id: int) -> None:
    """Everything the job needs is in `job.settings` (see the design spec); nothing is passed."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.models.settings import get_setting

    try:
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            if job is None or job.status == JobStatus.CANCELLED:
                return  # cancelled while it waited for a queue slot
            # One conditional UPDATE, so a cancel that committed since the read above (the user's
            # cancel of a still-PENDING job) is never overwritten with RUNNING.
            started = (
                db.query(Job)
                .filter(Job.id == job_id, Job.status == JobStatus.PENDING)
                .update(
                    {"status": JobStatus.RUNNING, "started_at": _now()},
                    synchronize_session=False,
                )
            )
            db.commit()
            if started == 0:
                return
            stored = json.loads(job.settings or "{}")
            engine = (stored.get("save") or {}).get("engine") or get_setting(
                db, "subtitle_sync_engine", "alass"
            )
        finally:
            db.close()
        arm_cancel(job_id)

        run = _Run(job_id, stored)
        run.engine = engine
        rows = list(run.results.values())
        save = run.stored.get("save")
        # Saving only ever happens after a completed length check.
        check_lengths = bool(run.stored.get("check_lengths")) or bool(save)
        if check_lengths:
            run.phases.append("check")
        if save:
            run.phases.append("save")
        mode = "saving the sure matches" if save else "review each match"
        run.log(
            f"Searching {len(rows)} rows in {', '.join(run.providers)} "
            f"({'with' if check_lengths else 'without'} length checks, {mode})"
        )

        cancelled = _search_phase(run, rows)
        if not cancelled:
            run.log(f"Searched {len(rows)}, {_found(run.results)} found")
            if check_lengths:
                cancelled = _check_phase(run, rows)
        if not cancelled and save:
            cancelled = _save_phase(run, rows, save)
        _finish(run, rows, cancelled)
    except Exception as exc:
        logger.exception("Subtitle search job %d failed", job_id)
        db = SessionLocal()
        try:
            fail_job(db, db.get(Job, job_id), exc)
        except Exception:
            logger.exception("Could not mark subtitle search job %d failed", job_id)
        finally:
            db.close()
    finally:
        clear_cancel(job_id)


def _now():
    from app.services.common import now

    return now()


def _search_phase(run: _Run, rows: list[dict]) -> bool:
    """Search every row. True if the job was cancelled."""
    run.begin_phase(0, len(rows))
    for i, row in enumerate(rows):
        if should_cancel(run.job_id):
            return True
        run.begin_row(f"Searching {_name(row)}", first=i == 0)
        if _search_row(run, row):
            return True
        run.end_row()
    run.flush(force=True)
    return False


def _check_phase(run: _Run, rows: list[dict]) -> bool:
    """Check the top candidate of every row that has one. True if the job was cancelled."""
    todo = [r for r in rows if r["state"] == "searched" and r["candidates"]]
    run.log("Checking lengths")
    run.begin_phase(1, len(todo))
    durations: dict[str, tuple[str, object]] = {}
    for i, row in enumerate(todo):
        if should_cancel(run.job_id):
            return True
        run.begin_row(f"Checking length of {_name(row)}", first=i == 0)
        if _check_row(run, row, durations):
            return True
        run.end_row()
    run.flush(force=True)
    return False


def _save_phase(run: _Run, rows: list[dict], save: dict) -> bool:
    """Save the sure rows, one at a time, through the run job's per-item code; every other row
    is marked left for the user with its reason. True if the job was cancelled: a cancel is
    re-read right before each item, so nothing is saved after it."""
    sure = []
    for row in rows:
        title = run.titles[row["title_key"]]
        ok, reason, detail = judge_row(
            row, bool(title.get("certain")), title["identity"]["type"] == "movie"
        )
        if ok:
            sure.append(row)
        else:
            row.update(outcome="left", reason=reason, detail=detail)
    run.log(f"Saving {len(sure)} sure matches, {len(rows) - len(sure)} left for you")
    run.begin_phase(2, len(sure))
    for i, row in enumerate(sure):
        if should_cancel(run.job_id):
            return True
        name = _name(row)
        run.begin_row(f"Saving {name}", first=i == 0)
        top = row["candidates"][0]
        item = {
            "video_path": row["video_path"],
            "language": row["language"],
            "provider": top["provider"],
            "subtitle_id": top["subtitle_id"],
            "sync": bool(save.get("sync_after")),
            "season": row.get("season"),
            "episode": row.get("episode"),
        }
        result = _run_item(
            item, bool(save.get("keep_existing")), bool(save.get("sync_after")), run.engine
        )
        if result["status"] == "saved":
            row.update(
                outcome="saved",
                saved={
                    "provider": top["provider"],
                    "subtitle_id": top["subtitle_id"],
                    "file": result.get("path"),
                },
            )
            if result.get("sync_error"):
                row["detail"] = f"Saved, but syncing failed: {result['sync_error']}"
        else:
            row.update(outcome="failed", detail=result.get("error"))
            run.note_row_failure(name, result.get("error") or "The save failed")
        run.end_row()
    run.flush(force=True)
    return False


def _finish(run: _Run, rows: list[dict], cancelled: bool) -> None:
    from app.models.job import JobStatus

    if run.more_failures:
        run.log(f"and {run.more_failures} more", "warning")
    total = len(rows)
    fields: dict = {"finished_at": _now(), "settings": run.settings_json()}
    failed = [r for r in rows if r["state"] == "failed"]
    if cancelled:
        fields.update(
            status=JobStatus.CANCELLED,
            processed_files=run.processed,
            total_files=run.total,
            current_file=f"{run.processed} of {run.total} done before cancel",
        )
    elif failed and len(failed) == total:
        fields.update(
            status=JobStatus.FAILED,
            error=failed[0]["errors"][0]["message"][:512],
            current_file=None,
        )
    else:
        if run.stored.get("save"):
            count = {
                o: sum(1 for r in rows if r.get("outcome") == o)
                for o in ("saved", "left", "failed")
            }
            summary = (
                f"{count['saved']} saved, {count['left']} left for you, {count['failed']} failed"
            )
        else:
            summary = f"{_found(run.results)} of {total} found"
        fields.update(
            status=JobStatus.COMPLETED,
            progress=100.0,
            processed_files=run.processed,
            total_files=run.total,
            current_file=summary,
        )
    run.log(f"Stored results: {len(fields['settings'])} characters for {total} rows")
    _update_job(run.job_id, **fields)
