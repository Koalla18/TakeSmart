from __future__ import annotations

import uuid
from decimal import Decimal
from uuid import UUID


from fastapi import Depends
from src.app.api.admin.endpoints import get_current_admin
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

from src.app.core.logger import get_logger
from src.app.core.telegram_service import send_order_notification
from src.app.database.models.order import OrderStatus, PaymentStatus
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.common import PaginatedResponse
from src.app.schemas.order import (
    OrderAdminNoteUpdate,
    OrderCreate,
    OrderDetailOut,
    OrderOut,
    OrderPaymentStatusUpdate,
    OrderStatusUpdate,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/orders", tags=["Orders"])


def _generate_order_number() -> str:
    """Генерирует уникальный номер заказа вида TM-XXXXXXXX."""
    return f"TM-{uuid.uuid4().hex[:8].upper()}"


@router.get(
    "",
    response_model=PaginatedResponse[OrderOut],
    summary="Список всех заказов",
    dependencies=[Depends(get_current_admin)]
)
async def list_orders(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status: OrderStatus | None = Query(None, description="Фильтр по статусу заказа"),
    payment_status: PaymentStatus | None = Query(None, description="Фильтр по статусу оплаты"),
    customer_email: str | None = Query(None, description="Фильтр по email покупателя"),
) -> PaginatedResponse[OrderOut]:
    async with UnitOfWork() as uow:
        if customer_email:
            items = await uow.orders.get_by_customer_email(
                customer_email, offset=offset, limit=limit
            )
            total = len(items)
        elif status:
            items = await uow.orders.get_by_status(status, offset=offset, limit=limit)
            total = len(items)
        elif payment_status:
            items = await uow.orders.get_by_payment_status(
                payment_status, offset=offset, limit=limit
            )
            total = len(items)
        else:
            items = await uow.orders.get_all(offset=offset, limit=limit)
            total = await uow.orders.count()

    logger.info("orders_listed", count=len(items), offset=offset, limit=limit)
    return PaginatedResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_next=(offset + limit) < total,
    )


@router.get(
    "/{order_id}",
    response_model=OrderDetailOut,
    summary="Получить заказ по ID",
    responses={404: {"description": "Заказ не найден"}},
    dependencies=[Depends(get_current_admin)]
)
async def get_order(
order_id: UUID) -> OrderDetailOut:
    async with UnitOfWork() as uow:
        order = await uow.orders.get_with_items(order_id)

    if not order:
        logger.warning("order_not_found", order_id=str(order_id))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Заказ с id={order_id} не найден",
        )
    return order


@router.get(
    "/number/{order_number}",
    response_model=OrderDetailOut,
    summary="Получить заказ по номеру",
    responses={404: {"description": "Заказ не найден"}},
)
async def get_order_by_number(order_number: str) -> OrderDetailOut:
    async with UnitOfWork() as uow:
        order = await uow.orders.get_by_order_number(order_number)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Заказ с номером '{order_number}' не найден",
            )
        order = await uow.orders.get_with_items(order.id)

    return order


@router.post(
    "",
    response_model=OrderDetailOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать заказ",
    responses={
        404: {"description": "Один из товаров не найден"},
        409: {"description": "Недостаточно товара на складе"},
        422: {"description": "Ошибка валидации"},
    },
)
async def create_order(body: OrderCreate) -> OrderDetailOut:
    async with UnitOfWork() as uow:
        # ── 1. Валидируем все товары и считаем суммы ──────────────────
        order_lines = []
        subtotal = Decimal("0.00")

        for item_in in body.items:
            product = await uow.products.get_by_id(item_in.product_id)

            if not product:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Товар с id={item_in.product_id} не найден",
                )
            if not product.is_active:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Товар '{product.name}' недоступен для заказа",
                )
            if product.stock_quantity < item_in.quantity:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Недостаточно товара '{product.name}' на складе. "
                        f"Доступно: {product.stock_quantity}, запрошено: {item_in.quantity}"
                    ),
                )

            unit_price = product.discount_price or product.price
            line_total = unit_price * item_in.quantity
            subtotal += line_total

            order_lines.append({
                "product": product,
                "quantity": item_in.quantity,
                "unit_price": unit_price,
                "total_price": line_total,
            })

        total_amount = subtotal  # shipping_cost и discount в будущем

        # ── 2. Создаём заказ ──────────────────────────────────────────
        order = await uow.orders.create(
            order_number=_generate_order_number(),
            customer_name=body.customer_name,
            customer_email=body.customer_email,
            customer_phone=body.customer_phone,
            shipping_address=body.shipping_address,
            shipping_city=body.shipping_city,
            shipping_postal_code=body.shipping_postal_code,
            customer_note=body.customer_note,
            subtotal=subtotal,
            discount_amount=Decimal("0.00"),
            shipping_cost=Decimal("0.00"),
            total_amount=total_amount,
        )

        # ── 3. Создаём позиции и списываем остатки ────────────────────
        for line in order_lines:
            product = line["product"]
            await uow.order_items.create(
                order_id=order.id,
                product_id=product.id,
                product_name=product.name,
                product_sku=product.sku,
                quantity=line["quantity"],
                unit_price=line["unit_price"],
                total_price=line["total_price"],
            )
            await uow.products.decrement_stock(product.id, line["quantity"])

        await uow.commit()

        # Перечитываем с позициями
        order = await uow.orders.get_with_items(order.id)

    logger.info(
        "order_created",
        order_id=str(order.id),
        order_number=order.order_number,
        total=str(order.total_amount),
        items=len(order.items),
    )

    # Уведомление в Telegram (не блокирует ответ — ошибки перехватываются внутри)
    await send_order_notification(order)

    return order


