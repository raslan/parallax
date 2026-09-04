from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class JobType:
    SCAN = "scan"
    TRANSCODE = "transcode"
    DUPLICATES = "duplicates"
    IMAGE_SCAN = "image_scan"
    MODEL_DOWNLOAD = "model_download"
    SUBTITLE_DOWNLOAD = "subtitle_download"
    WHISPER_TRANSCRIBE = "whisper_transcribe"
    COMPRESS = "compress"
    PHASH_SCAN = "phash_scan"
    TOOLBOX_FIX = "toolbox_fix"
    THUMBNAIL_WARM = "thumbnail_warm"
    SUBTITLE_SYNC = "subtitle_sync"


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
