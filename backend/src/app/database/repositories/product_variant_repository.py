from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.product_variant import ProductVariant
from src.app.database.repositories.base import BaseRepository


class ProductVariantRepository(BaseRepository[ProductVariant]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ProductVariant, session)

    async def get_by_product(
        self,
        product_id: UUID,
        *,
        only_active: bool = True,
    ) -> Sequence[ProductVariant]:
        """Получить все варианты товара."""
        conditions = [ProductVariant.product_id == product_id]
        if only_active:
            conditions.append(ProductVariant.is_active.is_(True))

        result = await self.session.execute(
            select(ProductVariant)
            .where(*conditions)
            .order_by(ProductVariant.sort_order)
        )
        return result.scalars().all()

    async def get_by_sku(self, sku: str) -> ProductVariant | None:
        result = await self.session.execute(
            select(ProductVariant).where(ProductVariant.sku == sku)
        )
        return result.scalar_one_or_none()
