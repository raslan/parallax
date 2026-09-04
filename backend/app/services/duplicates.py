import concurrent.futures as _cf
import json
import logging

from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus
from app.models.settings import get_setting
from app.services.audio_fingerprint import compute_audio_fingerprint
from app.services.byte_hash import compute_byte_hash
from app.services.common import arm_cancel, clear_cancel, now, should_cancel
from app.services.phash_scanner import _Cancelled, _extract_phash_frames

logger = logging.getLogger(__name__)


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


def find_duplicates(library_id: int, job_id: int, criteria: dict) -> None:
    """Extraction-only: no comparison, no cached result. Scopes ffmpeg work
    to files that survive the free-tier funnel first (Task 4), then
    extracts whichever of byte-hash / pHash / audio-fingerprint are
    enabled and not already cached at the requested fidelity. All
    comparison happens client-side (see frontend/src/lib/clusterDuplicates.ts)
    against the columns this job fills in.
    """
    db = SessionLocal()
    job = db.get(Job, job_id)
    try:
        if job:
            job.status = JobStatus.RUNNING
            job.started_at = now()
            db.commit()
            arm_cancel(job_id)

        all_files = (
            db.query(File)
            .filter(
                File.library_id == library_id,
                File.status.in_([FileStatus.DONE, FileStatus.UNKNOWN]),
            )
            .all()
        )
        by_id = {f.id: f for f in all_files}

        plain = [
            {
                "id": f.id,
                "size": f.size,
                "duration": f.duration,
                "file_width": f.file_width,
                "file_height": f.file_height,
                "file_date": f.file_date,
                "video_bitrate": f.video_bitrate,
                "filename": f.filename,
            }
            for f in all_files
        ]
        candidate_ids = scope_extraction_candidates(plain, criteria)

        to_extract: list[File] = []
        for fid in candidate_ids:
            f = by_id[fid]
            needs_byte_hash = criteria["use_byte_hash"] and f.byte_hash is None
            needs_phash = criteria["use_phash"] and _needs_phash_rescan(f, criteria)
            needs_audio = criteria["use_audio"] and f.audio_fingerprint is None
            if needs_byte_hash or needs_phash or needs_audio:
                to_extract.append(f)

        if job:
            job.total_files = len(to_extract)
            db.commit()

        if not to_extract:
            _finish(db, job, cancelled=False)
            return

        n_concurrent = max(1, int(get_setting(db, "scan_prefetch", "4")))
        by_id_extract = {f.id: f for f in to_extract}
        work_items = [(f.id, f.path) for f in to_extract]

        def _extract_one(file_id: int, path: str) -> tuple[int, dict, str | None]:
            result: dict = {}
            try:
                if criteria["use_byte_hash"]:
                    result["byte_hash"] = compute_byte_hash(path)
                if criteria["use_phash"]:
                    frames = (
                        1 if criteria["phash_mode"] == "first_frame" else criteria["phash_frames"]
                    )
                    result["phash_frames"] = _extract_phash_frames(path, frames, job_id)
                if criteria["use_audio"]:
                    result["audio_fingerprint"] = compute_audio_fingerprint(path, job_id)
                return file_id, result, None
            except _Cancelled:
                return file_id, {}, "cancelled"
            except Exception as exc:
                return file_id, {}, str(exc)

        completed = 0
        was_cancelled = False
        with _cf.ThreadPoolExecutor(max_workers=n_concurrent) as pool:
            pending = {pool.submit(_extract_one, fid, path) for fid, path in work_items}
            while pending:
                done, pending = _cf.wait(pending, timeout=2.0)
                if should_cancel(job_id):
                    was_cancelled = True
                    for fut in pending:
                        fut.cancel()
                    _cf.wait(pending)
                    pending = set()

                for fut in done:
                    try:
                        fid, result, err = fut.result()
                    except _cf.CancelledError:
                        continue
                    f = by_id_extract[fid]
                    if err is None:
                        if "byte_hash" in result:
                            f.byte_hash = result["byte_hash"]
                        if "phash_frames" in result and result["phash_frames"]:
                            f.phash = result["phash_frames"][0]
                            f.phash_frames = json.dumps(result["phash_frames"])
                            f.phash_scanned_at = now()
                        if "audio_fingerprint" in result and result["audio_fingerprint"]:
                            f.audio_fingerprint = json.dumps(result["audio_fingerprint"])
                        completed += 1
                    elif err != "cancelled":
                        logger.warning("Extraction failed for %s: %s", f.filename, err)

                db.commit()
                if job:
                    job.processed_files = completed
                    job.progress = (
                        min(99.0, completed / len(to_extract) * 100) if to_extract else 100.0
                    )
                    db.commit()

        _finish(db, job, cancelled=was_cancelled)
    except Exception as e:
        logger.exception("Duplicate extraction failed for library %d: %s", library_id, e)
        clear_cancel(job_id)
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
        raise
    finally:
        db.close()


def _needs_phash_rescan(f: File, criteria: dict) -> bool:
    if criteria["phash_mode"] == "first_frame":
        return f.phash is None
    if f.phash_scanned_at is None or not f.phash_frames:
        return True
    try:
        return len(json.loads(f.phash_frames)) != criteria["phash_frames"]
    except Exception:
        return True


def _finish(db, job, cancelled: bool) -> None:
    clear_cancel(job.id if job else None)
    if not job:
        return
    if cancelled:
        job.status = JobStatus.CANCELLED
    else:
        job.status = JobStatus.COMPLETED
        job.progress = 100.0
    job.finished_at = now()
    db.commit()
