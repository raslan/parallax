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
