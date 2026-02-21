from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Category, Product


class CategoryRepository:
    @staticmethod
    async def list_active(session: AsyncSession) -> list[Category]:
        result = await session.execute(
            select(Category).where(Category.is_active.is_(True)).order_by(Category.sort_order)
        )
        return list(result.scalars().all())

    @staticmethod
    async def list_all(session: AsyncSession) -> list[Category]:
        result = await session.execute(select(Category).order_by(Category.sort_order))
        return list(result.scalars().all())

    @staticmethod
    async def get_by_id(session: AsyncSession, category_id: uuid.UUID) -> Category | None:
        result = await session.execute(select(Category).where(Category.id == category_id))
        return result.scalars().first()

    @staticmethod
    async def get_by_slug(session: AsyncSession, slug: str) -> Category | None:
        result = await session.execute(select(Category).where(Category.slug == slug))
        return result.scalars().first()

    @staticmethod
    async def create(session: AsyncSession, data: dict) -> Category:
        category = Category(**data)
        session.add(category)
        await session.commit()
        await session.refresh(category)
        return category

    @staticmethod
    async def update(session: AsyncSession, category: Category, data: dict) -> Category:
        for key, value in data.items():
            setattr(category, key, value)
        await session.commit()
        await session.refresh(category)
        return category

    @staticmethod
    async def delete(session: AsyncSession, category: Category) -> None:
        await session.delete(category)
        await session.commit()

    @staticmethod
    async def clear_products_category(session: AsyncSession, category_id: uuid.UUID) -> None:
        await session.execute(
            update(Product).where(Product.category_id == category_id).values(category_id=None)
        )
        await session.commit()


