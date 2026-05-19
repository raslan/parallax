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
class DuplicateGroup:
    files: list[File]
    keep_id: int


# Last result per library_id — cleared on each new scan
_results: dict[int, list[DuplicateGroup]] = {}


def _pick_keep(files: list[File]) -> int:
    """Highest bitrate → largest size → shortest path."""
    return sorted(
        files,
        key=lambda f: (-(f.video_bitrate or 0), -(f.size or 0), f.path),
    )[0].id


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


def _cluster_by_duration(files: list[File], tolerance: float = 1.0) -> list[list[File]]:
    """Group files whose duration is within ±tolerance seconds of each other."""
    groups: list[list[File]] = []
    remaining = list(files)
    while remaining:
        anchor = remaining.pop(0)
        anchor_dur = anchor.duration or 0.0
        group = [anchor]
        rest = []
        for f in remaining:
            if abs((f.duration or 0.0) - anchor_dur) <= tolerance:
                group.append(f)
            else:
                rest.append(f)
        remaining = rest
        if len(group) > 1:
            groups.append(group)
    return groups


def _cluster_by_phash(files: list[File], threshold: int = 10) -> list[list[File]]:
    """Extract pHash for each file and group pairs with Hamming distance ≤ threshold."""
    hashes: list[tuple[File, "imagehash.ImageHash"]] = []
    for f in files:
        if not os.path.exists(f.path):
            logger.warning("File not on disk, skipping: %s", f.path)
            continue
        h = _extract_phash(f.path)
        if h is None:
            continue
        hashes.append((f, h))

    if len(hashes) < 2:
        return []

    groups: list[list[File]] = []
    used: set[int] = set()
    for i, (fi, hi) in enumerate(hashes):
        if i in used:
            continue
        group = [fi]
        used.add(i)
        for j, (fj, hj) in enumerate(hashes):
            if j <= i or j in used:
                continue
            if (hi - hj) <= threshold:
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

        if use_size:
            dup_sizes = (
                db.query(File.size)
                .filter(File.library_id == library_id)
                .group_by(File.size)
                .having(func.count(File.id) > 1)
                .all()
            )
            size_values = [row[0] for row in dup_sizes]
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

        confirmed: list[DuplicateGroup] = []
        for size_group in size_groups:
            if len(size_group) < 2:
                continue
            if use_duration:
                dur_clusters = _cluster_by_duration(size_group)
            else:
                dur_clusters = [size_group]

            for dur_cluster in dur_clusters:
                if len(dur_cluster) < 2:
                    continue
                if use_phash:
                    phash_groups = _cluster_by_phash(dur_cluster)
                else:
                    phash_groups = [dur_cluster]

                for group in phash_groups:
                    if len(group) >= 2:
                        confirmed.append(DuplicateGroup(
                            files=group,
                            keep_id=_pick_keep(group),
                        ))

        _results[library_id] = confirmed

        if job:
            job.status = JobStatus.COMPLETED
            job.finished_at = now()
            job.progress = 100.0
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
