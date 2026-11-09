"""Single-account authentication: password hashing, sessions, login throttle.

Routes live in `api/auth.py`, enforcement in `app/auth.py`. Nothing here touches HTTP.
"""

import hashlib
import hmac
import math
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.auth import AuthSession, User
from app.services.common import now

SESSION_DAYS = 30
TOUCH_AFTER = timedelta(hours=1)
PASSWORD_MIN = 8
PASSWORD_MAX = 128

_SCRYPT_N = 2**15
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 2**26  # 64 MiB: n=2**15, r=8 needs ~32 MiB plus overhead


class AuthError(Exception):
    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class InvalidCredentials(AuthError):
    status_code = 401

    def __init__(self):
        super().__init__("Incorrect username or password")


class AlreadyConfigured(AuthError):
    status_code = 409

    def __init__(self):
        super().__init__("An account already exists")


class WrongPassword(AuthError):
    # 403, not 401: the SPA treats a 401 as "your session is gone".
    status_code = 403

    def __init__(self):
        super().__init__("Current password is incorrect")


class AuthDisabled(AuthError):
    status_code = 409

    def __init__(self):
        super().__init__("Authentication is turned off")


class NoAccount(AuthError):
    status_code = 409

    def __init__(self):
        super().__init__("No account has been created yet")


class Throttled(AuthError):
    status_code = 429

    def __init__(self, retry_after: int):
        super().__init__(f"Too many attempts. Try again in {retry_after} s.")
        self.retry_after = retry_after


# ── passwords ────────────────────────────────────────────────────────────────


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        password.encode(), salt=salt, n=n, r=r, p=p, maxmem=_SCRYPT_MAXMEM, dklen=32
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = _scrypt(password, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        got = _scrypt(password, bytes.fromhex(salt), int(n), int(r), int(p))
        return hmac.compare_digest(got, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


# A real hash to burn the same time on when the username is unknown.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


# ── throttle ─────────────────────────────────────────────────────────────────


class LoginThrottle:
    """Process-wide (not per-IP: behind a proxy every request shares one address).
    After 5 consecutive failures the next attempt is refused for 1 s, doubling per further
    failure up to 5 minutes. A success resets it. A restart clears it."""

    FREE_FAILURES = 5
    CAP_SECONDS = 300

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self.failures = 0
        self.locked_until = 0.0

    def check(self) -> None:
        remaining = self.locked_until - self._clock()
        if remaining > 0:
            raise Throttled(max(1, math.ceil(remaining)))

    def fail(self) -> None:
        self.failures += 1
        if self.failures >= self.FREE_FAILURES:
            delay = min(self.CAP_SECONDS, 2 ** (self.failures - self.FREE_FAILURES))
            self.locked_until = self._clock() + delay

    def reset(self) -> None:
        self.failures = 0
        self.locked_until = 0.0


THROTTLE = LoginThrottle()


# ── account ──────────────────────────────────────────────────────────────────


def get_user(db: Session) -> User | None:
    return db.get(User, 1)


def _clean_username(username: str) -> str:
    return username.strip()


def create_user(db: Session, username: str, password: str) -> User:
    if get_user(db) is not None:
        raise AlreadyConfigured()
    user = User(id=1, username=_clean_username(username), password_hash=hash_password(password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AlreadyConfigured() from None
    return user


def set_password(db: Session, password: str) -> bool:
    """Replace the password and sign everyone out (reset CLI). False when no account exists."""
    user = get_user(db)
    if user is None:
        return False
    user.password_hash = hash_password(password)
    user.password_changed_at = now()
    db.execute(delete(AuthSession))
    db.commit()
    return True


def update_account(
    db: Session,
    session_id: int,
    current_password: str,
    new_username: str | None,
    new_password: str | None,
) -> User:
    user = get_user(db)
    if user is None:
        raise NoAccount()
    if not verify_password(current_password, user.password_hash):
        raise WrongPassword()
    if new_username is not None:
        user.username = _clean_username(new_username)
    if new_password is not None:
        user.password_hash = hash_password(new_password)
        user.password_changed_at = now()
        db.execute(delete(AuthSession).where(AuthSession.id != session_id))
    db.commit()
    return user


# ── sessions ─────────────────────────────────────────────────────────────────


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session) -> str:
    token = secrets.token_urlsafe(32)
    stamp = now()
    db.add(
        AuthSession(
            token_hash=_digest(token),
            created_at=stamp,
            last_seen_at=stamp,
            expires_at=stamp + timedelta(days=SESSION_DAYS),
        )
    )
    db.commit()
    return token


def login(db: Session, username: str, password: str) -> str:
    """Check the credentials and open a session; returns the raw cookie token."""
    THROTTLE.check()
    user = get_user(db)
    name_ok = user is not None and user.username.casefold() == _clean_username(username).casefold()
    stored = user.password_hash if (user is not None and name_ok) else _DUMMY_HASH
    pw_ok = verify_password(password, stored)
    if not (name_ok and pw_ok):
        THROTTLE.fail()
        raise InvalidCredentials()
    THROTTLE.reset()
    return create_session(db)


@dataclass(frozen=True)
class Resolved:
    session_id: int
    username: str
    needs_touch: bool


def resolve_session(db: Session, token: str) -> Resolved | None:
    if not token:
        return None
    row = db.query(AuthSession).filter(AuthSession.token_hash == _digest(token)).one_or_none()
    if row is None:
        return None
    stamp = now()
    if row.expires_at <= stamp:
        db.delete(row)
        db.commit()
        return None
    user = get_user(db)
    if user is None:
        return None
    return Resolved(row.id, user.username, stamp - row.last_seen_at > TOUCH_AFTER)


def touch_session(db: Session, session_id: int) -> None:
    row = db.get(AuthSession, session_id)
    if row is None:
        return
    stamp = now()
    row.last_seen_at = stamp
    row.expires_at = stamp + timedelta(days=SESSION_DAYS)
    db.commit()


def delete_session(db: Session, session_id: int) -> None:
    db.execute(delete(AuthSession).where(AuthSession.id == session_id))
    db.commit()


def delete_all_sessions(db: Session) -> None:
    db.execute(delete(AuthSession))
    db.commit()


def purge_expired(db: Session) -> None:
    db.execute(delete(AuthSession).where(AuthSession.expires_at <= now()))
    db.commit()
