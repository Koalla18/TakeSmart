from __future__ import annotations

from decimal import Decimal
from typing import Any, Sequence
from uuid import UUID

from sqlalchemy import select, and_, cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.app.database.models.product import Product
from src.app.database.repositories.base import BaseRepository


class ProductRepository(BaseRepository[Product]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Product, session)

    async def get_by_slug(self, slug: str) -> Product | None:
        """Найти товар по slug."""
        result = await self.session.execute(
            select(Product).where(Product.slug == slug)
        )
        return result.scalar_one_or_none()

    async def get_by_sku(self, sku: str) -> Product | None:
        """Найти товар по артикулу (SKU)."""
        result = await self.session.execute(
            select(Product).where(Product.sku == sku)
        )
        return result.scalar_one_or_none()

    async def get_with_category(self, product_id: UUID) -> Product | None:
        """Получить товар вместе с категорией."""
        result = await self.session.execute(
            select(Product)
            .where(Product.id == product_id)
            .options(selectinload(Product.category))
        )
        return result.scalar_one_or_none()

    async def get_by_category(
        self,
        category_id: UUID,
        *,
        offset: int = 0,
        limit: int = 100,
        only_active: bool = True,
    ) -> Sequence[Product]:
        """Получить товары по категории."""
        conditions = [Product.category_id == category_id]
        if only_active:
            conditions.append(Product.is_active.is_(True))

        result = await self.session.execute(
            select(Product)
            .where(and_(*conditions))
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_active(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Product]:
        """Получить только активные товары."""
        result = await self.session.execute(
            select(Product)
            .where(Product.is_active.is_(True))
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_featured(self, *, limit: int = 20) -> Sequence[Product]:
        """Получить товары на витрине (is_featured=True)."""
        result = await self.session.execute(
            select(Product)
            .where(Product.is_featured.is_(True), Product.is_active.is_(True))
            .limit(limit)
        )
        return result.scalars().all()

    async def search_by_name(
        self,
        query: str,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Product]:
        """Полнотекстовый поиск по названию товара (case-insensitive)."""
        result = await self.session.execute(
            select(Product)
            .where(
                Product.name.ilike(f"%{query}%"),
                Product.is_active.is_(True),
            )
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def filter_by_price(
        self,
        min_price: Decimal | None = None,
        max_price: Decimal | None = None,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Product]:
        """Фильтрация товаров по диапазону цен."""
        conditions: list[Any] = [Product.is_active.is_(True)]
        if min_price is not None:
            conditions.append(Product.price >= min_price)
        if max_price is not None:
            conditions.append(Product.price <= max_price)

        result = await self.session.execute(
            select(Product)
            .where(and_(*conditions))
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_by_brand(
        self,
        brand: str,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Product]:
        """Получить товары по бренду."""
        result = await self.session.execute(
            select(Product)
            .where(
                Product.brand.ilike(brand),
                Product.is_active.is_(True),
            )
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def slug_exists(self, slug: str, exclude_id: UUID | None = None) -> bool:
        """Проверить уникальность slug."""
        query = select(Product.id).where(Product.slug == slug)
        if exclude_id:
            query = query.where(Product.id != exclude_id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none() is not None

    async def decrement_stock(self, product_id: UUID, quantity: int) -> Product | None:
        """Уменьшить остаток на складе (используется при создании заказа)."""
        product = await self.get_by_id(product_id)
        if product is None:
            return None
        new_qty = max(0, product.stock_quantity - quantity)
        return await self.update(product_id, stock_quantity=new_qty)

    async def filter_by_attributes(
        self,
        attrs: dict[str, Any],
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[Product]:
        """
        Фильтрация товаров по произвольным атрибутам из JSONB-поля.

        Пример:
            attrs = {"ram_gb": 12, "5g": True}
            → WHERE attributes @> '{"ram_gb": 12, "5g": true}'

        Использует GIN-индекс ix_products_attributes_gin для быстрого поиска.
        """
        result = await self.session.execute(
            select(Product)
            .where(
                Product.is_active.is_(True),
                Product.attributes.cast(JSONB).contains(attrs),
            )
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_with_specs(self, product_id: UUID) -> Product | None:
        """Получить товар вместе с категорией, изображениями и спецификациями."""
        result = await self.session.execute(
            select(Product)
            .where(Product.id == product_id)
            .options(
                selectinload(Product.category),
                selectinload(Product.images),
                selectinload(Product.specs),
                selectinload(Product.variants),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_slug_with_specs(self, slug: str) -> Product | None:
        """Получить товар по slug вместе со всеми связанными данными."""
        result = await self.session.execute(
            select(Product)
            .where(Product.slug == slug)
            .options(
                selectinload(Product.category),
                selectinload(Product.images),
                selectinload(Product.specs),
                selectinload(Product.variants),
            )
        )
        return result.scalar_one_or_none()

