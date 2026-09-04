"""
Аналитика магазина.

- POST /track/visit      — публичный счётчик визитов витрины (без авторизации)
- GET  /admin/analytics  — сводка для админки (KPI, графики, топы)

Все агрегации считаются в PostgreSQL. Границы периода и бакеты графика
берутся в часовом поясе сессии БД (date_trunc по timestamptz), поэтому
«сегодня» на графике совпадает с «сегодня» в самой базе — сутки не разъезжаются
между приложением и данными.
"""
from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.database.models.order import OrderStatus
from src.app.database.models.page_visit import PageVisit
from src.app.database.session import get_db
from src.app.schemas.analytics import (
    AnalyticsKpi,
    AnalyticsOut,
    AnalyticsRange,
    CountPair,
    MetricPair,
    SeriesPoint,
    StatusBreakdown,
    TopBrand,
    TopCategory,
    TopPage,
    TopProduct,
    VisitIn,
)

logger = get_logger(__name__)

router = APIRouter(tags=["Analytics"])


# ══════════════════════════════════════════════════════════════════ #
#  Счётчик визитов                                                    #
# ══════════════════════════════════════════════════════════════════ #

# Статусы, которые не считаются продажей: отменённые и возвращённые заказы
# не попадают ни в выручку, ни в количество заказов, ни в топы.
NON_SALE_STATUSES = (OrderStatus.CANCELLED.value, OrderStatus.REFUNDED.value)

# Маркеры ботов в User-Agent — такие визиты не пишем вовсе
BOT_MARKERS = ("bot", "crawler", "spider", "yandex", "google", "bing")

# Служебные разделы: админка, PWA заказов, вход и сам API в статистику витрины
# не входят
IGNORED_PATH_PREFIXES = ("/admin", "/app", "/login", "/api")

# Лимиты колонок page_visits — обрезаем до записи, чтобы не ловить ошибку БД
MAX_PATH_LEN = 500
MAX_REFERRER_LEN = 500
MAX_UA_LEN = 300
MAX_ID_LEN = 64

# Простейший анти-флуд: не больше N событий в минуту с одного посетителя.
# Живёт в памяти процесса (без Redis) — это защита от случайного цикла на
# фронте, а не от целенаправленной атаки; при нескольких воркерах лимит
# применяется в каждом воркере отдельно.
RATE_LIMIT_PER_MINUTE = 120
_RATE_BUCKETS: dict[str, tuple[int, int]] = {}
_RATE_BUCKETS_MAX = 10_000


