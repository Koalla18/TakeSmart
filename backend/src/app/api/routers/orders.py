from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID


from fastapi import Depends
from src.app.api.admin.endpoints import get_current_admin
from src.app.api.routers.gta6 import GIFT_NAME, gift_product_ids
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select

from src.app.core.logger import get_logger
from src.app.core.push_service import send_order_push
from src.app.database.models.admin import Admin
from src.app.database.models.order import Order, OrderStatus, PaymentStatus
from src.app.database.models.product import Product
from src.app.database.models.product_variant import ProductVariant
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.common import PaginatedResponse
from src.app.schemas.order import (
    OrderAdminNoteUpdate,
    OrderCommentCreate,
    OrderCommentOut,
    OrderCommentUpdate,
    OrderCreate,
    OrderDetailOut,
    OrderOut,
    OrderPaymentStatusUpdate,
    OrderStatusUpdate,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/orders", tags=["Orders"])
CARD_MARKUP_PERCENT = 16
DELIVERY_PRICES = {"pickup": 0, "courier": 1000, "post": 800}
_LEGACY_PAYMENT = {"Наличными": "cash", "Картой": "card", "QR-код в магазине": "qr"}
_LEGACY_DELIVERY = {"Самовывоз": "pickup", "Курьер": "courier", "Почта": "post"}
_LEGACY_CART_NOTE = re.compile(
    r"^Оплата: (Наличными|Картой|QR-код в магазине)(?: — к оплате [^|]+)?"
    r" \| Доставка: (Самовывоз|Курьер|Почта)(?: \||$)"
)


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
        items, total = await uow.orders.page(offset=offset, limit=limit, status=status,
            payment_status=payment_status, customer_email=customer_email)

    logger.info("orders_listed", count=len(items), offset=offset, limit=limit)
    return PaginatedResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_next=(offset + limit) < total,
    )


@router.get("/checkout-options")
async def checkout_options() -> dict:
    return {"card_markup_percent": CARD_MARKUP_PERCENT, "delivery_prices": DELIVERY_PRICES}


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
    dependencies=[Depends(get_current_admin)],
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


@router.post("/checkout", response_model=OrderDetailOut, status_code=status.HTTP_201_CREATED,
             summary="Оформить заказ с проверкой суммы и выбранных вариантов")
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
async def create_order(body: OrderCreate, background_tasks: BackgroundTasks) -> OrderDetailOut:
    async with UnitOfWork() as uow:
        # ── 1. Валидируем все товары и считаем суммы ──────────────────
        order_lines = []
        subtotal = Decimal("0.00")

        session = uow.products.session
        product_ids = {item.product_id for item in body.items}
        variant_ids = {item.variant_id for item in body.items if item.variant_id is not None}
        products = {product.id: product for product in await session.scalars(select(Product)
                    .where(Product.id.in_(product_ids)).order_by(Product.id).with_for_update(of=Product))}
        variants = {variant.id: variant for variant in await session.scalars(select(ProductVariant)
                    .where(ProductVariant.id.in_(variant_ids)).order_by(ProductVariant.id).with_for_update(of=ProductVariant))}
        for item_in in body.items:
            product = products.get(item_in.product_id)

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
            variant = variants.get(item_in.variant_id) if item_in.variant_id else None
            if item_in.variant_id and (variant is None or variant.product_id != product.id or not variant.is_active):
                raise HTTPException(status_code=409, detail=f"Выбранный вариант товара «{product.name}» больше недоступен")
            stock_item = variant or product
            if not product.is_preorder and stock_item.stock_quantity < item_in.quantity:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Недостаточно товара '{product.name}' на складе. "
                        f"Доступно: {stock_item.stock_quantity}, запрошено: {item_in.quantity}"
                    ),
                )

            unit_price = product.discount_price or product.price
            line_total = unit_price * item_in.quantity
            subtotal += line_total

            order_lines.append({
                "product": product,
                "variant": variant,
                "quantity": item_in.quantity,
                "unit_price": unit_price,
                "total_price": line_total,
            })

        payment_method, delivery_method = body.payment_method, body.delivery_method
        legacy_checkout = (payment_method is None and delivery_method is None and body.expected_total is None
                           and _LEGACY_CART_NOTE.match(body.customer_note or ""))
        if legacy_checkout:
            payment_method = _LEGACY_PAYMENT[legacy_checkout[1]]
            delivery_method = _LEGACY_DELIVERY[legacy_checkout[2]]
        shipping_cost = Decimal(DELIVERY_PRICES.get(delivery_method, 0))
        payment_surcharge = Decimal("0")
        if payment_method in ("card", "qr"):
            if legacy_checkout:
                # Открытая до обновления корзина показывает старую формулу надбавки.
                payment_surcharge = (subtotal / Decimal("0.85")).quantize(Decimal("1"), rounding=ROUND_HALF_UP) - subtotal
            else:
                payment_surcharge = (subtotal * CARD_MARKUP_PERCENT / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        total_amount = subtotal + shipping_cost + payment_surcharge
        if body.expected_total is not None and body.expected_total != total_amount:
            formatted = format(total_amount, ",.2f").replace(",", " ").replace(".", ",").removesuffix(",00")
            raise HTTPException(status_code=409, detail=f"Сумма заказа изменилась на {formatted} ₽. Обновите корзину и проверьте цены.")
        has_preorder = any(line["product"].is_preorder for line in order_lines)
        # Подарок (GTA VI к консолям со страницы /gta6): к каким позициям он положен
        gift_ids = await gift_product_ids(uow)
        has_gift = any(line["product"].id in gift_ids for line in order_lines)

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
            shipping_cost=shipping_cost,
            delivery_method=delivery_method,
            payment_method=payment_method,
            payment_surcharge=payment_surcharge,
            total_amount=total_amount,
            is_preorder=has_preorder,
            gift=GIFT_NAME if has_gift else None,
        )

        # ── 3. Создаём позиции и списываем остатки ────────────────────
        for line in order_lines:
            product = line["product"]
            variant = line["variant"]
            name = f"{product.name} — {variant.name}"[:255] if variant else product.name
            await uow.order_items.create(
                order_id=order.id,
                product_id=product.id,
                variant_id=variant.id if variant else None,
                product_name=name,
                product_sku=(variant.sku or product.sku) if variant else product.sku,
                quantity=line["quantity"],
                unit_price=line["unit_price"],
                total_price=line["total_price"],
                gift=GIFT_NAME if product.id in gift_ids else None,
            )
            if not product.is_preorder:
                stock_item = variant or product
                stock_item.stock_quantity -= line["quantity"]

        await uow.commit()

        # Перечитываем с позициями
        order = await uow.orders.get_with_items(order.id)

    logger.info(
        "order_created",
        order_id=str(order.id),
        order_number=order.order_number,
        total=str(order.total_amount),
        items=len(order.items),
        preorder=order.is_preorder,
        gift=order.gift,
    )

    # Telegram отключён по просьбе владельца — уведомления о новых заказах идут
    # через Web Push (PWA «Заказы»). telegram_service.py оставлен на случай возврата.
    background_tasks.add_task(send_order_push, order)

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
    summary="Добавить/обновить заметку администратора (устарело: используйте комментарии)",
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


