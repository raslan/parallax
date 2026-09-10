from app.database import engine, init_db
from app.models.audio_file import AudioFile
from app.models.job import JobType
from app.schemas import AudioFileRead


def test_audio_file_has_fingerprint_column():
    assert hasattr(AudioFile, "audio_fingerprint")


def test_new_job_types_present():
    assert JobType.AUDIO_TOOLBOX == "audio_toolbox"
    assert JobType.AUDIO_DUPLICATES == "audio_duplicates"


def _audio_file_cols(conn):
    import sqlalchemy as sa

    return [r[1] for r in conn.execute(sa.text("PRAGMA table_info(audio_files)"))]


def test_init_db_alter_guard_adds_and_is_idempotent():
    # Prove the ALTER guard in init_db() is what puts the column back — drop it
    # first (create_all won't ALTER an existing table, so the model declaring
    # the column can't mask a broken guard), then let init_db() re-add it.
    import sqlalchemy as sa

    with engine.begin() as conn:
        if "audio_fingerprint" in _audio_file_cols(conn):
            conn.execute(sa.text("ALTER TABLE audio_files DROP COLUMN audio_fingerprint"))
        assert "audio_fingerprint" not in _audio_file_cols(conn)

    init_db()
    with engine.connect() as conn:
        assert "audio_fingerprint" in _audio_file_cols(conn)

    # Second run must not raise — the guard swallows "duplicate column".
    init_db()
    with engine.connect() as conn:
        assert "audio_fingerprint" in _audio_file_cols(conn)


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