@router.patch(
    "/{order_id}/status",
    response_model=OrderOut,
    summary="Изменить статус заказа",
    responses={
        404: {"description": "Заказ не найден"},
        409: {"description": "Недопустимый переход статуса"},
    },
    dependencies=[Depends(get_current_admin)]
)
async def update_order_status(
order_id: UUID, body: OrderStatusUpdate) -> OrderOut:
    async with UnitOfWork() as uow:
        order = await uow.orders.get_by_id(order_id)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Заказ с id={order_id} не найден",
            )

        current = OrderStatus(order.status)
        updated = await uow.orders.update_status(order_id, body.status)
        await uow.commit()

    logger.info(
        "order_status_updated",
        order_id=str(order_id),
        old_status=current.value,
        new_status=body.status.value,
    )
    return updated


@router.patch(
    "/{order_id}/payment-status",
    response_model=OrderOut,
    summary="Изменить статус оплаты",
    responses={404: {"description": "Заказ не найден"}},
    dependencies=[Depends(get_current_admin)]
)
async def update_payment_status(
    order_id: UUID, body: OrderPaymentStatusUpdate
) -> OrderOut:
    async with UnitOfWork() as uow:
        order = await uow.orders.get_by_id(order_id)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Заказ с id={order_id} не найден",
            )

        updated = await uow.orders.update_payment_status(order_id, body.payment_status)
        await uow.commit()

    logger.info(
        "order_payment_status_updated",
        order_id=str(order_id),
        payment_status=body.payment_status.value,
    )
    return updated


@router.patch(
    "/{order_id}/admin-note",
    response_model=OrderOut,
    summary="Добавить/обновить заметку администратора",
    responses={404: {"description": "Заказ не найден"}},
    dependencies=[Depends(get_current_admin)]
)
async def update_admin_note(
order_id: UUID, body: OrderAdminNoteUpdate) -> OrderOut:
    async with UnitOfWork() as uow:
        order = await uow.orders.get_by_id(order_id)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Заказ с id={order_id} не найден",
            )
        updated = await uow.orders.update(order_id, admin_note=body.admin_note)
        await uow.commit()

    logger.info("order_admin_note_updated", order_id=str(order_id))
    return updated


@router.delete(
    "/{order_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Удалить заказ",
    responses={
        404: {"description": "Заказ не найден"},
        409: {"description": "Нельзя удалить — заказ уже обрабатывается"},
    },
    dependencies=[Depends(get_current_admin)]
)
async def delete_order(
order_id: UUID) -> None:
    async with UnitOfWork() as uow:
        order = await uow.orders.get_by_id(order_id)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Заказ с id={order_id} не найден",
            )

        # Нельзя удалять заказы в активных статусах
        non_deletable = {
            OrderStatus.PROCESSING.value,
            OrderStatus.SHIPPED.value,
            OrderStatus.DELIVERED.value,
        }
        if order.status in non_deletable:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Нельзя удалить заказ в статусе '{order.status}'. "
                    "Сначала отмените или возвратите заказ."
                ),
            )

        await uow.orders.delete(order_id)
        await uow.commit()

    logger.info("order_deleted", order_id=str(order_id))

