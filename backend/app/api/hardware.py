from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.services import gpu_accel
from app.services.gpu_pool import detect_gpus

router = APIRouter(prefix="/hardware", tags=["hardware"])

_ACTIVE = [JobStatus.PENDING, JobStatus.RUNNING]
_GPU_JOB_TYPES = [JobType.SUBTITLE_TRANSLATE, JobType.SUBTITLE_GENERATE]


class DetectedGpu(BaseModel):
    vendor: str
    label: str


class NvidiaPackage(BaseModel):
    installed: bool
    installed_bytes: int
    expected_bytes: int
    versions: dict[str, str]
    installing_job_id: int | None
    enabled: bool
    gpu_count: int  # the "GPUs to use" slider; 0 = all detected
    nvidia_gpus: int  # how many NVIDIA cards were detected
    gpus_in_use: int  # how many cards jobs will use right now (0 = processor)


class HardwareInfo(BaseModel):
    gpus: list[DetectedGpu]
    nvidia: NvidiaPackage


class CheckResult(BaseModel):
    ok: bool
    devices: int
    message: str


def _installing_job(db: Session) -> int | None:
    job = (
        db.query(Job)
        .filter(Job.type == JobType.NVIDIA_PACKAGE, Job.status.in_(_ACTIVE))
        .order_by(Job.id.desc())
        .first()
    )
    return job.id if job else None


@router.get("", response_model=HardwareInfo, summary="Detected GPUs and the NVIDIA package")
def get_hardware(db: Session = Depends(get_db)):
    enabled, count = gpu_accel.read_settings(db)
    return HardwareInfo(
        gpus=[DetectedGpu(vendor=d.vendor, label=d.label) for d in detect_gpus()],
        nvidia=NvidiaPackage(
            installed=gpu_accel.installed(),
            installed_bytes=gpu_accel.installed_bytes(),
            expected_bytes=gpu_accel.EXPECTED_BYTES,
            versions=gpu_accel.installed_versions(),
            installing_job_id=_installing_job(db),
            enabled=enabled,
            gpu_count=count,
            nvidia_gpus=len(gpu_accel.nvidia_devices()),
            gpus_in_use=len(gpu_accel.job_devices(enabled, count)),
        ),
    )


@router.post("/nvidia/install", status_code=202, summary="Install or update the NVIDIA package")
async def install_nvidia(db: Session = Depends(get_db)):
    if _installing_job(db) is not None:
        raise HTTPException(409, "The NVIDIA package is already being installed")
    if db.query(Job).filter(Job.type.in_(_GPU_JOB_TYPES), Job.status.in_(_ACTIVE)).first():
        raise HTTPException(409, "A translation or speech job is running; update when it is done")
    job = Job(type=JobType.NVIDIA_PACKAGE, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(job.id, gpu_accel.run_install_job, job.id)
    return {"job_id": job.id}


@router.delete("/nvidia", status_code=204, summary="Remove the NVIDIA package")
def remove_nvidia(db: Session = Depends(get_db)):
    if _installing_job(db) is not None:
        raise HTTPException(409, "The NVIDIA package is being installed; cancel that first")
    if db.query(Job).filter(Job.type.in_(_GPU_JOB_TYPES), Job.status.in_(_ACTIVE)).first():
        raise HTTPException(
            409, "A translation or speech job is running; remove it when it is done"
        )
    if not gpu_accel.remove():
        raise HTTPException(404, "The NVIDIA package is not installed")


@router.post("/nvidia/check", response_model=CheckResult, summary="Test that the GPU works")
def check_nvidia():
    """A tiny CUDA test in a fresh process. Says what to fix if the GPU cannot be used."""
    return gpu_accel.check()
