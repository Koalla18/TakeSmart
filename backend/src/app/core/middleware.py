from __future__ import annotations

import time
import uuid
from typing import Callable

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from src.app.core.logger import get_logger

logger = get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware логирует каждый HTTP-запрос и ответ:
      - request_id   — уникальный UUID каждого запроса (можно прокидывать в заголовке X-Request-ID)
      - метод, путь, query-параметры
      - статус ответа
      - время выполнения в миллисекундах
      - IP клиента
      - User-Agent

    request_id привязывается к structlog contextvars — он автоматически
    появится во всех логах, которые произошли внутри этого запроса.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Берём request_id из заголовка или генерируем новый
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

        # Привязываем к контексту structlog — все последующие логи
        # внутри этого запроса автоматически получат request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        start_time = time.perf_counter()

        # Логируем входящий запрос
        logger.info(
            "request_started",
            query_params=str(request.query_params) or None,
            client_ip=_get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )

        # Обрабатываем запрос
        try:
            response: Response = await call_next(request)
        except Exception as exc:
            duration_ms = _elapsed_ms(start_time)
            logger.exception(
                "request_failed",
                duration_ms=duration_ms,
                error=str(exc),
            )
            raise

        duration_ms = _elapsed_ms(start_time)

        # Логируем завершённый ответ
        log_fn = logger.warning if response.status_code >= 400 else logger.info
        log_fn(
            "request_finished",
            status_code=response.status_code,
            duration_ms=duration_ms,
        )

        # Прокидываем request_id обратно клиенту
        response.headers["X-Request-ID"] = request_id

        structlog.contextvars.clear_contextvars()
        return response


def _get_client_ip(request: Request) -> str:
    """Учитывает заголовок X-Forwarded-For (за reverse-proxy)."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)

