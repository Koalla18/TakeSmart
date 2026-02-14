from __future__ import annotations

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Order


class OrderRepository:
    @staticmethod
    async def create(session: AsyncSession, data: dict) -> Order:
        order = Order(**data)
        session.add(order)
        await session.commit()
        await session.refresh(order)
        return order

    @staticmethod
    async def list_all(session: AsyncSession, status: str | None) -> list[Order]:
        query: Select = select(Order)
        if status and status != "all":
            query = query.where(Order.status == status)
        query = query.order_by(Order.created_at.desc())
        result = await session.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def get_by_id(session: AsyncSession, order_id: int) -> Order | None:
        result = await session.execute(select(Order).where(Order.id == order_id))
        return result.scalars().first()

    @staticmethod
    async def update_status(session: AsyncSession, order: Order, status: str) -> Order:
        order.status = status
        await session.commit()
        await session.refresh(order)
        return order

    @staticmethod
    async def delete(session: AsyncSession, order: Order) -> None:
        await session.delete(order)
        await session.commit()

    @staticmethod
    async def analytics_counts(session: AsyncSession, filter_clause) -> int:
        result = await session.execute(select(func.count(Order.id)).where(filter_clause))
        return int(result.scalar() or 0)

    @staticmethod
    async def analytics_sum(session: AsyncSession, filter_clause):
        result = await session.execute(select(func.sum(Order.total_amount)).where(filter_clause))
        return int(result.scalar() or 0)

    @staticmethod
    async def analytics_avg(session: AsyncSession):
        result = await session.execute(select(func.avg(Order.total_amount)).where(Order.total_amount.isnot(None)))
        value = result.scalar()
        return int(value) if value else 0

