import concurrent.futures as _cf
import json
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass

import imagehash
from PIL import Image
from sqlalchemy import func

from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus
from app.models.settings import get_setting
from app.services.common import arm_cancel, clear_cancel, now, should_cancel
from app.services.phash_scanner import _Cancelled, _extract_phash_frames

logger = logging.getLogger(__name__)


@dataclass
class CachedFile:
    id: int
    library_id: int
    path: str
    filename: str
    size: int
    duration: float | None
    codec_name: str | None
    video_bitrate: int | None
    status: str


@dataclass
class DuplicateGroup:
    files: list[CachedFile]
    keep_id: int


# Last result per library_id — cleared on each new scan
_results: dict[int, list[DuplicateGroup]] = {}


def _pick_keep(files: list[CachedFile]) -> int:
    """Highest bitrate → largest size → shortest path."""
    return sorted(
        files,
        key=lambda f: (-(f.video_bitrate or 0), -(f.size or 0), f.path),
    )[0].id


def _snapshot(f: File) -> CachedFile:
    return CachedFile(
        id=f.id,
        library_id=f.library_id,
        path=f.path,
        filename=f.filename,
        size=f.size,
        duration=f.duration,
        codec_name=f.codec_name,
        video_bitrate=f.video_bitrate,
        status=f.status,
    )


def _extract_phash(path: str) -> "imagehash.ImageHash | None":
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", path, "-frames:v", "1", "-q:v", "2", tmp_path],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            return None
        with Image.open(tmp_path) as img:
            return imagehash.phash(img)
    except (Exception, subprocess.TimeoutExpired) as exc:
        logger.warning("pHash extraction failed for %s: %s", path, exc)
        return None
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _cluster_by_duration(files: list[File], tolerance: float = 2.0) -> list[list[File]]:
    """Group files whose duration is within tolerance seconds of a group anchor.

    Files are sorted by duration first so clustering is deterministic and
    order-independent. Each group anchors on its first (shortest) member;
    consecutive files within `tolerance` of that anchor join the group.
    """
    sorted_files = sorted(files, key=lambda f: f.duration or 0.0)
    durations = [(f.filename, f.duration) for f in sorted_files[:10]]
    logger.warning(
        "_cluster_by_duration: %d files, tolerance=%.1f, sample durations: %s",
        len(sorted_files),
        tolerance,
        durations,
    )
    groups: list[list[File]] = []
    i = 0
    while i < len(sorted_files):
        anchor_dur = sorted_files[i].duration or 0.0
        group = []
        j = i
        while (
            j < len(sorted_files)
            and abs((sorted_files[j].duration or 0.0) - anchor_dur) <= tolerance
        ):
            group.append(sorted_files[j])
            j += 1
        if len(group) > 1:
            groups.append(group)
        i = j if j > i else i + 1
    logger.warning("_cluster_by_duration: found %d groups", len(groups))
    return groups


def _hamming(a: int, b: int) -> int:
    return bin((a ^ b) & 0xFFFFFFFFFFFFFFFF).count("1")


def _frames_distance(frames_a: list[int], frames_b: list[int]) -> float:
    """Average of per-frame minimum Hamming distances (avg-of-minimums)."""
    total = 0.0
    for ha in frames_a:
        total += min(_hamming(ha, hb) for hb in frames_b)
    for hb in frames_b:
        total += min(_hamming(ha, hb) for ha in frames_a)
    return total / (len(frames_a) + len(frames_b))


