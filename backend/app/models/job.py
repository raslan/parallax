from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class JobType:
    SCAN = "scan"
    TRANSCODE = "transcode"
    DUPLICATES = "duplicates"
    IMAGE_SCAN = "image_scan"
    IMAGE_DUPLICATES = "image_duplicates"
    IMAGE_CONTENT_SCAN = "image_content_scan"
    MODEL_DOWNLOAD = "model_download"
    SUBTITLE_DOWNLOAD = "subtitle_download"
    COMPRESS = "compress"
    PHASH_SCAN = "phash_scan"
    TOOLBOX_FIX = "toolbox_fix"
    THUMBNAIL_WARM = "thumbnail_warm"
    SUBTITLE_SYNC = "subtitle_sync"
    AUDIO_SCAN = "audio_scan"
    AUDIO_COMPRESS = "audio_compress"
    AUDIO_TOOLBOX = "audio_toolbox"
    AUDIO_DUPLICATES = "audio_duplicates"
    SPLICE_MERGE = "splice_merge"
    IMAGE_UPSCALE = "image_upscale"


# Which library kind a job type belongs to. Video, image and audio library ids all count from 1
# and `Job` has no kind column, so deleting a library may only cancel / detach the jobs of its
# own kind — otherwise deleting video library 1 stops the running scan of image library 1.
# `THUMBNAIL_WARM` is run by both video and image libraries and cannot be told apart, so it is in
# both sets (a stray warm-up cancel is harmless).
AUDIO_LIBRARY_JOB_TYPES = (
    JobType.AUDIO_SCAN,
    JobType.AUDIO_COMPRESS,
    JobType.AUDIO_TOOLBOX,
    JobType.AUDIO_DUPLICATES,
)
IMAGE_LIBRARY_JOB_TYPES = (
    JobType.IMAGE_SCAN,
    JobType.IMAGE_DUPLICATES,
    JobType.IMAGE_CONTENT_SCAN,
    JobType.IMAGE_UPSCALE,
    JobType.THUMBNAIL_WARM,
)
# Everything that is neither audio nor image-only is a video-library job (scan, compress,
# duplicates, toolbox, splice, subtitles, ...).
_NOT_VIDEO_JOB_TYPES = (
    *AUDIO_LIBRARY_JOB_TYPES,
    *(t for t in IMAGE_LIBRARY_JOB_TYPES if t != JobType.THUMBNAIL_WARM),
)


def video_library_job_filter():
    """SQL clause selecting the job types a video library owns."""
    return Job.type.notin_(_NOT_VIDEO_JOB_TYPES)


class JobStatus:
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default=JobStatus.PENDING)
    library_id: Mapped[int | None] = mapped_column(nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    total_files: Mapped[int] = mapped_column(Integer, default=0)
    processed_files: Mapped[int] = mapped_column(Integer, default=0)
    settings: Mapped[str] = mapped_column(Text, nullable=True)
    current_file: Mapped[str] = mapped_column(Text, nullable=True)
    error: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)


class JobLog(Base):
    __tablename__ = "job_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    level: Mapped[str] = mapped_column(String(16), default="info")
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
