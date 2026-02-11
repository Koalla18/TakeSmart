from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import UserSession
from app.db.repositories.base import BaseRepository


class SessionRepository(BaseRepository[UserSession]):
    model = UserSession

    async def get_by_token(self, token: str) -> UserSession | None:
        result = await self.session.execute(select(UserSession).where(UserSession.token == token))
        return result.scalars().first()

    async def delete_by_token(self, token: str) -> None:
        session = await self.get_by_token(token)
        if session:
            await self.delete(session)
