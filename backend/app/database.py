import os
from sqlalchemy import create_engine, event as _sa_event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATA_DIR = os.environ.get("DATA_DIR", "/app/data")
os.makedirs(DATA_DIR, exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR}/transcoder.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


@_sa_event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

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
    from app.models import library, file, job, schedule, settings, download  # noqa: F401
    from app.models import image_library, image  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # Drop stale FK on jobs.library_id — it referenced only `libraries` (video),
    # breaking image library scan jobs. Recreate table without the constraint.
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("SELECT sql FROM sqlite_master WHERE name='jobs'")
        jobs_sql = (cur.fetchone() or ("",))[0]
        if "REFERENCES libraries" in jobs_sql:
            cur.execute("PRAGMA foreign_keys=OFF")
            cur.execute("""
                CREATE TABLE jobs_new (
                    id INTEGER NOT NULL,
                    type VARCHAR(32) NOT NULL,
                    status VARCHAR(32) NOT NULL,
                    library_id INTEGER,
                    progress FLOAT NOT NULL,
                    total_files INTEGER NOT NULL,
                    processed_files INTEGER NOT NULL,
                    settings TEXT,
                    error TEXT,
                    created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
                    started_at DATETIME,
                    finished_at DATETIME,
                    current_file TEXT,
                    PRIMARY KEY (id)
                )
            """)
            cur.execute("""
                INSERT INTO jobs_new
                SELECT id, type, status, library_id, progress, total_files,
                       processed_files, settings, error, created_at,
                       started_at, finished_at, current_file
                FROM jobs
            """)
            cur.execute("DROP TABLE jobs")
            cur.execute("ALTER TABLE jobs_new RENAME TO jobs")
            raw.commit()
            cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
    finally:
        raw.close()

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
            "ALTER TABLE files ADD COLUMN extension TEXT",
            "ALTER TABLE files ADD COLUMN phash INTEGER",
            "ALTER TABLE files ADD COLUMN phash_frames TEXT",
            "ALTER TABLE files ADD COLUMN phash_scanned_at DATETIME",
            "ALTER TABLE downloads ADD COLUMN playlist_id TEXT",
            "ALTER TABLE downloads ADD COLUMN playlist_title TEXT",
            "ALTER TABLE downloads ADD COLUMN source_url TEXT",
        ]:
            try:
                conn.execute(text(sql))
            except Exception:
                pass  # column already exists

        # Remove orphaned records left by prior race conditions. Delete children
        # before parents so FK enforcement (now ON) doesn't reject the deletes.
        conn.execute(text("""
            DELETE FROM video_detections
            WHERE file_id IN (
                SELECT id FROM files
                WHERE library_id NOT IN (SELECT id FROM libraries)
            )
        """))
        conn.execute(text(
            "DELETE FROM files WHERE library_id NOT IN (SELECT id FROM libraries)"
        ))
        conn.execute(text("""
            DELETE FROM image_detections
            WHERE image_id IN (
                SELECT id FROM images
                WHERE library_id NOT IN (SELECT id FROM image_libraries)
            )
        """))
        conn.execute(text(
            "DELETE FROM images WHERE library_id NOT IN (SELECT id FROM image_libraries)"
        ))

