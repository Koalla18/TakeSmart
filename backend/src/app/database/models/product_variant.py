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
    from src.app.database.models.product import Product


class ProductVariant(Base):
    """
    Вариант товара — конкретная конфигурация (цвет + объём памяти и т.д.).

    Например, для iPhone 16 Pro варианты могут быть:
      - 128 ГБ / Чёрный титан
      - 256 ГБ / Белый титан
      - 512 ГБ / Пустынный титан
    """
    __tablename__ = "product_variants"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Отображаемое название варианта
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Артикул конкретного варианта
    sku: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)

    # Цена (если None — используется цена родительского товара)
    price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    discount_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Остаток на складе
    stock_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Атрибуты варианта
    color: Mapped[str | None] = mapped_column(String(80), nullable=True)
    storage: Mapped[str | None] = mapped_column(String(80), nullable=True)   # объём памяти, SSD и т.д.
    size: Mapped[str | None] = mapped_column(String(80), nullable=True)       # размер, версия

    # Изображение конкретного варианта (переопределяет главное фото товара)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Связь с родительским товаром
    product: Mapped["Product"] = relationship("Product", back_populates="variants")

    def __repr__(self) -> str:
        return f"<ProductVariant(id={self.id}, product_id={self.product_id}, name={self.name!r})>"
