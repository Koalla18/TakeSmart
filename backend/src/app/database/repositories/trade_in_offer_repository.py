from __future__ import annotations

from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.trade_in_offer import TradeInOffer
from src.app.database.repositories.base import BaseRepository


class TradeInOfferRepository(BaseRepository[TradeInOffer]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(TradeInOffer, session)

    async def get_active(self, *, limit: int = 500) -> Sequence[TradeInOffer]:
        result = await self.session.execute(
            select(TradeInOffer)
            .where(TradeInOffer.is_active.is_(True))
            .order_by(TradeInOffer.device_label, TradeInOffer.sort_order, TradeInOffer.name)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_all(self, *, offset: int = 0, limit: int = 500) -> Sequence[TradeInOffer]:
        result = await self.session.execute(
            select(TradeInOffer)
            .order_by(TradeInOffer.device_label, TradeInOffer.sort_order, TradeInOffer.name)
            .offset(offset)
            .limit(limit)
        )
        return result.scalars().all()
