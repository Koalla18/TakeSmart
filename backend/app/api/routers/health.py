"""
Health check endpoints.

GET /health        — быстрый liveness probe (nginx/k8s/Docker HEALTHCHECK)
GET /health/ready  — readiness probe с проверкой БД и Redis
"""
from __future__ import annotations

import time
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import db_session
from ...db.redis import get_redis_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["system"])

# Время старта приложения для uptime
_START_TIME = time.time()


@router.get(
    "/health",
    summary="Liveness probe",
    description="Быстрая проверка — приложение живо. Используется Docker HEALTHCHECK.",
)
async def health_check() -> dict:
    return {"ok": True, "uptime_seconds": round(time.time() - _START_TIME)}


@router.get(
    "/health/ready",
    summary="Readiness probe",
    description="Детальная проверка готовности: БД + Redis.",
)
async def readiness_check(db: AsyncSession = Depends(db_session)) -> dict:
    """
    Возвращает статус каждого зависимого сервиса.
    HTTP 200 — всё ок, HTTP 503 — что-то недоступно.
    """

    result: dict = {
        "status": "ok",
        "uptime_seconds": round(time.time() - _START_TIME),
        "services": {},
    }
    all_ok = True

    # ── PostgreSQL ────────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        db_latency = round((time.perf_counter() - t0) * 1000, 2)
        result["services"]["postgres"] = {"status": "ok", "latency_ms": db_latency}
        logger.debug("Health DB ok latency=%.2fms", db_latency)
    except Exception as exc:
        result["services"]["postgres"] = {"status": "error", "detail": str(exc)}
        all_ok = False
        logger.warning("Health DB error: %s", exc)

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis = get_redis_client()
    if redis is None:
        result["services"]["redis"] = {"status": "disabled"}
    else:
        t0 = time.perf_counter()
        try:
            await redis.ping()
            redis_latency = round((time.perf_counter() - t0) * 1000, 2)
            result["services"]["redis"] = {"status": "ok", "latency_ms": redis_latency}
        except Exception as exc:
            result["services"]["redis"] = {"status": "error", "detail": str(exc)}
            all_ok = False
            logger.warning("Health Redis error: %s", exc)

    if not all_ok:
        result["status"] = "degraded"
        return JSONResponse(status_code=503, content=result)

    return result
