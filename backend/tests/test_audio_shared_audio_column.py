from app.database import engine, init_db
from app.models.audio_file import AudioFile
from app.models.job import JobType


def test_audio_file_has_shared_audio_column():
    assert hasattr(AudioFile, "shared_audio")


def test_old_audio_fingerprint_is_gone_from_the_model():
    assert not hasattr(AudioFile, "audio_fingerprint")


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
        if "shared_audio" in _audio_file_cols(conn):
            conn.execute(sa.text("ALTER TABLE audio_files DROP COLUMN shared_audio"))
        assert "shared_audio" not in _audio_file_cols(conn)

    init_db()
    with engine.connect() as conn:
        assert "shared_audio" in _audio_file_cols(conn)

    # Second run must not raise — the guard swallows "duplicate column".
    init_db()
    with engine.connect() as conn:
        assert "shared_audio" in _audio_file_cols(conn)
