from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GalleryDownloadStatus:
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class GalleryDownload(Base):
    __tablename__ = "gallery_downloads"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, default=GalleryDownloadStatus.PENDING)
    files_done: Mapped[int] = mapped_column(Integer, default=0)
    files_skipped: Mapped[int] = mapped_column(Integer, default=0)
    files_failed: Mapped[int] = mapped_column(Integer, default=0)
    last_filename: Mapped[str] = mapped_column(Text, nullable=True)
    recent_files: Mapped[str] = mapped_column(Text, nullable=True)  # JSON array, cap 15
    error: Mapped[str] = mapped_column(Text, nullable=True)
    log_tail: Mapped[str] = mapped_column(Text, nullable=True)  # rolling gallery-dl stderr tail
    output_dir: Mapped[str] = mapped_column(Text, nullable=False)
    options: Mapped[str] = mapped_column(Text, nullable=True)  # JSON snapshot at submit
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
