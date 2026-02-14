from __future__ import annotations

import json
from typing import Any

from redis.asyncio import Redis


async def get_version(redis: Redis, key: str, default: int = 1) -> int:
    value = await redis.get(key)
    if value is None:
        await redis.set(key, default)
        return default
    return int(value)


def make_cache_key(prefix: str, version: int, suffix: str) -> str:
    return f"cache:{prefix}:v{version}:{suffix}"


async def get_json(redis: Redis, key: str) -> Any | None:
    cached = await redis.get(key)
    if cached is None:
        return None
    return json.loads(cached)


async def set_json(redis: Redis, key: str, value: Any, ttl_seconds: int = 120) -> None:
    await redis.set(key, json.dumps(value, default=str), ex=ttl_seconds)


async def bump_version(redis: Redis, key: str) -> int:
    return int(await redis.incr(key))

