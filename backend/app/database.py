import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATA_DIR = os.environ.get("DATA_DIR", "/app/data")
os.makedirs(DATA_DIR, exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR}/transcoder.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app.models import library, file, job, schedule, settings  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # Lightweight migrations for columns added after initial creation
    with engine.begin() as conn:
        for sql in [
            "ALTER TABLE libraries ADD COLUMN last_scanned_at DATETIME",
            "ALTER TABLE jobs ADD COLUMN current_file TEXT",
            "ALTER TABLE files ADD COLUMN codec_name TEXT",
            "ALTER TABLE files ADD COLUMN video_bitrate INTEGER",
            "ALTER TABLE files ADD COLUMN file_width INTEGER",
            "ALTER TABLE files ADD COLUMN file_height INTEGER",
            "ALTER TABLE files ADD COLUMN file_fps REAL",
            "ALTER TABLE files ADD COLUMN file_date REAL",
        ]:
            try:
                conn.execute(text(sql))
            except Exception:
                pass  # column already exists
