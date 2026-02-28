from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import String, Text, Boolean, Numeric, Integer, ForeignKey, func, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.app.database.session import Base

if TYPE_CHECKING:
    from src.app.database.models.category import Category
    from src.app.database.models.order import OrderItem
    from src.app.database.models.product_image import ProductImage
    from src.app.database.models.product_variant import ProductVariant


class Product(Base):
    """
    Товар магазина электроники (смартфон, наушники, ноутбук и т.д.)

    attributes — JSONB-поле для произвольных характеристик товара.
    Позволяет хранить любое кол-во ключ-значение без изменения схемы БД.
    Пример для смартфона: {"ram_gb": 12, "storage_gb": 256, "5g": true, "os": "iOS 18"}
    Пример для наушников: {"driver_mm": 40, "noise_cancelling": true, "battery_hours": 30}

    Для структурированного отображения на фронте (таблицы характеристик по группам)
    используй связанную таблицу product_specs (модель ProductSpec).
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

    # Базовые характеристики (структурированные — для фильтров и поиска)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    model: Mapped[str | None] = mapped_column(String(150), nullable=True)
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    warranty_months: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Произвольные характеристики — любые поля без изменения схемы БД.
    # Поиск: WHERE attributes @> '{"ram_gb": 12}'
    # Индекс GIN обеспечивает быстрый поиск по содержимому JSON.
    attributes: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True, default=None,
        comment="Произвольные характеристики товара (ram_gb, storage_gb, os, ...)",
    )

    # Медиа
    main_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Состояние товара: new | used
    condition: Mapped[str] = mapped_column(
        String(20), nullable=False, default="new", server_default="new", index=True,
        comment="Состояние товара: new — новый, used — б/у",
    )

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

    # GIN-индекс для быстрого поиска по JSONB-полю attributes
    __table_args__ = (
        Index("ix_products_attributes_gin", "attributes", postgresql_using="gin"),
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
    variants: Mapped[list["ProductVariant"]] = relationship(
        "ProductVariant",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductVariant.sort_order",
    )
    specs: Mapped[list["ProductSpec"]] = relationship(
        "ProductSpec",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductSpec.sort_order",
    )

    def __repr__(self) -> str:
        return f"<Product(id={self.id}, name={self.name}, price={self.price})>"


class ProductSpec(Base):
    """
    Структурированная характеристика товара — строка в таблице спецификаций.

    Позволяет на фронте рисовать сгруппированную таблицу характеристик:

        Группа «Основные»
          Бренд            Apple
          Модель           iPhone 16 Pro
          Цвет             Чёрный титан

        Группа «Дисплей»
          Диагональ        6.7"
          Разрешение       2796×1290
          Частота          120 Гц

        Группа «Камера»
          Основная камера  48 МП
          Фронтальная      12 МП

    Поля:
        group_name  — название группы («Дисплей», «Производительность», «Камера» …)
        name        — название характеристики («Диагональ экрана», «ОЗУ» …)
        value       — значение в виде строки («6.7», «12» …)
        unit        — единица измерения («дюйм», «ГБ», «МП» …) — опционально
        sort_order  — порядок отображения внутри группы
    """
    __tablename__ = "product_specs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Группа характеристик — для группировки на фронте
    group_name: Mapped[str] = mapped_column(
        String(100), nullable=False, default="Основные",
        comment="Группа характеристик (Дисплей, Камера, Производительность…)",
    )

    # Название характеристики
    name: Mapped[str] = mapped_column(
        String(150), nullable=False,
        comment="Название характеристики (Диагональ, ОЗУ, ЦП…)",
    )

    # Значение — всегда строка, чтобы хранить «6.7», «120», «AMOLED», «True»
    value: Mapped[str] = mapped_column(
        String(500), nullable=False,
        comment="Значение характеристики",
    )

    # Единица измерения — опционально
    unit: Mapped[str | None] = mapped_column(
        String(50), nullable=True,
        comment="Единица измерения (дюйм, ГБ, МП, Гц…)",
    )

    # Порядок отображения
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Связь
    product: Mapped["Product"] = relationship("Product", back_populates="specs")

    def __repr__(self) -> str:
        return f"<ProductSpec(product_id={self.product_id}, group={self.group_name}, name={self.name}, value={self.value})>"

