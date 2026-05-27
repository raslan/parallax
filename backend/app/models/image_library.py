from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class ImageLibrary(Base):
    __tablename__ = "image_libraries"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_scanned_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
