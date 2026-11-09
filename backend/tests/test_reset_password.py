import pytest

from app import reset_password as cli
from app.models.auth import AuthSession
from app.services import auth as svc


@pytest.fixture
def user(db):
    return svc.create_user(db, "alice", "the old passphrase")


def _answers(monkeypatch, *answers):
    it = iter(answers)
    monkeypatch.setattr(cli.getpass, "getpass", lambda _prompt="": next(it))


def test_reset_changes_the_password_and_signs_everyone_out(db, user):
    svc.create_session(db)
    assert cli.reset_password(db, "the new passphrase") is True
    assert db.query(AuthSession).count() == 0
    svc.login(db, "alice", "the new passphrase")


def test_reset_without_an_account_returns_false(db):
    assert cli.reset_password(db, "the new passphrase") is False


def test_main_resets_when_both_entries_match(db, user, monkeypatch, capsys):
    _answers(monkeypatch, "the new passphrase", "the new passphrase")
    assert cli.main(session_factory=lambda: db) == 0
    assert "signed out" in capsys.readouterr().out.lower()
    svc.login(db, "alice", "the new passphrase")


def test_main_refuses_a_mismatch(db, user, monkeypatch, capsys):
    _answers(monkeypatch, "the new passphrase", "another passphrase")
    assert cli.main(session_factory=lambda: db) == 1
    assert "do not match" in capsys.readouterr().err
    svc.login(db, "alice", "the old passphrase")


@pytest.mark.parametrize("bad", ["short", "x" * 129])
def test_main_refuses_a_bad_length(db, user, monkeypatch, capsys, bad):
    _answers(monkeypatch, bad, bad)
    assert cli.main(session_factory=lambda: db) == 1
    assert "8" in capsys.readouterr().err
    svc.login(db, "alice", "the old passphrase")


def test_main_points_to_setup_when_there_is_no_account(db, monkeypatch, capsys):
    _answers(monkeypatch, "the new passphrase", "the new passphrase")
    assert cli.main(session_factory=lambda: db) == 1
    assert "setup page" in capsys.readouterr().err


def test_main_never_prints_the_password(db, user, monkeypatch, capsys):
    _answers(monkeypatch, "the new passphrase", "the new passphrase")
    cli.main(session_factory=lambda: db)
    out = capsys.readouterr()
    assert "the new passphrase" not in out.out + out.err