# ------------------------------------------------------------------ #
#  Комментарии сотрудников                                            #
# ------------------------------------------------------------------ #

# Сколько комментариев держим у одного заказа: лента остаётся читаемой, а список
# заказов (он приходит вместе с комментариями) — лёгким.
MAX_COMMENTS_PER_ORDER = 300


async def _order_or_404(uow: UnitOfWork, order_id: UUID) -> Order:
    order = await uow.orders.get_by_id(order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Заказ с id={order_id} не найден",
        )
    return order


@router.get(
    "/{order_id}/comments",
    response_model=list[OrderCommentOut],
    summary="Комментарии сотрудников к заказу",
    responses={404: {"description": "Заказ не найден"}},
    dependencies=[Depends(get_current_admin)],
)
async def list_order_comments(order_id: UUID) -> list[OrderCommentOut]:
    async with UnitOfWork() as uow:
        await _order_or_404(uow, order_id)
        comments = await uow.order_comments.list_for_order(order_id)
    return list(comments)


@router.post(
    "/{order_id}/comments",
    response_model=OrderCommentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Оставить комментарий к заказу",
    responses={
        404: {"description": "Заказ не найден"},
        409: {"description": "У заказа слишком много комментариев"},
    },
)
async def add_order_comment(
    order_id: UUID,
    body: OrderCommentCreate,
    admin: Admin = Depends(get_current_admin),
) -> OrderCommentOut:
    async with UnitOfWork() as uow:
        order = await _order_or_404(uow, order_id)
        if len(order.comments) >= MAX_COMMENTS_PER_ORDER:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"У заказа уже {MAX_COMMENTS_PER_ORDER} комментариев — "
                    "удалите лишние, чтобы добавить новый"
                ),
            )
        comment = await uow.order_comments.create(
            order_id=order_id,
            author_name=body.author_name,
            admin_username=admin.username,
            body=body.body,
        )
        await uow.commit()

    logger.info(
        "order_comment_added",
        order_id=str(order_id),
        comment_id=str(comment.id),
        author=comment.author_name,
    )
    return comment


@router.patch(
    "/{order_id}/comments/{comment_id}",
    response_model=OrderCommentOut,
    summary="Изменить текст комментария",
    responses={404: {"description": "Комментарий не найден"}},
)
async def edit_order_comment(
    order_id: UUID,
    comment_id: UUID,
    body: OrderCommentUpdate,
    admin: Admin = Depends(get_current_admin),
) -> OrderCommentOut:
    async with UnitOfWork() as uow:
        comment = await uow.order_comments.get_for_order(order_id, comment_id)
        if not comment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Комментарий не найден — возможно, его уже удалили",
            )
        # Тот же текст — не помечаем комментарий изменённым
        if comment.body != body.body:
            comment.body = body.body
            comment.edited_at = datetime.now(timezone.utc)
            await uow.commit()
            logger.info(
                "order_comment_edited",
                order_id=str(order_id),
                comment_id=str(comment_id),
                by=admin.username,
            )
    return comment


@router.delete(
    "/{order_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Удалить комментарий",
    responses={404: {"description": "Комментарий не найден"}},
)
async def delete_order_comment(
    order_id: UUID,
    comment_id: UUID,
    admin: Admin = Depends(get_current_admin),
) -> None:
    async with UnitOfWork() as uow:
        comment = await uow.order_comments.get_for_order(order_id, comment_id)
        if not comment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Комментарий не найден — возможно, его уже удалили",
            )
        await uow.order_comments.delete(comment_id)
        await uow.commit()

    logger.info(
        "order_comment_deleted",
        order_id=str(order_id),
        comment_id=str(comment_id),
        by=admin.username,
    )


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

