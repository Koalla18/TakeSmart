from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.app.database.session import Base


class PageVisit(Base):
    """Просмотр страницы витрины — сырое событие для аналитики посещаемости.

    Пишется публичной ручкой POST /track/visit без авторизации, поэтому хранит
    только обезличенные данные: путь, реферер и два анонимных идентификатора —
    visitor_id (localStorage, живёт год) и session_id (sessionStorage, вкладка).
    Визит = уникальный session_id за период, уникальный посетитель = visitor_id.
    """

    __tablename__ = "page_visits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    referrer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    visitor_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    # Составной индекс под подсчёт уникальных посетителей за период
    __table_args__ = (
        Index("ix_page_visits_created_at_visitor", "created_at", "visitor_id"),
    )

    def __repr__(self) -> str:
        return f"<PageVisit(path={self.path!r}, created_at={self.created_at})>"
