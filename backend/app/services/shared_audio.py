"""Shared audio for the Duplicates pages' audio criterion.

Finds files whose audio is partly (or fully) found inside another file's, e.g. a
theatrical cut inside an extended cut, even when size, duration and encode differ.
Pure measurement: the Extract / Find duplicates jobs (`duplicates.find_duplicates`,
`audio_duplicates.find_audio_duplicates`) call `compute_shared_audio` and write the result
onto each file row; the browser then groups files by it (`frontend/src/lib/sharedAudio.ts`).

Each file's whole first audio track is fingerprinted once (cached under DATA_DIR keyed
by id + size + mtime, so a changed file refreshes itself) and every pair inside a
funnel group is matched with `partial_match.match_pair`.
"""

from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from sqlalchemy import Table, bindparam
from sqlalchemy.sql.elements import ColumnElement

from app.config import DATA_DIR
from app.services.partial_match import (
    Fingerprint,
    FingerprintCancelled,
    extract_full_fingerprint,
    match_pair,
)

logger = logging.getLogger(__name__)

CACHE_DIR = os.path.join(DATA_DIR, "audio-fingerprints")
# A pair sharing less than this is not recorded (it is noise, and keeps the column small).
MIN_SHARED = 0.10

Group = list[tuple[int, str]]  # [(file_id, path), ...]

# Comparing every pair in a group is quadratic in its size: at ~20 ms for a pair of two-hour
# films, this many pairs is already well over a quarter of an hour.
LARGE_PAIR_COUNT = 50_000


def describe_plan(files: int, groups: int, pairs: int) -> tuple[str, str]:
    """The job-log line (and its level) for how much a shared-audio run has to do."""
    message = f"Shared audio: {files} files in {groups} group(s), {pairs:,} pairs to compare."
    if pairs <= LARGE_PAIR_COUNT:
        return message, "info"
    return (
        message + " That is a lot and can take hours. Turning on a criterion that splits the"
        " library into smaller groups (Filename, Content date) cuts it down a lot.",
        "warning",
    )


def measured_settings(criteria: dict) -> str:
    """The two server-side dials a run measures with, as the job's `settings` JSON, so the
    Duplicates pages can tell, even after a reload, whether the sliders still match what is
    stored on the files."""
    return json.dumps(
        {
            "audio_similarity": criteria.get("audio_similarity", 0.75),
            "audio_min_stretch": criteria.get("audio_min_stretch", 10.0),
        }
    )


def write_shared_audio(
    db, table: Table, scope: ColumnElement, shared: dict[int, list[list]]
) -> None:
    """Replace the `shared_audio` column of every row matching `scope` with `shared`.

    Everything measured by an earlier run is cleared first, so values from different runs
    (different groups, different dials) are never mixed. A row that was deleted while the
    run was going just matches nothing; a bulk UPDATE by id cannot fail on it, unlike
    setting the attribute on an ORM object that no longer has a row. The caller commits.
    """
    db.execute(
        table.update().where(scope, table.c.shared_audio.isnot(None)).values(shared_audio=None)
    )
    if shared:
        db.execute(
            table.update()
            .where(table.c.id == bindparam("b_id"))
            .values(shared_audio=bindparam("b_val")),
            [{"b_id": fid, "b_val": json.dumps(entries)} for fid, entries in shared.items()],
        )


def cached_fingerprint(
    file_id: int,
    path: str,
    kind: str = "video",
    is_cancelled: Callable[[], bool] | None = None,
) -> Fingerprint | None:
    """Full-track fingerprint, from the disk cache when the file hasn't changed.

    `kind` keeps video and audio files apart: their ids both start at 1. Video keeps the
    bare key it always had, so existing caches stay valid. Returns None for a file with no
    usable audio. Raises `FingerprintCancelled` if `is_cancelled()` turns true while ffmpeg runs.
    """
    try:
        st = os.stat(path)
    except OSError:
        return None
    prefix = "" if kind == "video" else f"{kind}-"
    cache = os.path.join(CACHE_DIR, f"{prefix}{file_id}-{st.st_size}-{st.st_mtime_ns}.npy")
    if os.path.exists(cache):
        try:
            return Fingerprint(np.load(cache))
        except Exception:  # noqa: BLE001 - a torn cache file is just recomputed
            pass
    try:
        frames = extract_full_fingerprint(path, is_cancelled=is_cancelled)
    except FingerprintCancelled:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("audio fingerprint failed for %s: %s", path, exc)
        return None
    if frames is None:
        return None
    # A temp name no other writer shares, removed again if the write fails, then renamed
    # into place so a reader never sees a half-written cache file.
    tmp = f"{cache[:-4]}.{os.getpid()}-{threading.get_ident()}.tmp.npy"
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        np.save(tmp, frames)
        os.replace(tmp, cache)
    except OSError as exc:
        logger.warning("could not cache audio fingerprint for %s: %s", path, exc)
        try:
            os.remove(tmp)
        except OSError:
            pass
    return Fingerprint(frames)


