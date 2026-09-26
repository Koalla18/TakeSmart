from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.iphone_install import InstallJob, InstallStation
from src.app.database.repositories.base import BaseRepository


class InstallStationRepository(BaseRepository[InstallStation]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InstallStation, session)

    async def list_all(self) -> Sequence[InstallStation]:
        return (await self.session.execute(select(InstallStation).order_by(InstallStation.created_at))).scalars().all()

    async def get_by_token_hash(self, token_hash: str) -> InstallStation | None:
        return (await self.session.execute(
            select(InstallStation).where(InstallStation.token_hash == token_hash, InstallStation.is_active.is_(True))
        )).scalar_one_or_none()


class InstallJobRepository(BaseRepository[InstallJob]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InstallJob, session)

    async def list_recent(self, limit: int) -> Sequence[InstallJob]:
        return (await self.session.execute(
            select(InstallJob).order_by(InstallJob.created_at.desc()).limit(limit)
        )).scalars().all()

    async def since(self, since: datetime) -> Sequence[InstallJob]:
        return (await self.session.execute(select(InstallJob).where(InstallJob.created_at >= since))).scalars().all()

    async def running_for_station(self, station_id) -> Sequence[InstallJob]:
        return (await self.session.execute(
            select(InstallJob).where(InstallJob.station_id == station_id, InstallJob.status == "running")
        )).scalars().all()


def station_online(station: InstallStation, *, window_seconds: int = 20) -> bool:
    return bool(station.last_seen_at) and (datetime.now(timezone.utc) - station.last_seen_at) < timedelta(seconds=window_seconds)
