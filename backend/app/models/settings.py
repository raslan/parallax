from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(256), nullable=False)


def get_setting(db, key: str, default: str) -> str:
    s = db.get(Setting, key)
    return s.value if s else default


def set_setting(db, key: str, value: str) -> None:
    s = db.get(Setting, key)
    if s:
        s.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()
