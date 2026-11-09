"""Forgot the password? From the host:

    docker exec -it parallax python -m app.reset_password

Prompts (no echo) for a new password, saves it and signs every browser out.
"""

import getpass
import sys
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.services import auth as svc


def reset_password(db: Session, new_password: str) -> bool:
    """False when there is no account to reset."""
    return svc.set_password(db, new_password)


def main(session_factory: Callable[[], Session] | None = None) -> int:
    first = getpass.getpass("New password: ")
    second = getpass.getpass("New password again: ")
    if first != second:
        print("The two entries do not match. Nothing was changed.", file=sys.stderr)
        return 1
    if not svc.PASSWORD_MIN <= len(first) <= svc.PASSWORD_MAX:
        print(
            f"The password must be {svc.PASSWORD_MIN} to {svc.PASSWORD_MAX} characters long. "
            "Nothing was changed.",
            file=sys.stderr,
        )
        return 1

    if session_factory is None:
        from app.database import SessionLocal, init_db

        init_db()
        session_factory = SessionLocal
    db = session_factory()
    try:
        if not reset_password(db, first):
            print("There is no account yet. Open the setup page in your browser.", file=sys.stderr)
            return 1
    finally:
        db.close()
    print("Password changed. Every browser has been signed out.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
