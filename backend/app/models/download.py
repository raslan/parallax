from datetime import datetime
from sqlalchemy import String, Float, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class DownloadStatus:
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Download(Base):
    __tablename__ = "downloads"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=True)
    uploader: Mapped[str] = mapped_column(String(256), nullable=True)
    thumbnail_url: Mapped[str] = mapped_column(Text, nullable=True)
    duration: Mapped[float] = mapped_column(Float, nullable=True)  # seconds
    status: Mapped[str] = mapped_column(String(32), default=DownloadStatus.PENDING)
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0.0–100.0
    speed: Mapped[str] = mapped_column(String(64), nullable=True)  # e.g. "5.00MiB/s"
    eta: Mapped[str] = mapped_column(String(32), nullable=True)  # e.g. "00:10"
    error: Mapped[str] = mapped_column(Text, nullable=True)
    output_path: Mapped[str] = mapped_column(Text, nullable=True)  # final file path on disk
    output_dir: Mapped[str] = mapped_column(Text, nullable=False)  # target directory
    options: Mapped[str] = mapped_column(Text, nullable=True)  # JSON: {format, quality, audio_only, container, trim_start, trim_end, extra_args, subtitle_langs}
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
