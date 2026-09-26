from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Sequence
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.iphone_install import InstallJob, InstallRequest, InstallStation, IphoneApp
from src.app.database.repositories.base import BaseRepository


class IphoneAppRepository(BaseRepository[IphoneApp]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(IphoneApp, session)

    async def list_all(self, *, active_only: bool) -> Sequence[IphoneApp]:
        q = select(IphoneApp).order_by(IphoneApp.sort_order, IphoneApp.name)
        if active_only:
            q = q.where(IphoneApp.is_active.is_(True))
        return (await self.session.execute(q)).scalars().all()

    async def get_by_ids(self, ids: list[UUID]) -> Sequence[IphoneApp]:
        if not ids:
            return []
        return (await self.session.execute(select(IphoneApp).where(IphoneApp.id.in_(ids)))).scalars().all()

    async def get_by_bundle(self, bundle_id: str) -> IphoneApp | None:
        return (await self.session.execute(select(IphoneApp).where(IphoneApp.bundle_id == bundle_id))).scalar_one_or_none()


class InstallStationRepository(BaseRepository[InstallStation]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InstallStation, session)

    async def list_all(self) -> Sequence[InstallStation]:
        return (await self.session.execute(select(InstallStation).order_by(InstallStation.created_at))).scalars().all()

    async def get_by_token_hash(self, token_hash: str) -> InstallStation | None:
        return (await self.session.execute(
            select(InstallStation).where(InstallStation.token_hash == token_hash, InstallStation.is_active.is_(True))
        )).scalar_one_or_none()


class InstallRequestRepository(BaseRepository[InstallRequest]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InstallRequest, session)

    async def list(self, *, status: str | None, limit: int) -> Sequence[InstallRequest]:
        q = select(InstallRequest).order_by(InstallRequest.created_at.desc()).limit(limit)
        if status:
            q = q.where(InstallRequest.status == status)
        return (await self.session.execute(q)).scalars().all()

    async def count_by_status(self) -> dict[str, int]:
        rows = (await self.session.execute(
            select(InstallRequest.status, func.count(InstallRequest.id)).group_by(InstallRequest.status)
        )).all()
        return {status: int(n) for status, n in rows}


class InstallJobRepository(BaseRepository[InstallJob]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InstallJob, session)

    async def list_for_request(self, request_id: UUID) -> Sequence[InstallJob]:
        return (await self.session.execute(
            select(InstallJob).where(InstallJob.request_id == request_id).order_by(InstallJob.created_at.desc())
        )).scalars().all()

    async def active_for_station(self, station_id: UUID) -> InstallJob | None:
        """Задание, которое станция ещё не закончила: сначала запущенное, потом самое старое в очереди."""
        q = (select(InstallJob)
             .where(InstallJob.station_id == station_id, InstallJob.status.in_(("running", "queued")))
             .order_by((InstallJob.status == "running").desc(), InstallJob.created_at)
             .limit(1))
        return (await self.session.execute(q)).scalar_one_or_none()

    async def finished_since(self, since: datetime) -> Sequence[InstallJob]:
        return (await self.session.execute(
            select(InstallJob).where(InstallJob.finished_at >= since, InstallJob.status.in_(("done", "failed")))
        )).scalars().all()

    async def claim(self, job_id: UUID, station_id: UUID, **device: str | None) -> bool:
        """Переводит queued → running только если задание ещё в очереди и принадлежит этой станции."""
        result = await self.session.execute(
            update(InstallJob)
            .where(InstallJob.id == job_id, InstallJob.station_id == station_id, InstallJob.status == "queued")
            .values(status="running", started_at=datetime.now(timezone.utc), **{k: v for k, v in device.items() if v})
        )
        return bool(result.rowcount)


def station_online(station: InstallStation, *, window_seconds: int = 20) -> bool:
    return bool(station.last_seen_at) and (datetime.now(timezone.utc) - station.last_seen_at) < timedelta(seconds=window_seconds)
