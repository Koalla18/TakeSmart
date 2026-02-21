from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


async def get_version(redis: Redis | None, key: str, default: int = 1) -> int:
    if redis is None:
        return default
    try:
        value = await redis.get(key)
        if value is None:
            await redis.set(key, default)
            return default
        return int(value)
    except Exception as exc:
        logger.debug("Redis get_version error: %s", exc)
        return default


def make_cache_key(prefix: str, version: int, suffix: str) -> str:
    return f"cache:{prefix}:v{version}:{suffix}"


async def get_json(redis: Redis | None, key: str) -> Any | None:
    if redis is None:
        return None
    try:
        cached = await redis.get(key)
        if cached is None:
            return None
        return json.loads(cached)
    except Exception as exc:
        logger.debug("Redis get_json error: %s", exc)
        return None


async def set_json(redis: Redis | None, key: str, value: Any, ttl_seconds: int = 120) -> None:
    if redis is None:
        return
    try:
        await redis.set(key, json.dumps(value, default=str), ex=ttl_seconds)
    except Exception as exc:
        logger.debug("Redis set_json error: %s", exc)


async def bump_version(redis: Redis | None, key: str) -> int:
    if redis is None:
        return 1
    try:
        return int(await redis.incr(key))
    except Exception as exc:
        logger.debug("Redis bump_version error: %s", exc)
        return 1
