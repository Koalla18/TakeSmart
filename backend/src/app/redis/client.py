from typing import AsyncGenerator

import redis.asyncio as aioredis

from src.app.core.config import settings
from src.app.core.logger import get_logger

logger = get_logger(__name__)

# Пул соединений Redis
redis_pool: aioredis.Redis | None = None


async def get_redis_pool() -> aioredis.Redis:
    """Создаёт пул соединений Redis при старте приложения."""
    global redis_pool
    redis_pool = aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        max_connections=20,
    )
    logger.debug("redis_pool_created", url=settings.redis_url, max_connections=20)
    return redis_pool


async def close_redis_pool() -> None:
    """Закрывает пул соединений Redis при остановке приложения."""
    global redis_pool
    if redis_pool:
        await redis_pool.aclose()
        redis_pool = None
        logger.debug("redis_pool_closed")


async def get_redis() -> AsyncGenerator[aioredis.Redis, None]:
    """Dependency для получения Redis-клиента в роутерах."""
    if redis_pool is None:
        logger.error("redis_pool_not_initialized")
        raise RuntimeError("Redis pool is not initialized")
    yield redis_pool
