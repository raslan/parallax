import hashlib
from datetime import timedelta

import pytest

from app.models.auth import AuthSession, User
from app.services import auth as svc
from app.services.common import now


@pytest.fixture(autouse=True)
def _fresh_throttle():
    svc.THROTTLE.reset()
    yield
    svc.THROTTLE.reset()


@pytest.fixture
def user(db):
    return svc.create_user(db, "Alice", "correct horse battery")


def test_hash_round_trip_and_format():
    stored = svc.hash_password("hunter2hunter2")
    assert stored.startswith("scrypt$32768$")
    assert svc.verify_password("hunter2hunter2", stored)
    assert not svc.verify_password("hunter3hunter3", stored)


@pytest.mark.parametrize(
    "stored", ["", "nope", "scrypt$1$2", "scrypt$x$8$1$aa$bb", "md5$1$2$3$4$5"]
)
def test_verify_rejects_malformed(stored):
    assert svc.verify_password("whatever1", stored) is False


def test_second_user_is_refused(db, user):
    with pytest.raises(svc.AlreadyConfigured):
        svc.create_user(db, "bob", "another passphrase")
    assert db.query(User).count() == 1


def test_login_errors_are_generic(db, user):
    with pytest.raises(svc.InvalidCredentials) as a:
        svc.login(db, "nobody", "correct horse battery")
    with pytest.raises(svc.InvalidCredentials) as b:
        svc.login(db, "alice", "wrong password")
    assert a.value.message == b.value.message == "Incorrect username or password"


def test_login_username_is_case_insensitive(db, user):
    token = svc.login(db, "  ALICE ", "correct horse battery")
    assert svc.resolve_session(db, token).username == "Alice"


def test_token_is_stored_only_hashed(db, user):
    token = svc.create_session(db)
    row = db.query(AuthSession).one()
    assert row.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert token not in (row.token_hash, str(row.id))


def test_unknown_token_resolves_to_none(db, user):
    assert svc.resolve_session(db, "nope") is None
    assert svc.resolve_session(db, "") is None


def test_expired_session_is_removed(db, user):
    token = svc.create_session(db)
    row = db.query(AuthSession).one()
    row.expires_at = now() - timedelta(seconds=1)
    db.commit()
    assert svc.resolve_session(db, token) is None
    assert db.query(AuthSession).count() == 0


def test_sliding_expiry_only_after_an_hour(db, user):
    token = svc.create_session(db)
    r = svc.resolve_session(db, token)
    assert r.needs_touch is False
    row = db.query(AuthSession).one()
    row.last_seen_at = now() - timedelta(hours=2)
    row.expires_at = now() + timedelta(days=1)
    db.commit()
    r = svc.resolve_session(db, token)
    assert r.needs_touch is True
    svc.touch_session(db, r.session_id)
    row = db.query(AuthSession).one()
    assert row.expires_at > now() + timedelta(days=29)
    assert svc.resolve_session(db, token).needs_touch is False


def test_throttle_locks_after_the_free_failures_even_for_right_password(db, user):
    for _ in range(svc.LoginThrottle.FREE_FAILURES):
        with pytest.raises(svc.InvalidCredentials):
            svc.login(db, "alice", "bad password")
    with pytest.raises(svc.Throttled) as t:
        svc.login(db, "alice", "correct horse battery")
    assert t.value.status_code == 429
    assert t.value.retry_after == 1


def test_throttle_backoff_doubles_and_caps():
    clock = [1000.0]
    th = svc.LoginThrottle(clock=lambda: clock[0])
    for _ in range(svc.LoginThrottle.FREE_FAILURES - 1):
        th.fail()
    th.check()  # still free: one try left before the first wait
    th.fail()
    with pytest.raises(svc.Throttled) as t:
        th.check()
    assert t.value.retry_after == 1
    clock[0] += 1.01
    th.check()  # lock expired
    th.fail()  # the next failure -> 2 s
    with pytest.raises(svc.Throttled) as t:
        th.check()
    assert t.value.retry_after == 2
    for _ in range(30):
        clock[0] += 400  # always past the previous wait
        th.fail()
    with pytest.raises(svc.Throttled) as t:
        th.check()
    assert t.value.retry_after == svc.LoginThrottle.CAP_SECONDS == 60


def test_throttle_resets_on_success(db, user):
    for _ in range(4):
        with pytest.raises(svc.InvalidCredentials):
            svc.login(db, "alice", "bad password")
    svc.login(db, "alice", "correct horse battery")
    for _ in range(4):
        with pytest.raises(svc.InvalidCredentials):
            svc.login(db, "alice", "bad password")  # would be throttled if not reset


def test_update_account_requires_current_password(db, user):
    sid = svc.resolve_session(db, svc.create_session(db)).session_id
    with pytest.raises(svc.WrongPassword):
        svc.update_account(db, sid, "nope nope nope", None, "brand new passphrase")


def test_password_change_revokes_other_sessions_only(db, user):
    mine = svc.create_session(db)
    other = svc.create_session(db)
    sid = svc.resolve_session(db, mine).session_id
    svc.update_account(db, sid, "correct horse battery", None, "brand new passphrase")
    assert svc.resolve_session(db, mine) is not None
    assert svc.resolve_session(db, other) is None
    svc.login(db, "alice", "brand new passphrase")


def test_username_change_keeps_sessions(db, user):
    mine = svc.create_session(db)
    other = svc.create_session(db)
    sid = svc.resolve_session(db, mine).session_id
    svc.update_account(db, sid, "correct horse battery", "carol", None)
    assert svc.resolve_session(db, other).username == "carol"
    assert svc.resolve_session(db, mine).username == "carol"


def test_set_password_signs_everyone_out(db, user):
    token = svc.create_session(db)
    svc.set_password(db, "a fresh passphrase")
    assert svc.resolve_session(db, token) is None
    svc.login(db, "alice", "a fresh passphrase")


def test_purge_expired(db, user):
    svc.create_session(db)
    svc.create_session(db)
    row = db.query(AuthSession).first()
    row.expires_at = now() - timedelta(days=1)
    db.commit()
    svc.purge_expired(db)
    assert db.query(AuthSession).count() == 1