def compute_shared_audio(
    groups: list[Group],
    *,
    workers: int,
    is_cancelled: Callable[[], bool],
    on_progress: Callable[[float], None],
    similarity: float = 0.75,
    min_stretch_s: float = 10.0,
    kind: str = "video",
    on_plan: Callable[[int, int, int], None] | None = None,
) -> dict[int, list[list]] | None:
    """For every file in `groups`, the other files in its group that share its audio.

    Returns `{file_id: [[other_id, share], ...]}`, where `share` is the fraction (0-1)
    of the *shorter* of the two tracks found in the longer one — the same number from
    either side. Files with no match get `[]`. Returns None if cancelled.
    `similarity` is how alike a stretch of audio must sound to count (0.75 = at most a
    quarter of its fingerprint bits may differ); `min_stretch_s` is how long shared audio
    must run unbroken to count (see `partial_match.match_pair`).
    `on_progress` gets 0-1 across fingerprinting (first half) and matching (second half).
    `on_plan(files, groups, pairs)` is called once, before any work, with how much there is
    to do: matching every pair in a group is quadratic in its size.
    A file that cannot be fingerprinted is skipped for the rest of the run, not retried.
    """
    groups = [g for g in groups if len(g) > 1]
    files = [(fid, path) for group in groups for fid, path in group]
    if not files:
        return {}
    total_pairs = sum(len(g) * (len(g) - 1) // 2 for g in groups)
    if on_plan is not None:
        on_plan(len(files), len(groups), total_pairs)

    # Phase 1: make sure every file has a cached fingerprint (ffmpeg, so threads are enough).
    # Polled instead of awaited so a cancel is noticed within half a second, and the
    # in-flight ffmpeg runs are killed by the same `is_cancelled` the workers were given.
    failed: set[int] = set()
    pool = ThreadPoolExecutor(max_workers=max(1, workers))
    try:
        file_of = {
            pool.submit(cached_fingerprint, fid, path, kind, is_cancelled): fid
            for fid, path in files
        }
        pending = set(file_of)
        finished = 0
        while pending:
            done, pending = cf.wait(pending, timeout=0.5, return_when=cf.FIRST_COMPLETED)
            if is_cancelled():
                return None
            for fut in done:
                finished += 1
                # The fingerprint itself is re-read from the cache in phase 2.
                if fut.exception() is not None or fut.result() is None:
                    failed.add(file_of[fut])
            on_progress(0.5 * finished / len(files))
    finally:
        pool.shutdown(wait=True, cancel_futures=True)

    # Phase 2: match every pair inside each group. Only one group's fingerprints are in
    # memory at a time, and a file is dropped as soon as its row of pairs is done.
    shared: dict[int, list[list]] = {fid: [] for fid, _ in files}
    done_pairs = 0
    for group in groups:
        prints: dict[int, Fingerprint] = {}
        for fid, path in group:
            if fid in failed:
                continue
            try:
                fp = cached_fingerprint(fid, path, kind, is_cancelled)
            except FingerprintCancelled:
                return None
            if fp is not None and len(fp) > 0:
                prints[fid] = fp
        for ida in list(prints):
            pa = prints.pop(ida)  # file `ida` is never the second of a pair after its own row
            for idb, pb in prints.items():
                done_pairs += 1
                if done_pairs % 50 == 0:
                    if is_cancelled():
                        return None
                    on_progress(0.5 + 0.5 * done_pairs / total_pairs)
                m = match_pair(pa, pb, max_ber=1 - similarity, min_stretch_s=min_stretch_s)
                if m is None or m.coverage_short < MIN_SHARED:
                    continue
                share = round(m.coverage_short, 3)
                shared[ida].append([idb, share])
                shared[idb].append([ida, share])
    on_progress(1.0)
    return shared
