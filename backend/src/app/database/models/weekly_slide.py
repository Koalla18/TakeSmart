from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import String, Text, Boolean, Integer, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.app.database.session import Base


class WeeklySlide(Base):
    """
    Слайд секции «Товары недели» на главной странице.

    Слайды отображаются в карусели с автосменой.
    Поле ``color`` — это CSS-класс Tailwind для фона карточки,
    например ``bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50``.
    """
    __tablename__ = "weekly_slides"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Контент слайда
    badge: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[str | None] = mapped_column(String(100), nullable=True)   # «94 000», «от 24 990»

    # Медиа
    image: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Визуал карточки
    color: Mapped[str | None] = mapped_column(
        String(300), nullable=True,
        comment="CSS/Tailwind-класс фона карточки"
    )

    # Теги отображаемые под ценой (массив строк)
    tags: Mapped[Any | None] = mapped_column(
        JSONB, nullable=True, default=list,
        comment="Список тегов: ['trade-in', 'гарантия 12 месяцев*', 'новинка']"
    )

    # Ссылка «Подробнее»
    link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    is_new: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<WeeklySlide(id={self.id}, title={self.title!r})>"
