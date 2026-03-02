"""
Модель группы товаров — объединяет карточки одного и того же продукта в разных цветах.

Например: «iPhone 17 Pro» — группа, а «iPhone 17 Pro рыжий», «iPhone 17 Pro чёрный»,
«iPhone 17 Pro белый» — это карточки (products) внутри неё.

При переключении цвета на странице товара пользователь переходит
между карточками одной группы, сохраняя конфигурацию (память, симкарта).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.app.database.session import Base

if TYPE_CHECKING:
    from src.app.database.models.product import Product


class ProductGroup(Base):
    """Группа связанных карточек товара (по цвету)."""

    __tablename__ = "product_groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(
        String(255), nullable=False,
        comment="Название группы, напр. «iPhone 17 Pro» или «Samsung Galaxy S25 Ultra»",
    )

    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )

    # Связь — все карточки группы
    products: Mapped[list["Product"]] = relationship(
        "Product", back_populates="group",
        order_by="Product.color",
    )

    def __repr__(self) -> str:
        return f"<ProductGroup(id={self.id}, name={self.name})>"
