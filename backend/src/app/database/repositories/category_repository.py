from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.app.database.models.category import Category
from src.app.database.repositories.base import BaseRepository


class CategoryRepository(BaseRepository[Category]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Category, session)

    async def get_all(self, *, offset: int = 0, limit: int = 100) -> Sequence[Category]:
        """Все категории, отсортированные по sort_order, затем по имени."""
        result = await self.session.execute(
            select(Category)
            .order_by(Category.sort_order.asc(), Category.name.asc())
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_by_slug(self, slug: str) -> Category | None:
        """Найти категорию по slug."""
        result = await self.session.execute(
            select(Category).where(Category.slug == slug)
        )
        return result.scalar_one_or_none()

    async def get_by_name(self, name: str) -> Category | None:
        """Найти категорию по названию."""
        result = await self.session.execute(
            select(Category).where(Category.name == name)
        )
        return result.scalar_one_or_none()

    async def get_with_children(self, category_id: UUID) -> Category | None:
        """Получить категорию вместе с подкатегориями."""
        result = await self.session.execute(
            select(Category)
            .where(Category.id == category_id)
            .options(selectinload(Category.children))
        )
        return result.scalar_one_or_none()

    async def get_with_products(self, category_id: UUID) -> Category | None:
        """Получить категорию вместе с товарами."""
        result = await self.session.execute(
            select(Category)
            .where(Category.id == category_id)
            .options(selectinload(Category.products))
        )
        return result.scalar_one_or_none()

    async def get_root_categories(self) -> Sequence[Category]:
        """Получить все корневые категории (без родителя)."""
        result = await self.session.execute(
            select(Category)
            .where(Category.parent_id.is_(None), Category.is_active.is_(True))
            .options(selectinload(Category.children))
            .order_by(Category.sort_order.asc(), Category.name.asc())
        )
        return result.scalars().all()

    async def get_active(self, *, offset: int = 0, limit: int = 100) -> Sequence[Category]:
        """Получить только активные категории."""
        result = await self.session.execute(
            select(Category)
            .where(Category.is_active.is_(True))
            .order_by(Category.sort_order.asc(), Category.name.asc())
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()

    async def slug_exists(self, slug: str, exclude_id: UUID | None = None) -> bool:
        """Проверить уникальность slug (при обновлении исключить текущий объект)."""
        query = select(Category.id).where(Category.slug == slug)
        if exclude_id:
            query = query.where(Category.id != exclude_id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none() is not None

