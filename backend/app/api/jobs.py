from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus
from app.schemas import JobRead

router = APIRouter(prefix="/jobs", tags=["jobs"])


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


@router.post("/{job_id}/cancel", status_code=202)
def cancel_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status not in (JobStatus.RUNNING, JobStatus.PENDING):
        raise HTTPException(400, "Job is not running")
    from app.services.scanner import cancel_scan
    cancel_scan(job_id)
    return {"message": "Cancellation requested"}


@router.delete("/history", status_code=204)
def clear_history(db: Session = Depends(get_db)):
    """Delete all jobs that are no longer active (completed, failed, cancelled)."""
    from app.models.job import JobLog
    ended = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]
    job_ids = [j.id for j in db.query(Job.id).filter(Job.status.in_(ended))]
    if job_ids:
        db.query(JobLog).filter(JobLog.job_id.in_(job_ids)).delete(synchronize_session=False)
        db.query(Job).filter(Job.id.in_(job_ids)).delete(synchronize_session=False)
        db.commit()
