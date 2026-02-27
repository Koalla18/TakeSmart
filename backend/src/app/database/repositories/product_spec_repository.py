from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.product import ProductSpec
from src.app.database.repositories.base import BaseRepository


class ProductSpecRepository(BaseRepository[ProductSpec]):
    """CRUD для характеристик товара (product_specs)."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ProductSpec, session)

    async def get_by_product(self, product_id: UUID) -> Sequence[ProductSpec]:
        """Получить все характеристики товара, упорядоченные по группе и sort_order."""
        result = await self.session.execute(
            select(ProductSpec)
            .where(ProductSpec.product_id == product_id)
            .order_by(ProductSpec.group_name, ProductSpec.sort_order)
        )
        return result.scalars().all()

    async def get_by_product_and_group(
        self, product_id: UUID, group_name: str
    ) -> Sequence[ProductSpec]:
        """Получить характеристики товара по конкретной группе."""
        result = await self.session.execute(
            select(ProductSpec)
            .where(
                ProductSpec.product_id == product_id,
                ProductSpec.group_name == group_name,
            )
            .order_by(ProductSpec.sort_order)
        )
        return result.scalars().all()

    async def bulk_create(
        self,
        product_id: UUID,
        specs: list[dict],
    ) -> Sequence[ProductSpec]:
        """
        Массовое создание характеристик для товара.

        specs — список dict с ключами: group_name, name, value, unit, sort_order
        """
        instances = [
            ProductSpec(product_id=product_id, **spec)
            for spec in specs
        ]
        self.session.add_all(instances)
        await self.session.flush()
        return instances

    async def replace_all(
        self,
        product_id: UUID,
        specs: list[dict],
    ) -> Sequence[ProductSpec]:
        """
        Полная замена всех характеристик товара.
        Удаляет старые и создаёт новые в одной транзакции.
        """
        await self.session.execute(
            delete(ProductSpec).where(ProductSpec.product_id == product_id)
        )
        await self.session.flush()
        return await self.bulk_create(product_id, specs)

    async def delete_by_product(self, product_id: UUID) -> None:
        """Удалить все характеристики товара."""
        await self.session.execute(
            delete(ProductSpec).where(ProductSpec.product_id == product_id)
        )
        await self.session.flush()

