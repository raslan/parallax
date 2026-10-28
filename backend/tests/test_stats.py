from datetime import datetime, timedelta

from app.models.library import Library
from app.models.stats import StatEvent
from app.services import stats as stats_service


def _event(db, **kw):
    defaults = dict(kind="compress", media="video", status="completed", files=1)
    defaults.update(kw)
    db.add(StatEvent(**defaults))
    db.flush()


def test_summary_counts_savings_for_completed_jobs_only(db):
    _event(db, bytes_in=1000, bytes_out=400, files=2)
    _event(db, bytes_in=500, bytes_out=500)
    _event(db, status="failed", bytes_in=9999, bytes_out=1)
    s = stats_service.summary(db)
    assert s["jobs"] == 3
    assert s["jobs_completed"] == 2
    assert s["bytes_saved"] == 600
    assert s["files"] == 3


def test_growth_is_negative_savings(db):
    _event(db, bytes_in=100, bytes_out=150)
    assert stats_service.summary(db)["bytes_saved"] == -50


def test_events_without_sizes_save_nothing(db):
    _event(db, kind="scan", bytes_in=None, bytes_out=None)
    assert stats_service.summary(db)["bytes_saved"] == 0


def test_days_window_excludes_old_events(db):
    _event(db, ts=datetime.utcnow() - timedelta(days=40), bytes_in=100, bytes_out=0)
    _event(db, bytes_in=10, bytes_out=0)
    assert stats_service.summary(db, 30)["bytes_saved"] == 10
    assert stats_service.summary(db, None)["bytes_saved"] == 110


def test_timeseries_buckets_by_day_and_month(db):
    _event(db, ts=datetime(2026, 5, 3, 10), bytes_in=10, bytes_out=0)
    _event(db, ts=datetime(2026, 5, 3, 22), bytes_in=20, bytes_out=0)
    _event(db, ts=datetime(2026, 6, 1, 9), bytes_in=5, bytes_out=0)
    daily = stats_service.timeseries(db, "day", None)
    assert [(p["t"], p["bytes_saved"], p["jobs"]) for p in daily] == [
        ("2026-05-03", 30, 2),
        ("2026-06-01", 5, 1),
    ]
    monthly = stats_service.timeseries(db, "month", None)
    assert [p["t"] for p in monthly] == ["2026-05-01", "2026-06-01"]


def test_breakdown_orders_biggest_savers_first(db):
    _event(db, kind="compress", bytes_in=100, bytes_out=10)
    _event(db, kind="audio_compress", media="audio", bytes_in=1000, bytes_out=100)
    _event(db, kind="scan", bytes_in=None, bytes_out=None)
    assert [r["key"] for r in stats_service.breakdown(db, "kind")] == [
        "audio_compress",
        "compress",
        "scan",
    ]
    assert {r["key"] for r in stats_service.breakdown(db, "media")} == {"video", "audio"}


def test_clear_removes_every_event(db):
    _event(db)
    _event(db)
    assert stats_service.clear(db) == 2
    assert stats_service.summary(db)["jobs"] == 0


def test_events_survive_deleting_a_library(db):
    lib = Library(name="x", path="/tmp/x")
    db.add(lib)
    _event(db, bytes_in=10, bytes_out=0)
    db.delete(lib)
    db.flush()
    assert stats_service.summary(db)["bytes_saved"] == 10


def test_stat_event_has_no_file_or_library_columns():
    columns = set(StatEvent.__table__.columns.keys())
    assert not columns & {"path", "filename", "url", "library_id", "library_name", "file_id"}
