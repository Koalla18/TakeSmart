"""Схемы аналитики магазина: счётчик визитов и сводка для админки."""
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ── Счётчик визитов (публичный) ──────────────────────────────── #

class VisitIn(BaseModel):
    """Событие просмотра страницы витрины.

    Все поля кроме path необязательны: счётчик не должен ломать сайт,
    поэтому принимаем всё, что смог отдать браузер.
    """
    path: str = Field(..., description="Путь страницы, например /catalog")
    referrer: str | None = Field(None, description="Откуда пришёл посетитель")
    visitor_id: str | None = Field(None, description="Анонимный id из localStorage (год)")
    session_id: str | None = Field(None, description="Анонимный id из sessionStorage")


# ── Аналитика (админская) ────────────────────────────────────── #

class AnalyticsRange(BaseModel):
    """Границы периода (включительно) и его длина в днях."""
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(..., alias="from", description="Начало периода, YYYY-MM-DD")
    to: str = Field(..., description="Конец периода включительно, YYYY-MM-DD")
    days: int = Field(..., description="Число дней в периоде")


class MetricPair(BaseModel):
    """Денежная / процентная метрика: текущий период и предыдущий."""
    current: float
    previous: float


class CountPair(BaseModel):
    """Штучная метрика: текущий период и предыдущий."""
    current: int
    previous: int


class AnalyticsKpi(BaseModel):
    revenue: MetricPair = Field(..., description="Выручка, ₽")
    orders: CountPair = Field(..., description="Количество заказов")
    avg_check: MetricPair = Field(..., description="Средний чек, ₽")
    items_sold: CountPair = Field(..., description="Продано товаров, шт")
    visits: CountPair = Field(..., description="Визиты (уникальные сессии)")
    conversion: MetricPair = Field(..., description="Конверсия заказы/визиты, %")


class SeriesPoint(BaseModel):
    """Точка графика: день периода (или час, если period=day)."""
    bucket: str = Field(..., description="YYYY-MM-DD либо YYYY-MM-DDTHH:00")
    revenue: float
    orders: int
    visits: int


class StatusBreakdown(BaseModel):
    status: str
    orders: int
    revenue: float


class TopProduct(BaseModel):
    product_id: UUID | None = Field(None, description="null, если товар удалён")
    name: str
    qty: int
    revenue: float


class TopBrand(BaseModel):
    brand: str
    qty: int
    revenue: float


class TopCategory(BaseModel):
    category_id: UUID | None = None
    name: str
    qty: int
    revenue: float


class TopPage(BaseModel):
    path: str
    visits: int


class AnalyticsOut(BaseModel):
    """Полная сводка аналитики за период с сравнением с предыдущим."""
    range: AnalyticsRange
    previous_range: AnalyticsRange
    kpi: AnalyticsKpi
    series: list[SeriesPoint]
    previous_series: list[SeriesPoint]
    by_status: list[StatusBreakdown]
    top_products: list[TopProduct]
    top_brands: list[TopBrand]
    top_categories: list[TopCategory]
    top_pages: list[TopPage]
