from __future__ import annotations

from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.hero_banner import HeroBanner
from src.app.database.repositories.base import BaseRepository


class HeroBannerRepository(BaseRepository[HeroBanner]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(HeroBanner, session)

    async def get_active(self, *, limit: int = 20) -> Sequence[HeroBanner]:
        """Активные баннеры, отсортированные по sort_order (для лендинга)."""
        result = await self.session.execute(
            select(HeroBanner)
            .where(HeroBanner.is_active.is_(True))
            .order_by(HeroBanner.sort_order)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_all_sorted(self, *, limit: int = 100) -> Sequence[HeroBanner]:
        """Все баннеры (включая скрытые), по sort_order — для админки."""
        result = await self.session.execute(
            select(HeroBanner).order_by(HeroBanner.sort_order).limit(limit)
        )
        return result.scalars().all()
