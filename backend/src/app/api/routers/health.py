from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import redis.asyncio as aioredis

from src.app.core.logger import get_logger
from src.app.database.session import get_db
from src.app.redis.client import get_redis

logger = get_logger(__name__)

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("", summary="Проверка состояния сервиса")
async def health_check(
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> dict:
    """
    Возвращает статус приложения и доступность зависимостей:
    - PostgreSQL
    - Redis
    """
    db_status = "ok"
    redis_status = "ok"

    # Проверяем подключение к БД
    try:
        await db.execute(text("SELECT 1"))
        logger.debug("health_db_ok")
    except Exception as exc:
        db_status = f"error: {exc}"
        logger.error("health_db_failed", error=str(exc))

    # Проверяем подключение к Redis
    try:
        await redis.ping()
        logger.debug("health_redis_ok")
    except Exception as exc:
        redis_status = f"error: {exc}"
        logger.error("health_redis_failed", error=str(exc))

    overall = "ok" if db_status == "ok" and redis_status == "ok" else "degraded"

    if overall == "degraded":
        logger.warning("health_degraded", db=db_status, redis=redis_status)
    else:
        logger.info("health_ok")

    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "0.1.0",
        "services": {
            "database": db_status,
            "redis": redis_status,
        },
    }
