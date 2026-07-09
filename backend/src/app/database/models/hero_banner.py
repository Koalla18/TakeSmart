from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import String, Text, Boolean, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.app.database.session import Base


class HeroBanner(Base):
    """
    Баннер главного слайдера на лендинге (hero).

    Отображается в большой карусели вверху главной страницы. Управляется из
    админки. Две кнопки: основная (cta) и вторичная (secondary). Ссылка кнопки —
    строка: если начинается с http(s) — внешняя, иначе — внутренний маршрут.
    """
    __tablename__ = "hero_banners"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    badge: Mapped[str | None] = mapped_column(String(200), nullable=True)        # маленький текст-плашка
    title: Mapped[str] = mapped_column(String(255), nullable=False)              # заголовок (чёрный)
    highlight: Mapped[str | None] = mapped_column(String(255), nullable=True)    # вторая строка (жёлтая)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    image: Mapped[str | None] = mapped_column(String(500), nullable=True)

    cta_label: Mapped[str | None] = mapped_column(String(120), nullable=True)        # основная кнопка
    cta_link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    secondary_label: Mapped[str | None] = mapped_column(String(120), nullable=True)  # вторичная кнопка
    secondary_link: Mapped[str | None] = mapped_column(String(500), nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<HeroBanner(id={self.id}, title={self.title!r})>"
