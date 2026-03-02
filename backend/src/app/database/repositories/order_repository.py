from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.app.database.models.order import Order, OrderItem, OrderStatus, PaymentStatus
from src.app.database.repositories.base import BaseRepository


class OrderRepository(BaseRepository[Order]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Order, session)

    async def get_all(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Order]:
        """Получить все заказы, новые — сверху."""
        result = await self.session.execute(
            select(Order)
            .order_by(Order.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_by_order_number(self, order_number: str) -> Order | None:
        """Найти заказ по номеру."""
        result = await self.session.execute(
            select(Order).where(Order.order_number == order_number)
        )
        return result.scalar_one_or_none()

    async def get_with_items(self, order_id: UUID) -> Order | None:
        """Получить заказ вместе с позициями."""
        result = await self.session.execute(
            select(Order)
            .where(Order.id == order_id)
            .options(
                selectinload(Order.items).selectinload(OrderItem.product)
            )
        )
        return result.scalar_one_or_none()

    async def get_by_customer_email(
        self,
        email: str,
        *,
        offset: int = 0,
        limit: int = 50,
    ) -> Sequence[Order]:
        """Получить все заказы покупателя по email."""
        result = await self.session.execute(
            select(Order)
            .where(Order.customer_email == email)
            .order_by(Order.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_by_status(
        self,
        status: OrderStatus,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Order]:
        """Получить заказы по статусу."""
        result = await self.session.execute(
            select(Order)
            .where(Order.status == status.value)
            .order_by(Order.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_by_payment_status(
        self,
        payment_status: PaymentStatus,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Order]:
        """Получить заказы по статусу оплаты."""
        result = await self.session.execute(
            select(Order)
            .where(Order.payment_status == payment_status.value)
            .order_by(Order.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def update_status(
        self,
        order_id: UUID,
        status: OrderStatus,
    ) -> Order | None:
        """Обновить статус заказа."""
        return await self.update(order_id, status=status.value)

    async def update_payment_status(
        self,
        order_id: UUID,
        payment_status: PaymentStatus,
    ) -> Order | None:
        """Обновить статус оплаты."""
        return await self.update(order_id, payment_status=payment_status.value)

    async def get_all_with_items(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Order]:
        """Получить все заказы вместе с позициями (для админки)."""
        result = await self.session.execute(
            select(Order)
            .options(selectinload(Order.items))
            .order_by(Order.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()


class OrderItemRepository(BaseRepository[OrderItem]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(OrderItem, session)

    async def get_by_order(self, order_id: UUID) -> Sequence[OrderItem]:
        """Получить все позиции конкретного заказа."""
        result = await self.session.execute(
            select(OrderItem)
            .where(OrderItem.order_id == order_id)
        )
        return result.scalars().all()

    async def get_with_product(self, item_id: UUID) -> OrderItem | None:
        """Получить позицию заказа вместе с товаром."""
        result = await self.session.execute(
            select(OrderItem)
            .where(OrderItem.id == item_id)
            .options(selectinload(OrderItem.product))
        )
        return result.scalar_one_or_none()

