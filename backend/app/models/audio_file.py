from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.file import FileStatus


class AudioFile(Base):
    __tablename__ = "audio_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("audio_libraries.id"), nullable=False)
    path: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    extension: Mapped[str] = mapped_column(String(16), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[float] = mapped_column(Float, nullable=True)
    codec_name: Mapped[str] = mapped_column(String(64), nullable=True)
    bitrate: Mapped[int] = mapped_column(Integer, nullable=True)
    sample_rate: Mapped[int] = mapped_column(Integer, nullable=True)
    channels: Mapped[int] = mapped_column(Integer, nullable=True)
    channel_layout: Mapped[str] = mapped_column(String(64), nullable=True)
    file_date: Mapped[float] = mapped_column(Float, nullable=True)
    file_mtime: Mapped[float] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default=FileStatus.UNKNOWN)
    scan_error: Mapped[str] = mapped_column(String(2048), nullable=True)
    scanned_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    compressed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
