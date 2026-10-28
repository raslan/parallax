from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StatEvent(Base):
    """One finished job, reduced to metrics.

    Deliberately file-agnostic and library-agnostic: no filenames, paths, URLs,
    library names or library ids ever land here, and nothing references the
    library/file/job tables, so deleting a library, purging all data, or pruning
    job history leaves these rows untouched. Only `DELETE /stats` clears them.
    """

    __tablename__ = "stats_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # JobType value
    media: Mapped[str] = mapped_column(String(16), nullable=False)  # video | image | audio | other
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    files: Mapped[int] = mapped_column(Integer, default=0)
    bytes_in: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    bytes_out: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    media_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Small JSON object of extra metrics (codec, encoder, ...). Never file/path data.
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
