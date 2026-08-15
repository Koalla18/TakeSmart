from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import String, Text, Boolean, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.app.database.session import Base

if TYPE_CHECKING:
    from src.app.database.models.product import Product


class Category(Base):
    """
    Категория товаров (Смартфоны, Наушники, Ноутбуки и т.д.)
    Поддерживает вложенность (parent_id) для подкатегорий.
    """
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Порядок отображения категории в списках (меньше — выше)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0",
        comment="Порядок отображения категории (меньше — выше)",
    )

    # Быстрые фильтры-теги для каталога: [{"label": "iPhone 17 Pro Max", "query": "17 Pro Max"}, ...]
    quick_filters: Mapped[Any | None] = mapped_column(
        JSONB, nullable=True, default=list,
        comment="Массив тегов [{label, query}] для быстрых фильтров в каталоге"
    )

    # Полная схема карточки товара для конкретной категории. Поля могут быть
    # текстом, числом, списком вариантов или флагом; часть из них можно
    # использовать как оси массового создания вариаций.
    product_fields: Mapped[Any | None] = mapped_column(
        JSONB, nullable=True, default=list,
        comment="Схема полей товара [{key, label, field_type, options, is_variant}]",
    )

    # Вложенные категории (Электроника → Смартфоны → iPhone)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Связи
    parent: Mapped[Optional["Category"]] = relationship(
        "Category", remote_side="Category.id", back_populates="children"
    )
    children: Mapped[list["Category"]] = relationship(
        "Category", back_populates="parent", order_by="Category.sort_order"
    )
    products: Mapped[list["Product"]] = relationship("Product", back_populates="category")

    def __repr__(self) -> str:
        return f"<Category(id={self.id}, name={self.name})>"
