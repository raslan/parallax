import os
import random

from app.database import SessionLocal
from app.models.file import File, FileStatus


def _truncate(path: str, seed: int) -> None:
    size = os.path.getsize(path)
    rng = random.Random(seed)
    # Keep 85–95% so most content survives but seeking near the end fails
    keep = rng.uniform(0.85, 0.95)
    with open(path, "r+b") as f:
        f.truncate(int(size * keep))


def corrupt_library(library_id: int) -> None:
    db = SessionLocal()
    try:
        files = db.query(File).filter(File.library_id == library_id).all()
        for i, f in enumerate(files):
            if not os.path.exists(f.path):
                continue
            try:
                _truncate(f.path, seed=library_id * 1000 + i)
                f.status = FileStatus.CORRUPT
                f.scan_error = "Manually corrupted for testing"
            except OSError:
                pass
        db.commit()
    finally:
        db.close()
