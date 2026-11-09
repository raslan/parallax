from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.services.common import now


class User(Base):
    """The one and only account. `id` is pinned to 1 so a second row cannot exist, even if two
    setup requests race."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("id = 1", name="ck_users_single"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False, default=1)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    password_changed_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuthSession(Base):
    """A signed-in browser. Only the SHA-256 of the cookie token is stored."""

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
