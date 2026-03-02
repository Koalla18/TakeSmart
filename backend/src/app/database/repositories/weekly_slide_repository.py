from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.weekly_slide import WeeklySlide
from src.app.database.repositories.base import BaseRepository


class WeeklySlideRepository(BaseRepository[WeeklySlide]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(WeeklySlide, session)

    async def get_active(self, *, limit: int = 20) -> Sequence[WeeklySlide]:
        """Получить активные слайды, отсортированные по sort_order."""
        result = await self.session.execute(
            select(WeeklySlide)
            .where(WeeklySlide.is_active.is_(True))
            .order_by(WeeklySlide.sort_order)
            .limit(limit)
        )
        return result.scalars().all()
