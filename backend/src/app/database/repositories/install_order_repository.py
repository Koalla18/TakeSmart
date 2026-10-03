from __future__ import annotations

from datetime import datetime
from typing import Sequence
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.install_order import InstallAccount, InstallApp, InstallOrder
from src.app.database.repositories.base import BaseRepository


class InstallAccountRepository(BaseRepository[InstallAccount]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InstallAccount, session)

    async def list_all(self) -> Sequence[InstallAccount]:
        return (await self.session.execute(select(InstallAccount).order_by(InstallAccount.created_at))).scalars().all()


class InstallAppRepository(BaseRepository[InstallApp]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InstallApp, session)

    async def list_for(self, *, account_id: UUID | None = None, only_active: bool = False,
                       pool_only: bool = False) -> Sequence[InstallApp]:
        q = select(InstallApp)
        if pool_only:
            q = q.where(InstallApp.account_id.is_(None))
        elif account_id is not None:
            q = q.where(InstallApp.account_id == account_id)
        if only_active:
            # Показываем, если приложение включено и его аккаунт тоже включён (у записей пула аккаунта нет)
            q = q.outerjoin(InstallAccount, InstallAccount.id == InstallApp.account_id).where(
                InstallApp.is_active.is_(True),
                (InstallApp.account_id.is_(None)) | (InstallAccount.is_active.is_(True)))
        q = q.order_by(InstallApp.sort, func.lower(func.coalesce(InstallApp.title, InstallApp.name)))
        return (await self.session.execute(q)).scalars().all()

    async def get_many(self, ids: list[UUID]) -> Sequence[InstallApp]:
        if not ids:
            return []
        return (await self.session.execute(select(InstallApp).where(InstallApp.id.in_(ids)))).scalars().all()

    async def by_bundle(self, account_id: UUID | None) -> dict[str, InstallApp]:
        q = select(InstallApp).where(InstallApp.account_id == account_id) if account_id is not None \
            else select(InstallApp).where(InstallApp.account_id.is_(None))
        rows = (await self.session.execute(q)).scalars().all()
        return {r.bundle_id: r for r in rows}

    async def counts(self) -> dict[UUID, tuple[int, int]]:
        """account_id → (всего, показывается в каталоге). Записи пула (account_id пуст) сюда не попадают."""
        rows = (await self.session.execute(
            select(InstallApp.account_id, func.count(), func.count().filter(InstallApp.is_active.is_(True)))
            .where(InstallApp.account_id.isnot(None))
            .group_by(InstallApp.account_id)
        )).all()
        return {r[0]: (int(r[1]), int(r[2])) for r in rows}

    async def pool_count(self) -> tuple[int, int]:
        """Пул: (всего, показывается в каталоге)."""
        row = (await self.session.execute(
            select(func.count(), func.count().filter(InstallApp.is_active.is_(True)))
            .where(InstallApp.account_id.is_(None))
        )).one()
        return int(row[0]), int(row[1])

    async def set_active(self, ids: list[UUID], is_active: bool) -> int:
        if not ids:
            return 0
        res = await self.session.execute(update(InstallApp).where(InstallApp.id.in_(ids)).values(is_active=is_active))
        return int(res.rowcount or 0)


class InstallOrderRepository(BaseRepository[InstallOrder]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InstallOrder, session)

    async def get_by_token(self, token: str) -> InstallOrder | None:
        return (await self.session.execute(select(InstallOrder).where(InstallOrder.token == token))).scalar_one_or_none()

    async def list_recent(self, limit: int, statuses: list[str] | None = None) -> Sequence[InstallOrder]:
        q = select(InstallOrder)
        if statuses:
            q = q.where(InstallOrder.status.in_(statuses))
        return (await self.session.execute(q.order_by(InstallOrder.created_at.desc()).limit(limit))).scalars().all()

    async def since(self, since: datetime) -> Sequence[InstallOrder]:
        return (await self.session.execute(select(InstallOrder).where(InstallOrder.created_at >= since))).scalars().all()

    async def status_counts(self) -> dict[str, int]:
        rows = (await self.session.execute(select(InstallOrder.status, func.count()).group_by(InstallOrder.status))).all()
        return {r[0]: int(r[1]) for r in rows}

    async def open_for_account(self, account_id: UUID) -> int:
        return int((await self.session.execute(
            select(func.count()).select_from(InstallOrder)
            .where(InstallOrder.account_id == account_id, InstallOrder.status.in_(("new", "ready", "active")))
        )).scalar_one())
