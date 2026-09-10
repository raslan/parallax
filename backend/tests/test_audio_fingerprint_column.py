from app.database import engine, init_db
from app.models.audio_file import AudioFile
from app.models.job import JobType
from app.schemas import AudioFileRead


def test_audio_file_has_fingerprint_column():
    assert hasattr(AudioFile, "audio_fingerprint")


def test_new_job_types_present():
    assert JobType.AUDIO_TOOLBOX == "audio_toolbox"
    assert JobType.AUDIO_DUPLICATES == "audio_duplicates"


def test_init_db_is_idempotent_for_new_column():
    # Running twice must not raise (the ALTER guard swallows "duplicate column").
    init_db()
    init_db()
    import sqlalchemy as sa

    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(sa.text("PRAGMA table_info(audio_files)"))]
    assert "audio_fingerprint" in cols


def test_audio_file_read_serialises_fingerprint():
    from datetime import datetime

    from app.models.file import FileStatus

    row = AudioFile(
        id=1,
        library_id=1,
        path="/x.mp3",
        filename="x.mp3",
        extension=".mp3",
        size=1,
        status=FileStatus.UNKNOWN,
        created_at=datetime.now(),
        audio_fingerprint="[1, 2, 3]",
    )
    out = AudioFileRead.model_validate(row)
    assert out.audio_fingerprint == "[1, 2, 3]"
