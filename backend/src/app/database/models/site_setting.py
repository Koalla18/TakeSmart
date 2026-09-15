from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import String, func, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.database.session import Base


class SiteSetting(Base):
    """
    Настройка витрины «ключ → значение». Первые ключи — переключатели раздела
    «Предзаказ»: показывать ли раздел на сайте и попадают ли предзаказные товары
    в общий каталог. Значение — JSON, чтобы не плодить миграции под каждый флаг.
    """
    __tablename__ = "site_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<SiteSetting({self.key}={self.value!r})>"
