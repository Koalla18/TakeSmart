"""
Middleware для добавления X-Request-ID к каждому запросу.
Позволяет трассировать запросы в логах и в ответах клиенту.
"""
from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Добавляет уникальный X-Request-ID к каждому запросу.
    Если клиент прислал свой — используем его (с валидацией),
    иначе генерируем новый UUID4.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # Берём из заголовка или генерируем
        request_id = request.headers.get("X-Request-ID", "")
        if not request_id or len(request_id) > 64:
            request_id = str(uuid.uuid4())

        # Кладём в state для использования в роутерах
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

