import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.auth import AuthSession, User
from app.services import auth as auth_svc

TEST_DB_URL = "sqlite:///./test_images.db"


@pytest.fixture(scope="session")
def engine():
    e = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    # Start clean: a run that was killed (timeout, Ctrl-C) never reaches the drop_all below and
    # leaves committed rows behind, which then collide with unique paths in the next run.
    Base.metadata.drop_all(bind=e)
    Base.metadata.create_all(bind=e)
    yield e
    Base.metadata.drop_all(bind=e)


@pytest.fixture
def db(engine):
    connection = engine.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    yield session
    session.close()
    transaction.rollback()
    connection.close()


TEST_USERNAME = "tester"
TEST_PASSWORD = "test-password-123"
# One scrypt hash for the whole run: hashing per test would add ~0.1 s to every `client` test.
_TEST_HASH = auth_svc.hash_password(TEST_PASSWORD)


@pytest.fixture(autouse=True)
def _fresh_login_throttle():
    auth_svc.THROTTLE.reset()
    yield
    auth_svc.THROTTLE.reset()


@pytest.fixture
def anon_client(engine, monkeypatch):
    """The app with no account and no cookie: for tests about being signed out."""
    Session = sessionmaker(bind=engine)

    # Starting the app (lifespan) also kicks off three network downloads in threads: the alass
    # binary, the gallery-dl / yt-dlp nightlies and deno. No test here needs them, and shutting
    # the app down waits for those threads, which cost 7-9 s for *every* test using this fixture
    # (and can stall indefinitely without network, see RAS-70). The functions themselves are
    # tested directly, not through the lifespan.
    monkeypatch.setattr("app.services.subtitle_sync.ensure_alass", lambda: None)
    monkeypatch.setattr("app.services.gallery_dl.install_gallerydl", lambda: None)
    monkeypatch.setattr("app.services.gallery_dl.ensure_deno", lambda: None)
    # The auth middleware opens its own short-lived session; point it at the test database.
    monkeypatch.setattr("app.auth.SessionLocal", Session)
    monkeypatch.delenv("PARALLAX_AUTH", raising=False)

    def override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    cleanup = Session()
    try:
        cleanup.query(AuthSession).delete()
        cleanup.query(User).delete()
        cleanup.commit()
    finally:
        cleanup.close()


@pytest.fixture
def client(anon_client, engine):
    """The app with the account created and this client signed in, so every test written
    before authentication existed keeps working unchanged."""
    Session = sessionmaker(bind=engine)
    s = Session()
    try:
        s.add(User(id=1, username=TEST_USERNAME, password_hash=_TEST_HASH))
        s.commit()
        token = auth_svc.create_session(s)
    finally:
        s.close()
    anon_client.cookies.set("parallax_session", token)
    return anon_client


@pytest.fixture
def probes(monkeypatch):
    """path -> fake ffprobe JSON for videos (see `tests/media_fakes.py`); a path with no entry is
    a failed probe ({}). The scanner's real field mapping (`probe_metadata`) still runs."""
    from app.services import scanner

    table: dict[str, dict] = {}
    monkeypatch.setattr(scanner, "probe_file", lambda p: table.get(p, {}))
    return table


@pytest.fixture
def audio_probes(monkeypatch):
    """The audio twin of `probes`."""
    from app.services import audio_scanner

    table: dict[str, dict] = {}
    monkeypatch.setattr(audio_scanner, "probe_audio", lambda p: table.get(p, {}))
    return table


@pytest.fixture
def lib_env(client, engine, tmp_path, monkeypatch):
    """Everything a library-route test needs: the signed-in `client`, a sessionmaker on the test
    DB, an `events` log of watcher (un)registrations, `removals` (stats credits), `enqueued`
    (jobs the routes queue instead of running), thumbnails in a temp dir, and a full wipe of the
    library/file/job tables afterwards (the route sessions commit to the shared test DB)."""
    from types import SimpleNamespace

    from app.models.audio_file import AudioFile
    from app.models.audio_library import AudioLibrary
    from app.models.file import File
    from app.models.image import ImageDetection, ImageFile
    from app.models.image_library import ImageLibrary
    from app.models.job import Job, JobLog
    from app.models.library import Library
    from app.models.schedule import Schedule
    from app.services import scanner

    events, removals, enqueued = [], [], []

    def watch(library_id, path, kind="video"):
        events.append(("watch", kind, library_id))

    def unwatch(library_id, kind="video"):
        events.append(("unwatch", kind, library_id))

    async def fake_enqueue(job_id, fn, *args):
        enqueued.append((job_id, fn.__name__, args))

    monkeypatch.setattr("app.services.fs_watcher.watch_library", watch)
    monkeypatch.setattr("app.services.fs_watcher.unwatch_library", unwatch)
    monkeypatch.setattr("app.services.stats.record_removal", lambda *a: removals.append(a))
    monkeypatch.setattr("app.queue.enqueue", fake_enqueue)
    monkeypatch.setattr("app.api.libraries.enqueue", fake_enqueue)
    thumbs = tmp_path / "thumbs"
    thumbs.mkdir()
    monkeypatch.setattr(scanner, "THUMBNAILS_DIR", str(thumbs))
    monkeypatch.setattr("app.api.image_libraries.DATA_DIR", str(tmp_path))

    Session = sessionmaker(bind=engine)

    def wipe():
        s = Session()
        try:
            for model in (
                ImageDetection,
                ImageFile,
                ImageLibrary,
                AudioFile,
                AudioLibrary,
                Schedule,
                JobLog,
                Job,
                File,
                Library,
            ):
                s.query(model).delete()
            s.commit()
        finally:
            s.close()

    wipe()
    yield SimpleNamespace(
        client=client,
        Session=Session,
        events=events,
        removals=removals,
        enqueued=enqueued,
        root=tmp_path,
        thumbs=thumbs,
    )
    wipe()


@pytest.fixture
def fs_db(tmp_path, monkeypatch):
    """A private SQLite DB for code that opens its own sessions (the filesystem watcher, the
    scanners, queue jobs): every module-level `SessionLocal` is pointed at it, with the same
    pragmas production sets (foreign keys ON, so a delete that leaves a dependent row fails here
    like it would for real), and video thumbnails go to a temp dir. Returns the sessionmaker."""
    from sqlalchemy import event

    import app.database
    from app.services import audio_scanner, image_scanner, scanner

    engine = create_engine(
        f"sqlite:///{tmp_path / 'fs.db'}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine)
    for mod in (app.database, scanner, audio_scanner, image_scanner):
        monkeypatch.setattr(mod, "SessionLocal", factory)
    thumbs = tmp_path / "thumbs"
    thumbs.mkdir()
    monkeypatch.setattr(scanner, "THUMBNAILS_DIR", str(thumbs))
    yield factory
    engine.dispose()
