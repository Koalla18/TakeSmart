"""
MediaFile model — хранит метаданные всех загруженных файлов.
Физически файлы лежат в /static/{entity_type}/{entity_id}/{filename}
В БД — только URL и мета.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class MediaFile(Base):
    __tablename__ = "media_files"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True
    )

    # К какой сущности привязан файл: "product", "category", "slide", etc.
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # UUID сущности (nullable — для «свободных» файлов без привязки)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )

    # Публичный URL: /static/products/<entity_id>/<filename>
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    # URL миниатюры (WebP 320×320)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Оригинальное имя файла как пришло от клиента
    original_filename: Mapped[str] = mapped_column(String(300), nullable=False)
    # Сохранённое имя файла (slug-безопасное)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)

    # MIME-тип: image/webp, image/jpeg …
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # Размер в байтах
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    # Размеры изображения (если применимо)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Первичная/главная фотография продукта
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # Порядок сортировки в галерее
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    alt_text: Mapped[str | None] = mapped_column(String(300), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<MediaFile id={self.id} entity={self.entity_type}:{self.entity_id} url={self.url}>"

