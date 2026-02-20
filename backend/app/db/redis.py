from __future__ import annotations

import logging
from typing import AsyncGenerator

from redis.asyncio import Redis

from ..core.config import settings

logger = logging.getLogger(__name__)

_redis: Redis | None = None


def get_redis_client() -> Redis | None:
    return _redis


async def get_redis() -> AsyncGenerator[Redis | None, None]:
    yield _redis


async def init_redis() -> None:
    """Initialize Redis connection on startup. Non-fatal if Redis URL is not set."""
    global _redis
    if not settings.redis_url:
        logger.warning("⚠️  REDIS_URL не задан — rate limiting отключён")
        return
    try:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
        await _redis.ping()
        logger.info("✅ Redis подключён: %s", settings.redis_url)
    except Exception as exc:
        logger.warning("⚠️  Не удалось подключиться к Redis: %s", exc)
        _redis = None


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.close()
        _redis = None

