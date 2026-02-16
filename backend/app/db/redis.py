from __future__ import annotations

from typing import AsyncGenerator

from redis.asyncio import Redis

from ..core.config import settings


_redis: Redis | None = None


def get_redis_client() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def get_redis() -> AsyncGenerator[Redis, None]:
    yield get_redis_client()


async def init_redis() -> None:
    """Initialize Redis connection on startup."""
    global _redis
    _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    # Test connection
    await _redis.ping()


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.close()
        _redis = None

