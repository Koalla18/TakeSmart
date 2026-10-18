from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import String, Text, Numeric, Integer, Boolean, DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.app.database.session import Base

if TYPE_CHECKING:
    from src.app.database.models.product import Product


class OrderStatus(str, Enum):
    PENDING = "pending"           # Ожидает подтверждения
    CONFIRMED = "confirmed"       # Подтверждён
    PROCESSING = "processing"     # В обработке / сборке
    SHIPPED = "shipped"           # Отправлен
    DELIVERED = "delivered"       # Доставлен
    CANCELLED = "cancelled"       # Отменён
    REFUNDED = "refunded"         # Возврат


class PaymentStatus(str, Enum):
    UNPAID = "unpaid"
    PAID = "paid"
    REFUNDED = "refunded"
    FAILED = "failed"


class Order(Base):
    """Заказ покупателя."""
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    order_number: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, index=True
    )

    # Контактные данные покупателя
    customer_name: Mapped[str] = mapped_column(String(150), nullable=False)
    customer_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    customer_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Адрес доставки
    shipping_address: Mapped[str] = mapped_column(Text, nullable=False)
    shipping_city: Mapped[str] = mapped_column(String(100), nullable=False)
    shipping_postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Суммы
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    shipping_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    # Статусы
    status: Mapped[str] = mapped_column(
        String(20), default=OrderStatus.PENDING, nullable=False, index=True
    )
    payment_status: Mapped[str] = mapped_column(
        String(20), default=PaymentStatus.UNPAID, nullable=False
    )

    # В заказе есть хотя бы один товар по предзаказу — админка и PWA помечают
    # такой заказ, чтобы сотрудник не искал товар на складе.
    is_preorder: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False,
        comment="Заказ содержит товары по предзаказу",
    )

    # Заметки
    customer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Связи
    items: Mapped[list[OrderItem]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )
    # Комментарии сотрудников. lazy="selectin": заказ всегда приходит вместе с ними —
    # и в списке (счётчик и последний комментарий), и в карточке, — поэтому ни одна
    # ручка не упрётся в ленивую загрузку вне сессии.
    comments: Mapped[list[OrderComment]] = relationship(
        "OrderComment",
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="OrderComment.created_at",
        lazy="selectin",
    )

    @property
    def comments_count(self) -> int:
        return len(self.comments)

    @property
    def last_comment(self) -> OrderComment | None:
        return self.comments[-1] if self.comments else None

    def __repr__(self) -> str:
        return f"<Order(id={self.id}, number={self.order_number}, status={self.status})>"


class OrderComment(Base):
    """Комментарий сотрудника к заказу. Виден только сотрудникам — в админке и в
    приложении «Заказы»; покупателю не уходит."""
    __tablename__ = "order_comments"
    __table_args__ = (
        Index("ix_order_comments_order_id_created_at", "order_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    # Под одной учёткой админки работают несколько человек, поэтому подпись — имя,
    # которое сотрудник указал на своём устройстве, а учётка остаётся для журнала.
    author_name: Mapped[str] = mapped_column(String(60), nullable=False)
    admin_username: Mapped[str | None] = mapped_column(String(150), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    order: Mapped[Order] = relationship("Order", back_populates="comments")

    def __repr__(self) -> str:
        return f"<OrderComment(order={self.order_id}, author={self.author_name})>"


class OrderItem(Base):
    """Позиция в заказе — конкретный товар с зафиксированной ценой."""
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )

    # Снэпшот товара на момент заказа
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_sku: Mapped[str | None] = mapped_column(String(100), nullable=True)

    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    # Связи
    order: Mapped[Order] = relationship("Order", back_populates="items")
    product: Mapped[Product | None] = relationship("Product", back_populates="order_items")

    def __repr__(self) -> str:
        return f"<OrderItem(order={self.order_id}, product={self.product_name}, qty={self.quantity})>"

