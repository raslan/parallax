from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class ImageStatus:
    PENDING = "pending"
    SCANNED = "scanned"
    QUARANTINED = "quarantined"
    FAILED = "failed"


class ImageFile(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("image_libraries.id"), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    extension: Mapped[str] = mapped_column(String(16), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=True)
    height: Mapped[int] = mapped_column(Integer, nullable=True)
    exif_date: Mapped[float] = mapped_column(Float, nullable=True)
    exif_gps: Mapped[str] = mapped_column(Text, nullable=True)
    exif_camera: Mapped[str] = mapped_column(String(256), nullable=True)
    phash: Mapped[int] = mapped_column(Integer, nullable=True)
    siglip_embedding: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default=ImageStatus.PENDING)
    scan_error: Mapped[str] = mapped_column(Text, nullable=True)
    scanned_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ImageDetection(Base):
    __tablename__ = "image_detections"

    id: Mapped[int] = mapped_column(primary_key=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("images.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_json: Mapped[str] = mapped_column(Text, nullable=True)
