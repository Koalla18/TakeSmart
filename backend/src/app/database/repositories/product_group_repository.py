from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.app.database.models.product_group import ProductGroup
from src.app.database.models.product import Product
from src.app.database.repositories.base import BaseRepository


class ProductGroupRepository(BaseRepository[ProductGroup]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ProductGroup, session)

    async def get_all(self) -> Sequence[ProductGroup]:
        """Все группы, отсортированные по имени, с подгруженными продуктами (для подсчёта)."""
        result = await self.session.execute(
            select(ProductGroup)
            .options(selectinload(ProductGroup.products))
            .order_by(ProductGroup.name)
        )
        return result.scalars().all()

    async def get_with_products(self, group_id: UUID) -> ProductGroup | None:
        """Группа со всеми карточками (с подгрузкой images для main_image_url)."""
        result = await self.session.execute(
            select(ProductGroup)
            .where(ProductGroup.id == group_id)
            .options(
                selectinload(ProductGroup.products).selectinload(Product.images)
            )
        )
        return result.scalar_one_or_none()

    async def get_siblings(self, group_id: UUID) -> Sequence[Product]:
        """Все товары в группе, отсортированные по цвету."""
        result = await self.session.execute(
            select(Product)
            .where(Product.group_id == group_id, Product.is_active.is_(True))
            .order_by(Product.color)
        )
        return result.scalars().all()
