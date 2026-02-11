from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.deps import get_current_user
from app.db.models import Order, OrderItem, Product, User
from app.db.session import get_db
from app.schemas.order import OrderCreate, OrderRead

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get(
    "",
    response_model=list[OrderRead],
    summary="Список заказов пользователя",
)
async def list_orders(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[Order]:
    result = await db.execute(
        select(Order)
        .options(joinedload(Order.items).joinedload(OrderItem.product))
        .where(Order.user_id == user.id)
        .order_by(Order.created_at.desc())
    )
    return result.scalars().all()


@router.post(
    "",
    response_model=OrderRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать заказ",
)
async def create_order(
    payload: OrderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Order:
    if not payload.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order items required")

    order = Order(
        user_id=user.id,
        name=payload.name,
        phone=payload.phone,
        email=payload.email,
        comment=payload.comment,
        status="new",
    )

    total = 0.0
    for item in payload.items:
        product_result = await db.execute(select(Product).where(Product.id == item.product_id))
        product = product_result.scalars().first()
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
        price = float(product.price)
        total += price * item.quantity
        order.items.append(
            OrderItem(
                product_id=product.id,
                quantity=item.quantity,
                price_snapshot=price,
            )
        )

    order.total_amount = total
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return order


@router.get(
    "/{order_id}",
    response_model=OrderRead,
    summary="Получить заказ",
)
async def get_order(
    order_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Order:
    result = await db.execute(
        select(Order)
        .options(joinedload(Order.items).joinedload(OrderItem.product))
        .where(Order.id == order_id, Order.user_id == user.id)
    )
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order
