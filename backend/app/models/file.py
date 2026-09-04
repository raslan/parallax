from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FileStatus:
    UNKNOWN = "unknown"
    QUEUED = "queued"
    TRANSCODING = "transcoding"
    DONE = "done"
    FAILED = "failed"


class File(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id"), nullable=False)
    path: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    size: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[float] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default=FileStatus.UNKNOWN)
    codec_name: Mapped[str] = mapped_column(String(64), nullable=True)
    video_bitrate: Mapped[int] = mapped_column(Integer, nullable=True)
    scan_error: Mapped[str] = mapped_column(String(2048), nullable=True)
    scanned_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    transcoded_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    file_width: Mapped[int] = mapped_column(Integer, nullable=True)
    file_height: Mapped[int] = mapped_column(Integer, nullable=True)
    file_fps: Mapped[float] = mapped_column(Float, nullable=True)
    file_date: Mapped[float] = mapped_column(Float, nullable=True)
    file_mtime: Mapped[float] = mapped_column(Float, nullable=True)
    extension: Mapped[str] = mapped_column(String(16), nullable=True)
    clip_embedding: Mapped[str] = mapped_column(Text, nullable=True)
    phash: Mapped[int] = mapped_column(Integer, nullable=True)
    phash_frames: Mapped[str] = mapped_column(Text, nullable=True)  # JSON array of ints
    phash_scanned_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    byte_hash: Mapped[str] = mapped_column(String(32), nullable=True)
    audio_fingerprint: Mapped[str] = mapped_column(Text, nullable=True)  # JSON array of int32
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
