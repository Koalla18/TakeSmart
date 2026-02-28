from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Boolean, Integer, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.app.database.session import Base

if TYPE_CHECKING:
    from src.app.database.models.product import Product


class ProductImage(Base):
    """
    Фотография товара.
    Хранит только путь относительно static/ — сами файлы лежат на диске.
    """
    __tablename__ = "product_images"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Относительный путь внутри static/, например: "products/abc123/photo1.webp"
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    # Оригинальное имя файла при загрузке
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # MIME-тип: image/jpeg, image/png, image/webp
    mime_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # Размер файла в байтах
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)

    # Привязка к цвету варианта (если NULL — общее фото товара)
    variant_color: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Порядок отображения (0 — главное фото)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    # Связь с товаром
    product: Mapped[Product] = relationship("Product", back_populates="images")

    def __repr__(self) -> str:
        return f"<ProductImage(id={self.id}, product={self.product_id}, path={self.file_path})>"
