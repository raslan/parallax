from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import stats as stats_service

router = APIRouter(prefix="/stats", tags=["stats"])

# 0 means "all time" on the wire; the service treats a falsy `days` as unbounded.
Days = Query(0, ge=0, le=3650, description="Look-back window in days; 0 = all time")


class StatsSummary(BaseModel):
    jobs: int
    jobs_completed: int
    files: int
    bytes_in: int
    bytes_out: int
    bytes_saved: int
    media_seconds: float
    busy_seconds: float
    first_event: datetime | None


class TimeseriesPoint(BaseModel):
    t: str
    jobs: int
    files: int
    bytes_saved: int


class BreakdownRow(BaseModel):
    key: str
    jobs: int
    files: int
    bytes_saved: int


@router.get("/summary", response_model=StatsSummary)
def get_summary(days: int = Days, db: Session = Depends(get_db)):
    return stats_service.summary(db, days or None)


@router.get("/timeseries", response_model=list[TimeseriesPoint])
def get_timeseries(
    bucket: Literal["day", "week", "month"] = "day",
    days: int = Days,
    tz: int = Query(0, ge=-1440, le=1440, description="Minutes UTC is ahead of local time"),
    db: Session = Depends(get_db),
):
    return stats_service.timeseries(db, bucket, days or None, tz)


@router.get("/breakdown", response_model=list[BreakdownRow])
def get_breakdown(
    by: Literal["kind", "media", "status"] = "kind",
    days: int = Days,
    db: Session = Depends(get_db),
):
    return stats_service.breakdown(db, by, days or None)


@router.delete("", status_code=204)
def clear_stats(db: Session = Depends(get_db)):
    """Wipe all recorded statistics. Libraries, files and settings are untouched."""
    stats_service.clear(db)
