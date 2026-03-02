from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

DataT = TypeVar("DataT")


class PaginatedResponse(BaseModel, Generic[DataT]):
    """Универсальный обёртка для постраничных списков."""
    items: list[DataT]
    total: int = Field(..., description="Общее количество объектов")
    offset: int = Field(..., description="Смещение")
    limit: int = Field(..., description="Размер страницы")
    has_next: bool = Field(..., description="Есть ли следующая страница")


class ErrorDetail(BaseModel):
    field: str | None = None
    message: str


class ErrorResponse(BaseModel):
    """Стандартный формат ошибки во всём API."""
    status_code: int
    error: str
    details: list[ErrorDetail] | None = None

