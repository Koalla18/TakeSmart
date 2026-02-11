from sqlalchemy import select

from app.db.models import Cart, CartItem
from app.db.repositories.base import BaseRepository


class CartRepository(BaseRepository[Cart]):
    model = Cart

    async def get_active_by_user(self, user_id: int) -> Cart | None:
        result = await self.session.execute(
            select(Cart).where(Cart.user_id == user_id, Cart.status == "active")
        )
        return result.scalars().first()


class CartItemRepository(BaseRepository[CartItem]):
    model = CartItem

    async def list_by_cart(self, cart_id: int) -> list[CartItem]:
        result = await self.session.execute(select(CartItem).where(CartItem.cart_id == cart_id))
        return result.scalars().all()

    async def get_by_cart_product(self, cart_id: int, product_id: int) -> CartItem | None:
        result = await self.session.execute(
            select(CartItem).where(CartItem.cart_id == cart_id, CartItem.product_id == product_id)
        )
        return result.scalars().first()
