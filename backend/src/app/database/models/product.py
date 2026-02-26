from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import String, Text, Boolean, Numeric, Integer, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.app.database.session import Base

if TYPE_CHECKING:
    from src.app.database.models.category import Category
    from src.app.database.models.order import OrderItem
    from src.app.database.models.product_image import ProductImage


class Product(Base):
    """
    Товар магазина электроники (смартфон, наушники, ноутбук и т.д.)
    """
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(280), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    short_description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Цена и скидка
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Склад
    stock_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sku: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)

    # Характеристики
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    model: Mapped[str | None] = mapped_column(String(150), nullable=True)
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    warranty_months: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Медиа
    main_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Статусы
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Категория
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Связи
    category: Mapped[Optional["Category"]] = relationship("Category", back_populates="products")
    order_items: Mapped[list["OrderItem"]] = relationship("OrderItem", back_populates="product")
    images: Mapped[list["ProductImage"]] = relationship(
        "ProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductImage.sort_order",
    )

    def __repr__(self) -> str:
        return f"<Product(id={self.id}, name={self.name}, price={self.price})>"
