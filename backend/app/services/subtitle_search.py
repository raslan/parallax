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
from app.services.subtitle_run import _log_job, _update_job, search_candidates

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


def run_with_deadline(
    fn: Callable[[], T], seconds: float, message: str = SEARCH_TIMEOUT_MESSAGE
) -> T:
    """`fn()`'s result, or DeadlineExceeded(message) when it takes longer than `seconds`.

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
    worker.join(seconds)
    if worker.is_alive():
        raise DeadlineExceeded(message)
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
    return all(e.get("network") for e in errors)


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
                lambda: search_candidates(q, run.providers, force=force), ROW_DEADLINE_SECONDS
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
    if path not in durations:
        unreadable = f"Could not read the video: {name}"
        try:
            value = run_with_deadline(
                lambda: _probe_duration(path, name), ROW_DEADLINE_SECONDS, unreadable
            )
            durations[path] = ("ok", value)
        except Exception as exc:
            durations[path] = ("error", str(exc) if isinstance(exc, ProviderError) else unreadable)
    kind, value = durations[path]
    row["state"] = "checked"
    if kind == "error":
        row["length"] = {"error": value}
        run.note_row_failure(name, str(value))
        return False
    top = row["candidates"][0]

    def check() -> dict:
        return run_with_deadline(
            lambda: check_candidate_length(
                path,
                top["provider"],
                top["subtitle_id"],
                row["language"],
                season=row.get("season"),
                episode=row.get("episode"),
                video_duration=value,
            ),
            ROW_DEADLINE_SECONDS,
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
    except ProviderError as exc:
        row["length"] = {"error": str(exc)}
        run.note_row_failure(name, str(exc))
    except Exception as exc:
        logger.warning("subtitle length check failed: %s: %s", type(exc).__name__, exc)
        row["length"] = {"error": f"The length check failed ({type(exc).__name__})"}
        run.note_row_failure(name, row["length"]["error"])
    return False


def _found(results: dict[str, dict]) -> int:
    return sum(1 for r in results.values() if r["state"] != "failed" and r["candidates"])


def run_subtitle_search_job(job_id: int) -> None:
    """Everything the job needs is in `job.settings` (see the design spec); nothing is passed."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus

    try:
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            if job is None or job.status == JobStatus.CANCELLED:
                return  # cancelled while it waited for a queue slot
            job.status = JobStatus.RUNNING
            job.started_at = _now()
            db.commit()
            stored = json.loads(job.settings or "{}")
        finally:
            db.close()
        arm_cancel(job_id)

        run = _Run(job_id, stored)
        rows = list(run.results.values())
        check_lengths = bool(run.stored.get("check_lengths"))
        if check_lengths:
            run.phases.append("check")
        run.log(
            f"Searching {len(rows)} rows in {', '.join(run.providers)} "
            f"({'with' if check_lengths else 'without'} length checks)"
        )

        cancelled = _search_phase(run, rows)
        if not cancelled:
            run.log(f"Searched {len(rows)}, {_found(run.results)} found")
            if check_lengths:
                cancelled = _check_phase(run, rows)
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
        fields.update(
            status=JobStatus.COMPLETED,
            progress=100.0,
            processed_files=run.processed,
            total_files=run.total,
            current_file=f"{_found(run.results)} of {total} found",
        )
    run.log(f"Stored results: {len(fields['settings'])} characters for {total} rows")
    _update_job(run.job_id, **fields)
