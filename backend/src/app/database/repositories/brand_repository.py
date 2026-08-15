from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.brand import Brand
from src.app.database.models.product import Product
from src.app.database.repositories.base import BaseRepository


class BrandRepository(BaseRepository[Brand]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Brand, session)

    def _counts_subquery(self):
        """Подзапрос «lower(бренд) → число товаров» — для выборок со счётчиками."""
        return (
            select(
                func.lower(Product.brand).label("brand_lower"),
                func.count(Product.id).label("products_count"),
            )
            .where(Product.brand.is_not(None))
            .group_by(func.lower(Product.brand))
            .subquery()
        )

    async def get_active_with_counts(
        self, *, offset: int = 0, limit: int = 100
    ) -> list[tuple[Brand, int]]:
        """Активные бренды + количество товаров каждого (одним запросом, без N+1).

        Связь бренд↔товар — по строке products.brand без FK, поэтому джойним
        по lower(имени).
        """
        counts = self._counts_subquery()
        result = await self.session.execute(
            select(Brand, func.coalesce(counts.c.products_count, 0))
            .outerjoin(counts, func.lower(Brand.name) == counts.c.brand_lower)
            .where(Brand.is_active.is_(True))
            .order_by(Brand.name)
            .offset(offset)
            .limit(limit)
        )
        return [(brand, int(count)) for brand, count in result.all()]

    async def get_all_with_counts(
        self, *, offset: int = 0, limit: int = 100
    ) -> list[tuple[Brand, int]]:
        """Все бренды (для админки) + количество товаров каждого одним запросом."""
        counts = self._counts_subquery()
        result = await self.session.execute(
            select(Brand, func.coalesce(counts.c.products_count, 0))
            .outerjoin(counts, func.lower(Brand.name) == counts.c.brand_lower)
            .order_by(Brand.name)
            .offset(offset)
            .limit(limit)
        )
        return [(brand, int(count)) for brand, count in result.all()]

    async def get_active(self, *, offset: int = 0, limit: int = 100) -> Sequence[Brand]:
        result = await self.session.execute(
            select(Brand)
            .where(Brand.is_active.is_(True))
            .order_by(Brand.name)
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_by_name(self, name: str) -> Brand | None:
        result = await self.session.execute(select(Brand).where(Brand.name == name))
        return result.scalar_one_or_none()

    async def slug_exists(self, slug: str, exclude_id: UUID | None = None) -> bool:
        query = select(Brand.id).where(Brand.slug == slug)
        if exclude_id:
            query = query.where(Brand.id != exclude_id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none() is not None
