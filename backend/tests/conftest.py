import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app

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


@pytest.fixture
def client(engine, monkeypatch):
    Session = sessionmaker(bind=engine)

    # Starting the app (lifespan) also kicks off three network downloads in threads: the alass
    # binary, the gallery-dl / yt-dlp nightlies and deno. No test here needs them, and shutting
    # the app down waits for those threads, which cost 7-9 s for *every* test using this fixture
    # (and can stall indefinitely without network, see RAS-70). The functions themselves are
    # tested directly, not through the lifespan.
    monkeypatch.setattr("app.services.subtitle_sync.ensure_alass", lambda: None)
    monkeypatch.setattr("app.services.gallery_dl.install_gallerydl", lambda: None)
    monkeypatch.setattr("app.services.gallery_dl.ensure_deno", lambda: None)

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
