import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models.job import Job, JobStatus
from app.schemas import JobRead

router = APIRouter(prefix="/jobs", tags=["jobs"])

# Map job types to display labels
JOB_TYPE_LABELS = {
    "scan": "Scan",
    "check": "Corruption check",
    "transcode": "Transcode",
    "duplicates": "Duplicate scan",
    "image_scan": "Image Scan",
}


@router.get("/stream")
async def stream_jobs():
    """SSE stream that pushes active job state every 500ms until all jobs settle."""
    async def generate():
        db = SessionLocal()
        try:
            last_payload = None
            idle_ticks = 0
            while True:
                db.expire_all()
                active = db.query(Job).filter(Job.status.in_([JobStatus.RUNNING, JobStatus.PENDING])).all()

                payload = json.dumps([
                    {
                        "id": j.id,
                        "type": j.type,
                        "status": j.status,
                        "progress": j.progress,
                        "processed_files": j.processed_files,
                        "total_files": j.total_files,
                        "current_file": j.current_file,
                        "error": j.error,
                        "library_id": j.library_id,
                        "started_at": j.started_at.isoformat() if j.started_at else None,
                    }
                    for j in active
                ])

                if payload != last_payload:
                    yield f"data: {payload}\n\n"
                    last_payload = payload
                    idle_ticks = 0
                else:
                    idle_ticks += 1

                # Slow down polling when idle; keep fast when jobs are running
                delay = 0.5 if active else min(2.0 + idle_ticks * 0.5, 10.0)
                await asyncio.sleep(delay)
        finally:
            db.close()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("", response_model=list[JobRead])
def list_jobs(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return db.query(Job).order_by(Job.created_at.desc()).limit(limit).all()


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/{job_id}/logs")
def get_job_logs(job_id: int, db: Session = Depends(get_db)):
    from app.models.job import JobLog
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    logs = db.query(JobLog).filter(JobLog.job_id == job_id).order_by(JobLog.timestamp).all()
    return [{"message": l.message, "level": l.level, "timestamp": l.timestamp.isoformat()} for l in logs]


@router.post("/{job_id}/cancel", status_code=202)
def cancel_job(job_id: int, db: Session = Depends(get_db)):
    from app.services.common import request_cancel, now
    from app.models.file import File, FileStatus
    from app.queue import cancel_pending

    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status not in (JobStatus.RUNNING, JobStatus.PENDING):
        raise HTTPException(400, "Job is not cancellable")

    if job.status == JobStatus.PENDING:
        cancel_pending(job_id)
        job.status = JobStatus.CANCELLED
        job.error = "Cancelled by user"
        job.finished_at = now()
        db.commit()
        # Restore any files that were set to QUEUED for this job
        if job.library_id:
            db.query(File).filter(
                File.library_id == job.library_id,
                File.status == FileStatus.QUEUED,
            ).update({"status": FileStatus.CORRUPT})
            db.commit()
    else:
        request_cancel(job_id)

    return {"message": "Cancelled"}


@router.delete("/history", status_code=204)
def clear_history(db: Session = Depends(get_db)):
    from app.models.job import JobLog
    ended = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]
    job_ids = [j.id for j in db.query(Job.id).filter(Job.status.in_(ended))]
    if job_ids:
        db.query(JobLog).filter(JobLog.job_id.in_(job_ids)).delete(synchronize_session=False)
        db.query(Job).filter(Job.id.in_(job_ids)).delete(synchronize_session=False)
        db.commit()
