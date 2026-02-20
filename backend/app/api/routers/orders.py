from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session
from ...db.redis import get_redis_client
from ...repositories.order import OrderRepository
from ...schemas import OrderCreate, OrderRead, OrderStatusUpdate
from ...services.telegram import send_telegram_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["orders"])

# ─── Rate limiting ────────────────────────────────────────────────────────────
RATE_LIMIT_WINDOW = 60   # секунд
RATE_LIMIT_MAX    = 5    # макс запросов с одного IP за WINDOW


async def check_rate_limit(request: Request) -> None:
    """Reject requests if the IP has exceeded the order rate limit."""
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    # Берём первый IP если их несколько (X-Forwarded-For)
    ip = ip.split(",")[0].strip()
    key = f"order_ratelimit:{ip}"

    try:
        redis = get_redis_client()
        if redis is None:
            return  # Redis не настроен — пропускаем rate limiting
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, RATE_LIMIT_WINDOW)
        if count > RATE_LIMIT_MAX:
            ttl = await redis.ttl(key)
            logger.warning("Rate limit exceeded for IP %s (count=%s)", ip, count)
            raise HTTPException(
                status_code=429,
                detail=f"Слишком много запросов. Подождите {ttl} сек.",
                headers={"Retry-After": str(ttl)},
            )
    except HTTPException:
        raise
    except Exception as exc:
        # Redis недоступен — пропускаем запрос без блокировки
        logger.error("Не удалось проверить rate limit: %s", exc)


@router.post(
    "/orders",
    response_model=OrderRead,
    status_code=201,
    summary="Create order",
    description="Create a new order with full cart data.",
)
async def create_order(
    order_data: OrderCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(db_session),
    _rl: None = Depends(check_rate_limit),
) -> OrderRead:
    items_data = [item.model_dump() for item in order_data.items] if order_data.items else None

    order = await OrderRepository.create(
        db,
        {
            "name": order_data.name,
            "phone": order_data.phone,
            "email": order_data.email,
            "comment": order_data.comment,
            "items": items_data,
            "total_amount": order_data.total_amount,
            "payment_method": order_data.payment_method,
            "delivery_method": order_data.delivery_method,
            "delivery_address": order_data.delivery_address,
            "status": "new",
        },
    )

    order_dict = {
        "id": order.id,
        "name": order.name,
        "phone": order.phone,
        "email": order.email,
        "comment": order.comment,
        "items": items_data,
        "total_amount": order.total_amount,
        "payment_method": order.payment_method,
        "delivery_method": order.delivery_method,
        "delivery_address": order.delivery_address,
        "created_at": order.created_at.strftime("%d.%m.%Y %H:%M"),
    }
    background_tasks.add_task(send_telegram_notification, order_dict)
    logger.info("Order created: %s", order.id)
    return OrderRead.model_validate(order)


@router.get(
    "/orders",
    response_model=list[OrderRead],
    summary="List orders (admin)",
)
async def list_orders(
    status: str | None = Query(None, description="Optional status filter"),
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> list[OrderRead]:
    orders = await OrderRepository.list_all(db, status)
    return [OrderRead.model_validate(order) for order in orders]


@router.get(
    "/orders/{order_id}",
    response_model=OrderRead,
    summary="Get order (admin)",
)
async def get_order(
    order_id: int,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> OrderRead:
    order = await OrderRepository.get_by_id(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return OrderRead.model_validate(order)


@router.patch(
    "/orders/{order_id}/status",
    summary="Update order status (admin)",
)
async def update_order_status(
    order_id: int,
    status_data: OrderStatusUpdate,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    order = await OrderRepository.get_by_id(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    valid_statuses = ["new", "processing", "ready", "completed", "cancelled"]
    if status_data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    await OrderRepository.update_status(db, order, status_data.status)
    logger.info("Order status updated: %s -> %s", order_id, status_data.status)
    return {"success": True, "status": order.status}


@router.delete(
    "/orders/{order_id}",
    status_code=204,
    summary="Delete order (admin)",
)
async def delete_order(
    order_id: int,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> Response:
    order = await OrderRepository.get_by_id(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    await OrderRepository.delete(db, order)
    logger.info("Order deleted: %s", order_id)
    return Response(status_code=204)
