import json
import logging
from typing import Any

from app.core.config import settings
from app.db.redis import get_redis

logger = logging.getLogger(__name__)


async def get_json(key: str) -> Any | None:
    try:
        client = get_redis()
        raw = await client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:  # pragma: no cover - redis optional
        logger.warning("cache get failed key=%s error=%s", key, exc)
        return None


async def set_json(key: str, value: Any, ttl_seconds: int | None = None) -> None:
    try:
        client = get_redis()
        payload = json.dumps(value, default=str)
        ttl = ttl_seconds or settings.cache_ttl_seconds
        await client.setex(key, ttl, payload)
    except Exception as exc:  # pragma: no cover - redis optional
        logger.warning("cache set failed key=%s error=%s", key, exc)


async def invalidate_prefix(prefix: str) -> None:
    try:
        client = get_redis()
        keys = [key async for key in client.scan_iter(match=f"{prefix}*")]
        if keys:
            await client.delete(*keys)
    except Exception as exc:  # pragma: no cover - redis optional
        logger.warning("cache invalidate failed prefix=%s error=%s", prefix, exc)
