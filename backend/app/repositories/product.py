from __future__ import annotations

import uuid

from sqlalchemy import Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Category, Product


class ProductRepository:
    @staticmethod
    def _base_active_query() -> Select:
        return select(Product).where(Product.is_active.is_(True))

    @staticmethod
    async def list_active(
        session: AsyncSession,
        category_slug: str | None,
        is_used: bool | None,
        in_stock: bool | None,
        search: str | None,
    ) -> list[Product]:
        query = ProductRepository._base_active_query()

        if category_slug:
            category = await session.execute(select(Category).where(Category.slug == category_slug))
            category_obj = category.scalars().first()
            if category_obj:
                query = query.where(Product.category_id == category_obj.id)

        if is_used is not None:
            query = query.where(Product.is_used == is_used)

        if in_stock is not None:
            query = query.where(Product.in_stock == in_stock)

        if search:
            search_query = ProductRepository._build_search_query(search)
            query = query.where(Product.tsv.op("@@")(search_query)).order_by(
                func.ts_rank_cd(Product.tsv, search_query).desc()
            )
        else:
            query = query.order_by(Product.sort_order, Product.created_at.desc())

        result = await session.execute(query)
        return list(result.scalars().all())

    @staticmethod
    def _build_search_query(search: str):
        ru_query = func.websearch_to_tsquery("russian", search)
        en_query = func.websearch_to_tsquery("english", search)
        return ru_query.op("||")(en_query)

    @staticmethod
    async def list_all(session: AsyncSession) -> list[Product]:
        result = await session.execute(select(Product).order_by(Product.sort_order, Product.created_at.desc()))
        return list(result.scalars().all())

    @staticmethod
    async def get_by_id(session: AsyncSession, product_id: uuid.UUID) -> Product | None:
        result = await session.execute(select(Product).where(Product.id == product_id))
        return result.scalars().first()

    @staticmethod
    async def get_by_slug(session: AsyncSession, slug: str, active_only: bool) -> Product | None:
        query = select(Product).where(Product.slug == slug)
        if active_only:
            query = query.where(Product.is_active.is_(True))
        result = await session.execute(query)
        return result.scalars().first()

    @staticmethod
    async def get_featured(session: AsyncSession) -> Product | None:
        result = await session.execute(
            select(Product).where(Product.is_featured.is_(True), Product.is_active.is_(True))
        )
        return result.scalars().first()

    @staticmethod
    async def create(session: AsyncSession, data: dict) -> Product:
        product = Product(**data)
        session.add(product)
        await session.commit()
        await session.refresh(product)
        return product

    @staticmethod
    async def update(session: AsyncSession, product: Product, data: dict) -> Product:
        for key, value in data.items():
            setattr(product, key, value)
        await session.commit()
        await session.refresh(product)
        return product

    @staticmethod
    async def delete(session: AsyncSession, product: Product) -> None:
        await session.delete(product)
        await session.commit()

    @staticmethod
    async def unset_featured(session: AsyncSession) -> None:
        await session.execute(update(Product).where(Product.is_featured.is_(True)).values(is_featured=False))
        await session.commit()

    @staticmethod
    async def list_variants(session: AsyncSession, variant_group_id: str) -> list[Product]:
        result = await session.execute(
            select(Product)
            .where(Product.variant_group_id == variant_group_id, Product.is_active.is_(True))
            .order_by(Product.price)
        )
        return list(result.scalars().all())

