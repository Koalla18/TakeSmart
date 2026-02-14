from __future__ import annotations

from fastapi import Depends
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession
from typing import AsyncGenerator

from ..core.security import verify_admin
from ..db.redis import get_redis
from ..db.session import get_db


async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db():
        yield session


async def redis_client() -> AsyncGenerator[Redis, None]:
    async for client in get_redis():
        yield client


admin_required = Depends(verify_admin)
