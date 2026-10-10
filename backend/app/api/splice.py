import json
import os
import shutil
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.database import SessionLocal
from app.models.file import File
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.services import splice as sp

router = APIRouter()


Codec = Literal["h264", "hevc", "av1"]
Speed = Literal["slow", "medium", "fast"]


class SpliceReencode(BaseModel):
    codec: Codec = "h264"
    crf: int = Field(23, ge=0, le=63)
    speed: Speed = "medium"
    reference_file_id: int | None = None
    force_cpu: bool = False  # skip any hardware encoder (GPU unusable on this host)


class SplicePreflightRequest(BaseModel):
    file_ids: list[int]
    reference_file_id: int | None = None
    output_name: str | None = None
    codec: Codec = "h264"


class SpliceMergeRequest(BaseModel):
    file_ids: list[int]
    output_name: str
    chapters: bool = True
    reencode: SpliceReencode | None = None


@dataclass(frozen=True)
class _Source:
    """The few `File` columns the routes need, copied out so the DB session can be
    closed before any ffprobe runs (a pooled connection must never be held across a
    subprocess — see CODE_CONVENTIONS backend B4)."""

    id: int
    path: str
    filename: str
    size: int
    library_id: int


def _load_ordered(file_ids: list[int]) -> list[_Source]:
    if len(file_ids) < 2:
        raise HTTPException(422, "Pick at least two files")
    if len(set(file_ids)) != len(file_ids):
        raise HTTPException(422, "Duplicate files in selection")
    db = SessionLocal()
    try:
        rows = {
            f.id: _Source(f.id, f.path, f.filename, f.size or 0, f.library_id)
            for f in db.query(File).filter(File.id.in_(file_ids)).all()
        }
    finally:
        db.close()
    if len(rows) != len(file_ids):
        raise HTTPException(422, "One or more file IDs not found")
    ordered = [rows[i] for i in file_ids]
    if len({f.library_id for f in ordered}) != 1:
        raise HTTPException(422, "All files must be in the same library")
    return ordered


def _clean_name(name: str) -> str:
    try:
        return sp.validate_output_name(name)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


def _target(files: list[_Source], stem: str, ext: str) -> tuple[str, bool]:
    out_dir = os.path.dirname(files[0].path)
    target = os.path.join(out_dir, stem + ext)
    sources = {f.path for f in files}
    return target, (os.path.exists(target) and target not in sources)


def _facts_for(files: list[_Source]) -> list[sp.StreamFacts]:
    try:
        return [sp.probe_facts(f.path) for f in files]
    except sp.ProbeError as e:
        raise HTTPException(422, str(e)) from e


def _reference_index(files: list[_Source], reference_file_id: int | None) -> int:
    ref_id = reference_file_id or files[0].id
    idx = next((i for i, f in enumerate(files) if f.id == ref_id), None)
    if idx is None:
        raise HTTPException(422, "reference_file_id is not in the selection")
    return idx


@router.post("/splice/preflight")
def preflight(req: SplicePreflightRequest):
    files = _load_ordered(req.file_ids)
    ref_idx = _reference_index(files, req.reference_file_id)
    facts = _facts_for(files)
    ref = facts[ref_idx]
    verdict = sp.verdict_for(ref, facts)
    ext = sp.pick_output_ext(
        verdict, os.path.splitext(files[0].path)[1], req.codec if verdict == "reencode" else None
    )
    out_dir = os.path.dirname(files[0].path)
    conflict = False
    if req.output_name is not None:
        _, conflict = _target(files, _clean_name(req.output_name), ext)
    return {
        "verdict": verdict,
        "reference_file_id": files[ref_idx].id,
        "output_ext": ext,
        "output_dir": out_dir,
        "name_conflict": conflict,
        "free_bytes": shutil.disk_usage(out_dir).free,
        "total_duration": sum(f.duration for f in facts),
        "total_size": sum(f.size for f in files),
        "files": [
            {
                "file_id": f.id,
                "filename": f.filename,
                "size": f.size,
                "duration": fa.duration,
                "width": fa.width,
                "height": fa.height,
                "fps": fa.fps,
                "vcodec": fa.vcodec,
                "acodec": fa.acodec,
                "reasons": [] if i == ref_idx else sp.mismatch_reasons(ref, fa),
            }
            for i, (f, fa) in enumerate(zip(files, facts, strict=True))
        ],
    }


def _create_job(files: list[_Source], settings: dict) -> int:
    db = SessionLocal()
    try:
        job = Job(
            type=JobType.SPLICE_MERGE,
            status=JobStatus.PENDING,
            library_id=files[0].library_id,
            settings=json.dumps(settings),
            total_files=1,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return job.id
    finally:
        db.close()


@router.post("/splice/merge")
async def start_merge(req: SpliceMergeRequest):
    stem = _clean_name(req.output_name)
    files = _load_ordered(req.file_ids)
    ref_idx = _reference_index(files, req.reencode.reference_file_id if req.reencode else None)
    # ffprobe is blocking subprocess work — keep it off the event loop
    facts = await run_in_threadpool(_facts_for, files)
    verdict = sp.verdict_for(facts[ref_idx], facts)
    if verdict == "reencode" and req.reencode is None:
        raise HTTPException(
            422, "Files are not stream-copy compatible; re-encode settings required"
        )
    codec = req.reencode.codec if (req.reencode and verdict == "reencode") else None
    ext = sp.pick_output_ext(verdict, os.path.splitext(files[0].path)[1], codec)
    _, conflict = _target(files, stem, ext)
    if conflict:
        raise HTTPException(409, f"{stem}{ext} already exists in the output folder")

    settings = {
        "file_ids": req.file_ids,
        "output_name": stem,
        "chapters": req.chapters,
        "verdict": verdict,
        "reencode": (
            req.reencode.model_dump(exclude={"force_cpu"})
            if (req.reencode and verdict == "reencode")
            else None
        ),
        "reference_index": ref_idx,
        "force_cpu": bool(req.reencode and req.reencode.force_cpu),
    }
    job_id = _create_job(files, settings)
    await enqueue(
        job_id, sp.run_splice_job, job_id, req.file_ids, [f.path for f in files], settings
    )
    return {"job_id": job_id}


@router.post("/splice/jobs/{job_id}/retry-cpu")
async def retry_on_cpu(job_id: int):
    db = SessionLocal()
    try:
        old = db.get(Job, job_id)
        if old is None:
            raise HTTPException(404, "Job not found")
        if (
            old.type != JobType.SPLICE_MERGE
            or old.status != JobStatus.FAILED
            or not (old.error or "").startswith(sp.GPU_FAILED_PREFIX)
        ):
            raise HTTPException(
                409, "Only a splice job that failed on the GPU can be retried on CPU"
            )
        settings = {**json.loads(old.settings or "{}"), "force_cpu": True}
        active = (
            db.query(Job)
            .filter(
                Job.type == JobType.SPLICE_MERGE,
                Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
            )
            .all()
        )
        for j in active:
            other = json.loads(j.settings or "{}")
            if other.get("force_cpu") and other.get("file_ids") == settings["file_ids"]:
                raise HTTPException(409, "A CPU retry of this merge is already queued or running")
    finally:
        db.close()

    ids = settings["file_ids"]
    try:
        files = _load_ordered(ids)
    except HTTPException as e:
        raise HTTPException(409, "A source file is no longer available") from e
    if not all(os.path.exists(f.path) for f in files):
        raise HTTPException(409, "A source file is no longer available")
    new_id = _create_job(files, settings)
    await enqueue(new_id, sp.run_splice_job, new_id, ids, [f.path for f in files], settings)
    return {"job_id": new_id}