def _rate_limited(key: str) -> bool:
    """True — событие пришло сверх лимита и его надо тихо отбросить."""
    minute = int(time.time() // 60)

    # Словарь не должен расти бесконечно: сначала выкидываем ключи прошлых
    # минут, а если их не осталось (аномальный наплыв) — сбрасываем целиком.
    # Лимит здесь вспомогательный, поэтому сброс безопаснее утечки памяти.
    if len(_RATE_BUCKETS) > _RATE_BUCKETS_MAX:
        for stale_key, (stale_minute, _) in list(_RATE_BUCKETS.items()):
            if stale_minute != minute:
                _RATE_BUCKETS.pop(stale_key, None)
        if len(_RATE_BUCKETS) > _RATE_BUCKETS_MAX:
            _RATE_BUCKETS.clear()

    stored_minute, count = _RATE_BUCKETS.get(key, (minute, 0))

    if stored_minute != minute:
        _RATE_BUCKETS[key] = (minute, 1)  # новая минута — счётчик обнуляется
        return False

    if count >= RATE_LIMIT_PER_MINUTE:
        return True

    _RATE_BUCKETS[key] = (minute, count + 1)
    return False


def _clip(value: str | None, limit: int) -> str | None:
    """Обрезает строку под лимит колонки; пустую строку превращает в None."""
    if value is None:
        return None
    value = value.strip()[:limit]
    return value or None


@router.post(
    "/track/visit",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Зафиксировать просмотр страницы (публично)",
    description=(
        "Публичная ручка счётчика посещаемости. Всегда отвечает 204 — "
        "любая внутренняя ошибка не должна ломать витрину."
    ),
)
async def track_visit(
    body: VisitIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> None:
    path = _clip(body.path, MAX_PATH_LEN)
    if not path:
        return None

    # Служебные разделы не считаем
    lowered = path.lower()
    if any(lowered.startswith(prefix) for prefix in IGNORED_PATH_PREFIXES):
        return None

    user_agent = request.headers.get("user-agent", "")
    if any(marker in user_agent.lower() for marker in BOT_MARKERS):
        return None

    visitor_id = _clip(body.visitor_id, MAX_ID_LEN)
    session_id = _clip(body.session_id, MAX_ID_LEN)

    client_host = request.client.host if request.client else "unknown"
    if _rate_limited(visitor_id or client_host):
        return None

    try:
        db.add(
            PageVisit(
                path=path,
                referrer=_clip(body.referrer, MAX_REFERRER_LEN),
                visitor_id=visitor_id,
                session_id=session_id,
                user_agent=_clip(user_agent, MAX_UA_LEN),
            )
        )
        await db.commit()
    except Exception as exc:  # счётчик не имеет права ронять витрину
        await db.rollback()
        logger.warning("track_visit_failed", path=path, error=str(exc))

    return None


# ══════════════════════════════════════════════════════════════════ #
#  Аналитика для админки                                              #
# ══════════════════════════════════════════════════════════════════ #

# Максимальная длина произвольного периода — чтобы ответ не разрастался
MAX_CUSTOM_DAYS = 366

# Выражение бакета графика. {col} — колонка с датой события.
BUCKET_EXPR = {
    "hour": "to_char(date_trunc('hour', {col}), 'YYYY-MM-DD\"T\"HH24:00')",
    "day": "to_char(date_trunc('day', {col}), 'YYYY-MM-DD')",
}


def _resolve_ranges(
    period: str,
    date_from: date | None,
    date_to: date | None,
    today: date,
) -> tuple[date, date, date, date, str]:
    """Считает границы текущего и предыдущего периодов + гранулярность графика.

    Предыдущий период — той же длины и идёт встык перед текущим.
    """
    if period == "custom":
        if date_from is None or date_to is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Для period=custom обязательны параметры from и to",
            )
        if date_from > date_to:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Дата начала периода не может быть больше даты конца",
            )
        if (date_to - date_from).days + 1 > MAX_CUSTOM_DAYS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Период не может быть длиннее {MAX_CUSTOM_DAYS} дней",
            )
        current_from, current_to = date_from, date_to
    elif period == "day":
        current_from = current_to = today
    elif period == "week":
        current_to = today
        current_from = today - timedelta(days=6)
    else:  # month
        current_to = today
        current_from = today - timedelta(days=29)

    days = (current_to - current_from).days + 1
    previous_to = current_from - timedelta(days=1)
    previous_from = previous_to - timedelta(days=days - 1)
    granularity = "hour" if days == 1 else "day"
    return current_from, current_to, previous_from, previous_to, granularity


def _bucket_keys(period_from: date, period_to: date, granularity: str) -> list[str]:
    """Полный список бакетов периода — чтобы график не рвался на пустых днях."""
    if granularity == "hour":
        return [f"{period_from.isoformat()}T{hour:02d}:00" for hour in range(24)]

    keys: list[str] = []
    cursor = period_from
    while cursor <= period_to:
        keys.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return keys


def _money(value: Any) -> float:
    return round(float(value or 0), 2)


def _ratio(numerator: float, denominator: float) -> float:
    """Деление с защитой от нуля (средний чек, конверсия)."""
    if not denominator:
        return 0.0
    return round(numerator / denominator, 2)


