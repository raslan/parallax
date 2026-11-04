import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.image import ImageFile, ImageStatus
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.schemas import (
    UpscaleSkipped,
    UpscaleStartRequest,
    UpscaleStartResponse,
    UpscaleTierRead,
    UpscaleTiersResponse,
)
from app.services.image_upscaler import header_size, run_image_upscale_job
from app.services.upscale_models import allowed_scales, credits, get_tier, list_tiers
from app.services.upscale_plan import skip_reason
from app.services.upscale_runtime import gpu_available

router = APIRouter(prefix="/image-upscale", tags=["image-upscale"])


@router.get("/tiers", response_model=UpscaleTiersResponse)
def get_tiers():
    return UpscaleTiersResponse(
        tiers=[
            UpscaleTierRead(
                id=t.id,
                label=t.label,
                scale=t.scale,
                speed=t.speed,
                hint=t.hint,
                scales=list(allowed_scales(t)),
            )
            for t in list_tiers()
        ],
        gpu_available=gpu_available(),
    )


@router.get("/credits")
def get_credits():
    return credits()


@router.post("/start", response_model=UpscaleStartResponse)
async def start_upscale(req: UpscaleStartRequest, db: Session = Depends(get_db)):
    if not req.file_ids:
        raise HTTPException(422, "No files specified")
    tier = get_tier(req.tier)
    if req.scale not in allowed_scales(tier):
        raise HTTPException(
            422,
            f"{tier.label} can't produce {req.scale}× output — pick a smaller size or a 4× model",
        )

    if req.prescale < 100 and req.scale != tier.scale:
        raise HTTPException(
            422, f"Pre-scaling always runs {tier.label} at its native {tier.scale}× size"
        )

    ids = list(dict.fromkeys(req.file_ids))
    rows = db.query(ImageFile).filter(ImageFile.id.in_(ids)).all()
    if len(rows) != len(ids):
        raise HTTPException(422, "One or more file IDs not found")
    library_ids = {r.library_id for r in rows}
    if len(library_ids) != 1:
        raise HTTPException(422, "All files must be in the same library")
    library_id = library_ids.pop()

    active = (
        db.query(Job.id)
        .filter(
            Job.type == JobType.IMAGE_UPSCALE,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
        .first()
    )
    if active:
        raise HTTPException(409, "An upscale is already running")

    by_id = {r.id: (r.path, r.width, r.height, r.status) for r in rows}
    # Release the pooled connection before touching the filesystem (header reads can be slow).
    db.close()

    runnable: list[int] = []
    skipped: list[UpscaleSkipped] = []
    for fid in ids:
        path, width, height, status = by_id[fid]
        if status == ImageStatus.QUARANTINED:
            skipped.append(UpscaleSkipped(id=fid, reason="image is quarantined"))
            continue
        if not (width and height):
            size = header_size(path)
            width, height = size if size else (None, None)
        reason = skip_reason(path, width, height, req.scale, req.prescale)
        if reason:
            skipped.append(UpscaleSkipped(id=fid, reason=reason))
        else:
            runnable.append(fid)
    if not runnable:
        raise HTTPException(422, "None of the selected images can be upscaled")

    job = Job(
        type=JobType.IMAGE_UPSCALE,
        status=JobStatus.PENDING,
        library_id=library_id,
        total_files=len(runnable),
        settings=json.dumps(
            {
                "tier": req.tier,
                "scale": req.scale,
                "prescale": req.prescale,
                "replace": req.replace,
                "keep_original": req.keep_original,
                "force_cpu": req.force_cpu,
                "skipped": [s.model_dump() for s in skipped],
            }
        ),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    job_id = job.id

    await enqueue(
        job_id,
        run_image_upscale_job,
        job_id,
        runnable,
        req.tier,
        req.scale,
        req.force_cpu,
        req.prescale,
        req.replace,
        req.keep_original,
    )
    return UpscaleStartResponse(job_id=job_id, skipped=skipped)