def _bigram_similarity(a: str, b: str) -> float:
    """Python port of frontend/src/lib/cleanupFields.ts's bigramSimilarity —
    kept in lockstep so server-side funnel scoping and client-side
    comparison agree on what "similar filename" means."""
    s, t = a.lower(), b.lower()
    if len(t) == 0:
        return 1.0
    if len(s) < 2 or len(t) < 2:
        return 1.0 if t in s else 0.0

    def bigrams(text: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for i in range(len(text) - 1):
            bg = text[i : i + 2]
            counts[bg] = counts.get(bg, 0) + 1
        return counts

    sa, tb = bigrams(s), bigrams(t)
    intersection = sum(min(cnt, sa.get(bg, 0)) for bg, cnt in tb.items())
    return (2 * intersection) / (len(s) - 1 + len(t) - 1)


def _orientation(width: int | None, height: int | None) -> str | None:
    if width is None or height is None:
        return None
    if width == height:
        return "square"
    return "landscape" if width > height else "portrait"


def scope_extraction_candidates(files: list[dict], criteria: dict) -> set[int]:
    """Free-tier funnel (no ffmpeg, only fields already in the DB): narrows
    the full candidate set down to files that land in a >=2-file cluster
    under every *enabled* stage, in the same cheapest-first order the
    client's clustering engine uses. Files whose relevant field is None are
    excluded from that stage's clustering only when the stage is enabled.

    This is what Task 5's extraction job scopes ffmpeg work to — extraction
    should never run for a file that could never reach comparison anyway.
    """
    groups: list[list[dict]] = [files]

    def split(get_key):
        next_groups = []
        for group in groups:
            buckets: dict[object, list[dict]] = {}
            for f in group:
                key = get_key(f)
                if key is None:
                    continue
                buckets.setdefault(key, []).append(f)
            next_groups.extend(b for b in buckets.values() if len(b) > 1)
        return next_groups

    def split_tolerance(get_value, tolerance):
        next_groups = []
        for group in groups:
            valid = sorted((f for f in group if get_value(f) is not None), key=get_value)
            i = 0
            while i < len(valid):
                anchor = get_value(valid[i])
                j = i
                cluster = []
                while j < len(valid) and get_value(valid[j]) - anchor <= tolerance:
                    cluster.append(valid[j])
                    j += 1
                if len(cluster) > 1:
                    next_groups.append(cluster)
                i = j if j > i else i + 1
        return next_groups

    if criteria["use_size"]:
        groups = split(lambda f: f["size"])
    if not groups:
        return set()

    if criteria["use_duration"]:
        groups = split_tolerance(lambda f: f["duration"], criteria["duration_tolerance"])
    if not groups:
        return set()

    if criteria["use_resolution"]:
        groups = split(
            lambda f: (f["file_width"], f["file_height"])
            if f["file_width"] is not None and f["file_height"] is not None
            else None
        )
    if not groups:
        return set()

    if criteria["use_content_date"]:
        groups = split_tolerance(lambda f: f["file_date"], criteria["content_date_tolerance"])
    if not groups:
        return set()

    if criteria["use_orientation"]:
        groups = split(lambda f: _orientation(f["file_width"], f["file_height"]))
    if not groups:
        return set()

    if criteria["use_bitrate"]:
        tol_pct = criteria["bitrate_tolerance_pct"] / 100.0
        next_groups = []
        for group in groups:
            valid = sorted(
                (f for f in group if f["video_bitrate"] is not None),
                key=lambda f: f["video_bitrate"],
            )
            i = 0
            while i < len(valid):
                anchor = valid[i]["video_bitrate"]
                j = i
                cluster = []
                while j < len(valid) and (valid[j]["video_bitrate"] - anchor) <= anchor * tol_pct:
                    cluster.append(valid[j])
                    j += 1
                if len(cluster) > 1:
                    next_groups.append(cluster)
                i = j if j > i else i + 1
        groups = next_groups
    if not groups:
        return set()

    if criteria["use_filename"]:
        threshold = criteria["filename_threshold"]
        next_groups = []
        for group in groups:
            used: set[int] = set()
            for i, fi in enumerate(group):
                if i in used:
                    continue
                cluster = [fi]
                used.add(i)
                for j in range(i + 1, len(group)):
                    if j in used:
                        continue
                    if _bigram_similarity(fi["filename"], group[j]["filename"]) >= threshold:
                        cluster.append(group[j])
                        used.add(j)
                if len(cluster) > 1:
                    next_groups.append(cluster)
        groups = next_groups

    return {f["id"] for group in groups for f in group}


def _get_hashes(f: File) -> tuple["imagehash.ImageHash | None", list[int]]:
    """Return (single_hash, frames_list). Uses stored values; falls back to ffmpeg."""
    frames: list[int] = []
    if f.phash_frames:
        try:
            frames = json.loads(f.phash_frames)
        except Exception:
            pass
    if f.phash is not None and not frames:
        frames = [f.phash]

    single: imagehash.ImageHash | None = None
    if f.phash is not None:
        single = imagehash.ImageHash(
            __import__("numpy")
            .array([(f.phash >> (63 - i)) & 1 for i in range(64)], dtype=bool)
            .reshape(8, 8)
        )
    elif not frames:
        single = _extract_phash(f.path)
        if single is not None:
            frames = [int(str(single), 16)]

    return single, frames


def _cluster_by_phash(
    files: list[File],
    threshold: int = 10,
    mode: str = "all_frames",
    on_file=None,
    job_id: int | None = None,
) -> list[list[File]]:
    """Group files by pHash similarity using multi-frame hashes when available."""
    entries: list[tuple[File, imagehash.ImageHash | None, list[int]]] = []
    for f in files:
        if job_id is not None and should_cancel(job_id):
            raise _Cancelled
        if on_file:
            on_file()
        if not os.path.exists(f.path):
            logger.warning("File not on disk, skipping: %s", f.path)
            continue
        single, frames = _get_hashes(f)
        if not frames and single is None:
            continue
        entries.append((f, single, frames))

    if len(entries) < 2:
        return []

    groups: list[list[File]] = []
    used: set[int] = set()
    for i, (fi, hi, frames_i) in enumerate(entries):
        if i in used:
            continue
        group = [fi]
        used.add(i)
        for j, (fj, hj, frames_j) in enumerate(entries):
            if j <= i or j in used:
                continue
            if mode == "all_frames" and frames_i and frames_j:
                dist = _frames_distance(frames_i, frames_j)
            elif hi is not None and hj is not None:
                dist = hi - hj
            else:
                continue
            if dist <= threshold:
                group.append(fj)
                used.add(j)
        if len(group) > 1:
            groups.append(group)
    return groups


def find_duplicates(
    library_id: int,
    job_id: int | None = None,
    use_size: bool = True,
    use_duration: bool = True,
    use_phash: bool = True,
    duration_tolerance: float = 1.0,
    phash_threshold: int = 10,
    phash_mode: str = "all_frames",
    phash_frames: int = 16,
) -> list[DuplicateGroup]:
    db = SessionLocal()
    job = None
    try:
        if job_id is not None:
            job = db.get(Job, job_id)
            if job:
                job.status = JobStatus.RUNNING
                job.started_at = now()
                db.commit()
                arm_cancel(job_id)

        _results.pop(library_id, None)
        was_cancelled = False

        # Phase 1: extract pHash for files that are missing it or were scanned
        # with a different frame count than requested.
        if use_phash:
            all_candidates = (
                db.query(File)
                .filter(
                    File.library_id == library_id,
                    File.status.in_([FileStatus.DONE, FileStatus.UNKNOWN]),
                )
                .all()
            )

            # first_frame comparison only ever looks at File.phash (the single
            # first-frame hash) — extracting the full phash_frames set for it
            # would burn N-1 throwaway ffmpeg seeks per file for nothing, so
            # only extract 1 frame in that mode, and only for files that don't
            # already have a first-frame hash from any prior scan.
            effective_frames = 1 if phash_mode == "first_frame" else phash_frames

            def _needs_rescan(f: File) -> bool:
                if phash_mode == "first_frame":
                    return f.phash is None
                if f.phash_scanned_at is None or not f.phash_frames:
                    return True
                try:
                    return len(json.loads(f.phash_frames)) != phash_frames
                except Exception:
                    return True

            to_scan = [f for f in all_candidates if _needs_rescan(f)]
            if to_scan:
                # Capture plain values before any further db.commit() — SQLAlchemy
                # expires every loaded attribute on every object in the session
                # after a commit, and re-reading an expired attribute silently
                # re-queries through the (shared, NOT thread-safe) session. Worker
                # threads below must only ever touch these plain values, never
                # the File ORM objects themselves.
                by_id = {f.id: f for f in to_scan}
                to_scan_plain = [(f.id, f.path) for f in to_scan]

                if job:
                    job.total_files = len(to_scan)
                    job.current_file = "Scanning frames…"
                    db.commit()

                # Extraction is I/O-bound (ffprobe + one ffmpeg seek per file,
                # no GPU/shared model involved), so it parallelizes cleanly —
                # reuse scan_prefetch, the same setting the video/image AI
                # scanners use to bound their own concurrent work-ahead.
                n_concurrent = max(1, int(get_setting(db, "scan_prefetch", "4")))

                def _extract_one(
                    file_id: int, path: str
                ) -> tuple[int, list[int] | None, str | None]:
                    try:
                        return file_id, _extract_phash_frames(path, effective_frames, job_id), None
                    except _Cancelled:
                        return file_id, None, "cancelled"
                    except Exception as exc:
                        return file_id, None, str(exc)

                completed = 0
                with _cf.ThreadPoolExecutor(max_workers=n_concurrent) as pool:
                    pending = {pool.submit(_extract_one, fid, path) for fid, path in to_scan_plain}

                    while pending:
                        done, pending = _cf.wait(pending, timeout=2.0)

                        if job_id is not None and should_cancel(job_id):
                            was_cancelled = True
                            for fut in pending:
                                fut.cancel()
                            _cf.wait(pending)
                            pending = set()

                        for fut in done:
                            try:
                                fid, hashes, err = fut.result()
                            except _cf.CancelledError:
                                continue
                            f = by_id[fid]
                            if hashes:
                                f.phash = hashes[0]
                                f.phash_frames = json.dumps(hashes)
                                f.phash_scanned_at = now()
                                completed += 1
                            elif err != "cancelled":
                                logger.warning(
                                    "pHash extraction failed for %s: %s", f.filename, err
                                )

                        db.commit()
                        if job:
                            job.processed_files = completed
                            job.progress = min(50.0, completed / len(to_scan) * 50)
                            db.commit()

        if was_cancelled:
            clear_cancel(job_id)
            if job:
                job.status = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
            return []

        logger.warning(
            "find_duplicates: library=%d use_size=%s use_duration=%s use_phash=%s",
            library_id,
            use_size,
            use_duration,
            use_phash,
        )

        if use_size:
            dup_sizes = (
                db.query(File.size)
                .filter(File.library_id == library_id)
                .group_by(File.size)
                .having(func.count(File.id) > 1)
                .all()
            )
            size_values = [row[0] for row in dup_sizes]
            logger.warning("find_duplicates: %d duplicate sizes found", len(size_values))
            if not size_values:
                _results[library_id] = []
                if job_id is not None:
                    clear_cancel(job_id)
                if job:
                    job.status = JobStatus.COMPLETED
                    job.finished_at = now()
                    job.progress = 100.0
                    db.commit()
                return []
            candidates = (
                db.query(File)
                .filter(File.library_id == library_id, File.size.in_(size_values))
                .all()
            )
            by_size: dict[int, list[File]] = {}
            for f in candidates:
                by_size.setdefault(f.size, []).append(f)
            size_groups = list(by_size.values())
        else:
            candidates = db.query(File).filter(File.library_id == library_id).all()
            size_groups = [candidates]

        logger.warning(
            "find_duplicates: %d candidates, %d size_groups", len(candidates), len(size_groups)
        )
        total_files = len(candidates)
        processed = [0]
        if job:
            job.total_files = total_files
            db.commit()

        def _on_phash_file():
            if not job or total_files == 0:
                return
            processed[0] += 1
            job.processed_files = processed[0]
            job.progress = min(99.0, processed[0] / total_files * 100)
            db.commit()

        confirmed: list[DuplicateGroup] = []
        try:
            for sg_idx, size_group in enumerate(size_groups):
                if job_id is not None and should_cancel(job_id):
                    raise _Cancelled
                logger.warning(
                    "find_duplicates: size_group[%d] has %d files", sg_idx, len(size_group)
                )
                if len(size_group) < 2:
                    continue
                if use_duration:
                    dur_clusters = _cluster_by_duration(size_group, tolerance=duration_tolerance)
                else:
                    dur_clusters = [size_group]

                logger.warning(
                    "find_duplicates: size_group[%d] -> %d dur_clusters", sg_idx, len(dur_clusters)
                )
                for dur_cluster in dur_clusters:
                    if len(dur_cluster) < 2:
                        continue
                    if use_phash:
                        phash_groups = _cluster_by_phash(
                            dur_cluster,
                            threshold=phash_threshold,
                            mode=phash_mode,
                            on_file=_on_phash_file,
                            job_id=job_id,
                        )
                    else:
                        phash_groups = [dur_cluster]

                    for group in phash_groups:
                        if len(group) >= 2:
                            cached = [_snapshot(f) for f in group]
                            confirmed.append(
                                DuplicateGroup(
                                    files=cached,
                                    keep_id=_pick_keep(cached),
                                )
                            )
        except _Cancelled:
            was_cancelled = True

        if was_cancelled:
            clear_cancel(job_id)
            if job:
                job.status = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
            return []

        logger.warning("find_duplicates: %d confirmed duplicate groups", len(confirmed))
        _results[library_id] = confirmed

        if job_id is not None:
            clear_cancel(job_id)
        if job:
            job.status = JobStatus.COMPLETED
            job.finished_at = now()
            job.progress = 100.0
            job.processed_files = total_files
            db.commit()

        return confirmed
    except Exception as e:
        logger.exception("Duplicate scan failed for library %d: %s", library_id, e)
        if job_id is not None:
            clear_cancel(job_id)
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
        raise
    finally:
        db.close()


def get_cached_results(library_id: int) -> list[DuplicateGroup] | None:
    return _results.get(library_id)