@router.get(
    "/admin/analytics",
    response_model=AnalyticsOut,
    summary="Сводная аналитика магазина",
    dependencies=[Depends(get_current_admin)],
    responses={422: {"description": "Некорректные параметры периода"}},
)
async def get_analytics(
    period: Literal["day", "week", "month", "custom"] = Query(
        "month", description="day — сегодня, week — 7 дней, month — 30 дней"
    ),
    date_from: date | None = Query(None, alias="from", description="Начало для period=custom"),
    date_to: date | None = Query(None, alias="to", description="Конец для period=custom"),
    order_status: OrderStatus | None = Query(
        None,
        alias="status",
        description=(
            "Считать только заказы этого статуса. Без него из выручки "
            "исключаются отменённые и возвращённые."
        ),
    ),
    db: AsyncSession = Depends(get_db),
) -> AnalyticsOut:
    # «Сегодня» берём из БД: так период и бакеты живут в одном часовом поясе
    today: date = (await db.execute(text("SELECT current_date"))).scalar_one()

    current_from, current_to, previous_from, previous_to, granularity = _resolve_ranges(
        period, date_from, date_to, today
    )
    days = (current_to - current_from).days + 1

    # Текущий и предыдущий периоды идут встык, поэтому ряды берём одним
    # запросом на объединённый интервал и разносим по бакетам уже в Python
    # Даты передаём объектами date: asyncpg выводит тип параметра из CAST(... AS date)
    # и строку в этом месте не принимает
    params: dict[str, Any] = {
        "span_from": previous_from,
        "span_to_excl": current_to + timedelta(days=1),
        "current_from": current_from,
        "current_to_excl": current_to + timedelta(days=1),
    }

    if order_status is not None:
        # Явный фильтр: считаем ровно этот статус, правило исключения не применяем
        status_cond = "o.status = :order_status"
        # Разрез по статусам при этом сжимается до одной строки
        by_status_cond = "AND o.status = :order_status"
        params["order_status"] = order_status.value
    else:
        status_cond = "o.status NOT IN ('cancelled', 'refunded')"
        # Разрез по статусам показывает ВСЕ заказы периода, включая отменённые
        by_status_cond = ""

    orders_bucket = BUCKET_EXPR[granularity].format(col="o.created_at")
    visits_bucket = BUCKET_EXPR[granularity].format(col="v.created_at")

    span_where = (
        "o.created_at >= CAST(:span_from AS date) "
        "AND o.created_at < CAST(:span_to_excl AS date)"
    )
    current_where = (
        "o.created_at >= CAST(:current_from AS date) "
        "AND o.created_at < CAST(:current_to_excl AS date)"
    )

    # ── Заказы и выручка по бакетам ──────────────────────────────── #
    orders_rows = (
        await db.execute(
            text(
                f"""
                SELECT {orders_bucket} AS bucket,
                       COALESCE(SUM(o.total_amount), 0) AS revenue,
                       COUNT(*) AS orders
                FROM orders o
                WHERE {span_where} AND {status_cond}
                GROUP BY 1
                """
            ),
            params,
        )
    ).all()
    orders_by_bucket = {row.bucket: (_money(row.revenue), int(row.orders)) for row in orders_rows}

    # ── Проданные штуки по бакетам ───────────────────────────────── #
    items_rows = (
        await db.execute(
            text(
                f"""
                SELECT {orders_bucket} AS bucket,
                       COALESCE(SUM(oi.quantity), 0) AS qty
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                WHERE {span_where} AND {status_cond}
                GROUP BY 1
                """
            ),
            params,
        )
    ).all()
    items_by_bucket = {row.bucket: int(row.qty) for row in items_rows}

    # ── Визиты по бакетам ────────────────────────────────────────── #
    # Визит = уникальный session_id. Если сессии нет (старый браузер,
    # выключенный sessionStorage) — считаем строку отдельным визитом.
    visits_rows = (
        await db.execute(
            text(
                f"""
                SELECT {visits_bucket} AS bucket,
                       COUNT(DISTINCT COALESCE(NULLIF(v.session_id, ''), CAST(v.id AS text)))
                           AS visits
                FROM page_visits v
                WHERE v.created_at >= CAST(:span_from AS date)
                  AND v.created_at < CAST(:span_to_excl AS date)
                GROUP BY 1
                """
            ),
            params,
        )
    ).all()
    visits_by_bucket = {row.bucket: int(row.visits) for row in visits_rows}

    def build_series(period_from: date, period_to: date) -> list[SeriesPoint]:
        return [
            SeriesPoint(
                bucket=key,
                revenue=orders_by_bucket.get(key, (0.0, 0))[0],
                orders=orders_by_bucket.get(key, (0.0, 0))[1],
                visits=visits_by_bucket.get(key, 0),
            )
            for key in _bucket_keys(period_from, period_to, granularity)
        ]

    series = build_series(current_from, current_to)
    previous_series = build_series(previous_from, previous_to)

    def totals(period_from: date, period_to: date) -> tuple[float, int, int, int]:
        keys = _bucket_keys(period_from, period_to, granularity)
        revenue = round(sum(orders_by_bucket.get(k, (0.0, 0))[0] for k in keys), 2)
        orders_count = sum(orders_by_bucket.get(k, (0.0, 0))[1] for k in keys)
        items = sum(items_by_bucket.get(k, 0) for k in keys)
        visits = sum(visits_by_bucket.get(k, 0) for k in keys)
        return revenue, orders_count, items, visits

    cur_revenue, cur_orders, cur_items, cur_visits = totals(current_from, current_to)
    prev_revenue, prev_orders, prev_items, prev_visits = totals(previous_from, previous_to)

    # ── Разрез по статусам (все статусы, если фильтр не задан) ────── #
    status_rows = (
        await db.execute(
            text(
                f"""
                SELECT o.status AS status,
                       COUNT(*) AS orders,
                       COALESCE(SUM(o.total_amount), 0) AS revenue
                FROM orders o
                WHERE {current_where} {by_status_cond}
                GROUP BY o.status
                ORDER BY orders DESC, revenue DESC
                """
            ),
            params,
        )
    ).all()

    # ── Топ товаров ──────────────────────────────────────────────── #
    # Удалённый товар (product_id = NULL) группируется по снэпшоту имени
    top_product_rows = (
        await db.execute(
            text(
                f"""
                SELECT oi.product_id AS product_id,
                       COALESCE(p.name, oi.product_name) AS name,
                       COALESCE(SUM(oi.quantity), 0) AS qty,
                       COALESCE(SUM(oi.total_price), 0) AS revenue
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                LEFT JOIN products p ON p.id = oi.product_id
                WHERE {current_where} AND {status_cond}
                GROUP BY oi.product_id, COALESCE(p.name, oi.product_name)
                ORDER BY revenue DESC, qty DESC
                LIMIT 10
                """
            ),
            params,
        )
    ).all()

    # ── Топ брендов ──────────────────────────────────────────────── #
    top_brand_rows = (
        await db.execute(
            text(
                f"""
                SELECT p.brand AS brand,
                       COALESCE(SUM(oi.quantity), 0) AS qty,
                       COALESCE(SUM(oi.total_price), 0) AS revenue
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN products p ON p.id = oi.product_id
                WHERE {current_where} AND {status_cond}
                  AND p.brand IS NOT NULL AND p.brand <> ''
                GROUP BY p.brand
                ORDER BY revenue DESC, qty DESC
                LIMIT 8
                """
            ),
            params,
        )
    ).all()

    # ── Топ категорий ────────────────────────────────────────────── #
    top_category_rows = (
        await db.execute(
            text(
                f"""
                SELECT p.category_id AS category_id,
                       c.name AS name,
                       COALESCE(SUM(oi.quantity), 0) AS qty,
                       COALESCE(SUM(oi.total_price), 0) AS revenue
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN products p ON p.id = oi.product_id
                JOIN categories c ON c.id = p.category_id
                WHERE {current_where} AND {status_cond}
                GROUP BY p.category_id, c.name
                ORDER BY revenue DESC, qty DESC
                LIMIT 8
                """
            ),
            params,
        )
    ).all()

    # ── Топ страниц ──────────────────────────────────────────────── #
    top_page_rows = (
        await db.execute(
            text(
                """
                SELECT v.path AS path, COUNT(*) AS visits
                FROM page_visits v
                WHERE v.created_at >= CAST(:current_from AS date)
                  AND v.created_at < CAST(:current_to_excl AS date)
                GROUP BY v.path
                ORDER BY visits DESC
                LIMIT 8
                """
            ),
            params,
        )
    ).all()

    logger.info(
        "analytics_computed",
        period=period,
        range_from=current_from.isoformat(),
        range_to=current_to.isoformat(),
        orders=cur_orders,
        revenue=cur_revenue,
        status=order_status.value if order_status else None,
    )

    return AnalyticsOut(
        range=AnalyticsRange(
            from_=current_from.isoformat(), to=current_to.isoformat(), days=days
        ),
        previous_range=AnalyticsRange(
            from_=previous_from.isoformat(), to=previous_to.isoformat(), days=days
        ),
        kpi=AnalyticsKpi(
            revenue=MetricPair(current=cur_revenue, previous=prev_revenue),
            orders=CountPair(current=cur_orders, previous=prev_orders),
            avg_check=MetricPair(
                current=_ratio(cur_revenue, cur_orders),
                previous=_ratio(prev_revenue, prev_orders),
            ),
            items_sold=CountPair(current=cur_items, previous=prev_items),
            visits=CountPair(current=cur_visits, previous=prev_visits),
            conversion=MetricPair(
                current=_ratio(cur_orders * 100, cur_visits),
                previous=_ratio(prev_orders * 100, prev_visits),
            ),
        ),
        series=series,
        previous_series=previous_series,
        by_status=[
            StatusBreakdown(
                status=row.status, orders=int(row.orders), revenue=_money(row.revenue)
            )
            for row in status_rows
        ],
        top_products=[
            TopProduct(
                product_id=row.product_id,
                name=row.name,
                qty=int(row.qty),
                revenue=_money(row.revenue),
            )
            for row in top_product_rows
        ],
        top_brands=[
            TopBrand(brand=row.brand, qty=int(row.qty), revenue=_money(row.revenue))
            for row in top_brand_rows
        ],
        top_categories=[
            TopCategory(
                category_id=row.category_id,
                name=row.name,
                qty=int(row.qty),
                revenue=_money(row.revenue),
            )
            for row in top_category_rows
        ],
        top_pages=[
            TopPage(path=row.path, visits=int(row.visits)) for row in top_page_rows
        ],
    )
