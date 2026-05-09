from sqlalchemy.orm import Session

from app.models.job import Job, JobStatus


def active_job_exists(db: Session, library_id: int, job_type: str) -> bool:
    return db.query(Job).filter(
        Job.library_id == library_id,
        Job.type == job_type,
        Job.status.in_([JobStatus.RUNNING, JobStatus.PENDING]),
    ).first() is not None
