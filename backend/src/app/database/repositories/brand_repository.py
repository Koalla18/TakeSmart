from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.brand import Brand
from src.app.database.repositories.base import BaseRepository


class BrandRepository(BaseRepository[Brand]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Brand, session)

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
