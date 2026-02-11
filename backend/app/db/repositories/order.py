from sqlalchemy import select

from app.db.models import Order, OrderItem
from app.db.repositories.base import BaseRepository


class OrderRepository(BaseRepository[Order]):
    model = Order

    async def list_by_user(self, user_id: int, offset: int = 0, limit: int = 100) -> list[Order]:
        result = await self.session.execute(
            select(Order).where(Order.user_id == user_id).offset(offset).limit(limit)
        )
        return result.scalars().all()


class OrderItemRepository(BaseRepository[OrderItem]):
    model = OrderItem

    async def list_by_order(self, order_id: int) -> list[OrderItem]:
        result = await self.session.execute(select(OrderItem).where(OrderItem.order_id == order_id))
        return result.scalars().all()
