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
from app.models.file import File
from app.models.job import Job, JobStatus
from app.services.common import now

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
    logger.warning("_cluster_by_duration: %d files, tolerance=%.1f, sample durations: %s", len(sorted_files), tolerance, durations)
    groups: list[list[File]] = []
    i = 0
    while i < len(sorted_files):
        anchor_dur = sorted_files[i].duration or 0.0
        group = []
        j = i
        while j < len(sorted_files) and abs((sorted_files[j].duration or 0.0) - anchor_dur) <= tolerance:
            group.append(sorted_files[j])
            j += 1
        if len(group) > 1:
            groups.append(group)
        i = j if j > i else i + 1
    logger.warning("_cluster_by_duration: found %d groups", len(groups))
    return groups


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _frames_distance(frames_a: list[int], frames_b: list[int]) -> float:
    """Average of per-frame minimum Hamming distances (avg-of-minimums)."""
    total = 0.0
    for ha in frames_a:
        total += min(_hamming(ha, hb) for hb in frames_b)
    for hb in frames_b:
        total += min(_hamming(ha, hb) for ha in frames_a)
    return total / (len(frames_a) + len(frames_b))


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

    single: "imagehash.ImageHash | None" = None
    if f.phash is not None:
        single = imagehash.ImageHash(
            __import__("numpy").array(
                [(f.phash >> (63 - i)) & 1 for i in range(64)], dtype=bool
            ).reshape(8, 8)
        )
    elif not frames:
        single = _extract_phash(f.path)
        if single is not None:
            frames = [int(str(single), 16)]

    return single, frames


def _cluster_by_phash(files: list[File], threshold: int = 10, mode: str = "all_frames", on_file=None) -> list[list[File]]:
    """Group files by pHash similarity. Uses stored multi-frame hashes when available and mode='all_frames'."""
    entries: list[tuple[File, "imagehash.ImageHash | None", list[int]]] = []
    for f in files:
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

        _results.pop(library_id, None)

        logger.warning("find_duplicates: library=%d use_size=%s use_duration=%s use_phash=%s", library_id, use_size, use_duration, use_phash)

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

        logger.warning("find_duplicates: %d candidates, %d size_groups", len(candidates), len(size_groups))
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
        for sg_idx, size_group in enumerate(size_groups):
            logger.warning("find_duplicates: size_group[%d] has %d files", sg_idx, len(size_group))
            if len(size_group) < 2:
                continue
            if use_duration:
                dur_clusters = _cluster_by_duration(size_group, tolerance=duration_tolerance)
            else:
                dur_clusters = [size_group]

            logger.warning("find_duplicates: size_group[%d] -> %d dur_clusters", sg_idx, len(dur_clusters))
            for dur_cluster in dur_clusters:
                if len(dur_cluster) < 2:
                    continue
                if use_phash:
                    phash_groups = _cluster_by_phash(dur_cluster, threshold=phash_threshold, mode=phash_mode, on_file=_on_phash_file)
                else:
                    phash_groups = [dur_cluster]

                for group in phash_groups:
                    if len(group) >= 2:
                        cached = [_snapshot(f) for f in group]
                        confirmed.append(DuplicateGroup(
                            files=cached,
                            keep_id=_pick_keep(cached),
                        ))

        logger.warning("find_duplicates: %d confirmed duplicate groups", len(confirmed))
        _results[library_id] = confirmed

        if job:
            job.status = JobStatus.COMPLETED
            job.finished_at = now()
            job.progress = 100.0
            job.processed_files = total_files
            db.commit()

        return confirmed
    except Exception as e:
        logger.exception("Duplicate scan failed for library %d: %s", library_id, e)
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
