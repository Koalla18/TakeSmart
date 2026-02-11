from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.deps import get_current_user
from app.db.models import Cart, CartItem, Product, User
from app.db.repositories import CartItemRepository, CartRepository
from app.db.session import get_db
from app.schemas.cart import CartItemCreate, CartItemRead, CartItemUpdate, CartRead

router = APIRouter(prefix="/api/cart", tags=["cart"])


def _get_or_create_cart(user: User, db: AsyncSession) -> Cart:
    raise RuntimeError("Use async_get_or_create_cart")


async def async_get_or_create_cart(user: User, db: AsyncSession) -> Cart:
    repo = CartRepository(db)
    cart = await repo.get_active_by_user(user.id)
    if cart:
        return cart
    return await repo.create({"user_id": user.id})


@router.get(
    "",
    response_model=CartRead,
    summary="Получить корзину",
    description="Возвращает активную корзину текущего пользователя.",
)
async def get_cart(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> Cart:
    cart = await async_get_or_create_cart(user, db)
    result = await db.execute(
        select(Cart)
        .options(joinedload(Cart.items).joinedload(CartItem.product))
        .where(Cart.id == cart.id)
    )
    return result.scalars().first()


@router.post(
    "/items",
    response_model=CartItemRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить товар в корзину",
)
async def add_item(
    payload: CartItemCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CartItem:
    cart = await async_get_or_create_cart(user, db)
    product_result = await db.execute(select(Product).where(Product.id == payload.product_id))
    product = product_result.scalars().first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    item_repo = CartItemRepository(db)
    existing = await item_repo.get_by_cart_product(cart.id, payload.product_id)
    if existing:
        existing.quantity += payload.quantity
        db.add(existing)
        await db.commit()
        await db.refresh(existing)
        return existing

    item = await item_repo.create(
        {
            "cart_id": cart.id,
            "product_id": payload.product_id,
            "quantity": payload.quantity,
            "price_snapshot": float(product.price),
        }
    )
    return item


@router.patch(
    "/items/{item_id}",
    response_model=CartItemRead,
    summary="Обновить количество",
)
async def update_item(
    item_id: int,
    payload: CartItemUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CartItem:
    cart = await async_get_or_create_cart(user, db)
    result = await db.execute(
        select(CartItem).where(CartItem.id == item_id, CartItem.cart_id == cart.id)
    )
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart item not found")
    item.quantity = payload.quantity
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete(
    "/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить позицию",
)
async def delete_item(
    item_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    cart = await async_get_or_create_cart(user, db)
    result = await db.execute(
        select(CartItem).where(CartItem.id == item_id, CartItem.cart_id == cart.id)
    )
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart item not found")
    await db.delete(item)
    await db.commit()
    return None


@router.delete(
    "/clear",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Очистить корзину",
)
async def clear_cart(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    cart = await async_get_or_create_cart(user, db)
    await db.execute(delete(CartItem).where(CartItem.cart_id == cart.id))
    await db.commit()
    return None
