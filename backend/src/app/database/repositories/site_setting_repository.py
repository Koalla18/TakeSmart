from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.site_setting import SiteSetting


class SiteSettingRepository:
    """Ключ-значение настроек витрины. Ключ — первичный ключ, поэтому без BaseRepository."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_all(self) -> dict[str, Any]:
        result = await self.session.execute(select(SiteSetting))
        return {row.key: row.value for row in result.scalars().all()}

    async def get(self, key: str) -> Any | None:
        row = await self.session.get(SiteSetting, key)
        return None if row is None else row.value

    async def set(self, key: str, value: Any) -> SiteSetting:
        row = await self.session.get(SiteSetting, key)
        if row is None:
            row = SiteSetting(key=key, value=value)
            self.session.add(row)
        else:
            row.value = value
        await self.session.flush()
        return row
