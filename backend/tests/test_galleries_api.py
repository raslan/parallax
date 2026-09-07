from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus


def test_orphan_sweep_marks_running_and_pending_as_failed(engine):
    from app.database import SessionLocal, init_db
    from app.main import _reap_orphaned_galleries

    # Ensure the real SessionLocal engine (transcoder.db under DATA_DIR) has the
    # gallery_downloads table — _reap_orphaned_galleries opens its own session.
    init_db()

    ids = []
    s = SessionLocal()
    try:
        for st in (GalleryDownloadStatus.RUNNING, GalleryDownloadStatus.PENDING):
            row = GalleryDownload(url=f"https://example.com/{st}", status=st, output_dir="/tmp/x")
            s.add(row)
            s.flush()
            ids.append(row.id)
        s.commit()
    finally:
        s.close()

    _reap_orphaned_galleries()

    s = SessionLocal()
    try:
        for i in ids:
            r = s.get(GalleryDownload, i)
            assert r.status == GalleryDownloadStatus.FAILED
            assert "restart" in (r.error or "").lower()
            s.delete(r)
        s.commit()
    finally:
        s.close()
