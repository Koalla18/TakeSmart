from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session
from ...db.redis import get_redis_client
from ...models import Product
from ...repositories.order import OrderRepository
from ...schemas import OrderCreate, OrderRead, OrderStatusUpdate
from ...schemas.order import DELIVERY_PRICES, FREE_DELIVERY_THRESHOLD, PAYMENT_MARKUP
from ...services.telegram import send_telegram_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["orders"])

# ─── Rate limiting ────────────────────────────────────────────────────────────
RATE_LIMIT_WINDOW = 60   # секунд
RATE_LIMIT_MAX    = 5    # макс запросов с одного IP за WINDOW


async def check_rate_limit(request: Request) -> None:
    """Reject requests if the IP has exceeded the order rate limit."""
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    ip = ip.split(",")[0].strip()
    key = f"order_ratelimit:{ip}"

    try:
        redis = get_redis_client()
        if redis is None:
            return
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
        logger.error("Не удалось проверить rate limit: %s", exc)


@router.post(
    "/orders",
    response_model=OrderRead,
    status_code=201,
    summary="Create order",
    description="""
Create a new order.

**Важно:** цены товаров берутся из базы данных на сервере.
Клиент передаёт только `product_id` и `quantity` — подмена цены невозможна.
Итоговая сумма (`total_amount`) рассчитывается на сервере автоматически.
""",
)
async def create_order(
    order_data: OrderCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(db_session),
    _rl: None = Depends(check_rate_limit),
) -> OrderRead:
    # ── Загружаем цены из БД, строим items ───────────────────────────────────
    items_data: list[dict] = []
    subtotal: int = 0

    for cart_item in order_data.items:
        try:
            product_uuid = uuid.UUID(cart_item.product_id)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Некорректный product_id: {cart_item.product_id}")

        result = await db.execute(
            select(Product).where(
                Product.id == product_uuid,
                Product.is_active.is_(True),
                Product.in_stock.is_(True),
            )
        )
        product = result.scalars().first()

        if not product:
            raise HTTPException(
                status_code=400,
                detail=f"Товар {cart_item.product_id} недоступен для заказа",
            )

        # Цену берём ТОЛЬКО из БД — подмена цены клиентом невозможна
        line_total = product.price * cart_item.quantity
        subtotal += line_total

        items_data.append(
            {
                "product_id": str(product.id),
                "name": product.name,
                "price": product.price,   # ← цена из БД, не от клиента
                "quantity": cart_item.quantity,
                "image": product.image or "",
                "line_total": line_total,
            }
        )

    # ── Считаем итог на сервере: subtotal + доставка + наценка за оплату ─────
    raw_delivery_cost = DELIVERY_PRICES.get(order_data.delivery_method or "pickup", 0)
    # Бесплатная доставка при заказе от FREE_DELIVERY_THRESHOLD (как на фронтенде)
    is_free_delivery = (
        order_data.delivery_method != "pickup"
        and subtotal >= FREE_DELIVERY_THRESHOLD
    )
    delivery_cost = 0 if is_free_delivery else raw_delivery_cost
    payment_markup_rate = PAYMENT_MARKUP.get(order_data.payment_method or "cash", 0.0)
    payment_markup_amount = round(subtotal * payment_markup_rate)
    total_amount = subtotal + delivery_cost + payment_markup_amount

    logger.debug(
        "Order pricing: subtotal=%s delivery=%s (free=%s) payment_markup=%s total=%s",
        subtotal, delivery_cost, is_free_delivery, payment_markup_amount, total_amount,
    )

    order = await OrderRepository.create(
        db,
        {
            "name": order_data.name,
            "phone": order_data.phone,
            "email": order_data.email,
            "comment": order_data.comment,
            "items": items_data,
            "total_amount": total_amount,
            "payment_method": order_data.payment_method,
            "delivery_method": order_data.delivery_method,
            "delivery_address": order_data.delivery_address,
            "status": "new",
        },
    )

    order_dict = {
        "id": str(order.id),
        "name": order.name,
        "phone": order.phone,
        "email": order.email,
        "comment": order.comment,
        "items": items_data,
        "subtotal": subtotal,
        "delivery_cost": delivery_cost,
        "payment_markup": payment_markup_amount,
        "total_amount": order.total_amount,
        "payment_method": order.payment_method,
        "delivery_method": order.delivery_method,
        "delivery_address": order.delivery_address,
        "created_at": order.created_at.strftime("%d.%m.%Y %H:%M"),
    }
    background_tasks.add_task(send_telegram_notification, order_dict)
    logger.info(
        "Order created: %s (subtotal=%s delivery=%s markup=%s total=%s)",
        order.id, subtotal, delivery_cost, payment_markup_amount, order.total_amount,
    )
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
    order_id: uuid.UUID,
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
    order_id: uuid.UUID,
    status_data: OrderStatusUpdate,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    order = await OrderRepository.get_by_id(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    await OrderRepository.update_status(db, order, status_data.status)
    logger.info("Order status updated: %s -> %s", order_id, status_data.status)
    return {"success": True, "status": order.status}


@router.delete(
    "/orders/{order_id}",
    status_code=204,
    summary="Delete order (admin)",
)
async def delete_order(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> Response:
    order = await OrderRepository.get_by_id(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    await OrderRepository.delete(db, order)
    logger.info("Order deleted: %s", order_id)
    return Response(status_code=204)


