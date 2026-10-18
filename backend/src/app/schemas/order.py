from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator, EmailStr

from src.app.database.models.order import OrderStatus, PaymentStatus


# ------------------------------------------------------------------ #
#  OrderItem schemas                                                   #
# ------------------------------------------------------------------ #

class OrderItemCreate(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(..., ge=1, le=999, description="Количество единиц товара")


class OrderItemOut(BaseModel):
    id: uuid.UUID
    product_id: Optional[uuid.UUID]
    product_name: str
    product_sku: Optional[str]
    quantity: int
    unit_price: Decimal
    total_price: Decimal

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------ #
#  Order schemas                                                       #
# ------------------------------------------------------------------ #

class OrderCreate(BaseModel):
    customer_name: str = Field(..., min_length=2, max_length=150, examples=["Иван Иванов"])
    customer_email: EmailStr = Field(..., examples=["ivan@example.com"])
    customer_phone: Optional[str] = Field(
        None,
        pattern=r"^\+?[1-9]\d{6,14}$",
        examples=["+79991234567"],
        description="Номер телефона в международном формате",
    )
    shipping_address: str = Field(..., min_length=5, max_length=500, examples=["ул. Ленина, д. 1, кв. 10"])
    shipping_city: str = Field(..., min_length=2, max_length=100, examples=["Москва"])
    shipping_postal_code: Optional[str] = Field(None, pattern=r"^\d{5,10}$", examples=["123456"])
    customer_note: Optional[str] = Field(None, max_length=1000)
    items: list[OrderItemCreate] = Field(..., min_length=1, description="Минимум 1 позиция в заказе")

    @field_validator("items")
    @classmethod
    def no_duplicate_products(cls, items: list[OrderItemCreate]) -> list[OrderItemCreate]:
        ids = [i.product_id for i in items]
        if len(ids) != len(set(ids)):
            raise ValueError("В заказе не должно быть дублирующихся товаров — объедините их в одну позицию")
        return items


class OrderStatusUpdate(BaseModel):
    status: OrderStatus = Field(..., description="Новый статус заказа")


class OrderPaymentStatusUpdate(BaseModel):
    payment_status: PaymentStatus = Field(..., description="Новый статус оплаты")


class OrderAdminNoteUpdate(BaseModel):
    admin_note: str = Field(..., max_length=2000)


# ------------------------------------------------------------------ #
#  Комментарии сотрудников к заказу                                   #
# ------------------------------------------------------------------ #

COMMENT_MAX_LENGTH = 2000
COMMENT_PREVIEW_LENGTH = 160


def _clean_comment_body(value: str) -> str:
    # Хвостовые пробелы и пустые строки по краям убираем, переносы внутри оставляем
    lines = [line.rstrip() for line in value.strip().splitlines()]
    text = "\n".join(lines).strip()
    if not text:
        raise ValueError("Комментарий пустой")
    return text


class OrderCommentCreate(BaseModel):
    author_name: str = Field(..., min_length=1, max_length=60, description="Как подписан сотрудник")
    body: str = Field(..., min_length=1, max_length=COMMENT_MAX_LENGTH)

    @field_validator("author_name")
    @classmethod
    def clean_author(cls, value: str) -> str:
        name = " ".join(value.split())
        if not name:
            raise ValueError("Укажите, как вас подписать")
        return name

    @field_validator("body")
    @classmethod
    def clean_body(cls, value: str) -> str:
        return _clean_comment_body(value)


class OrderCommentUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=COMMENT_MAX_LENGTH)

    @field_validator("body")
    @classmethod
    def clean_body(cls, value: str) -> str:
        return _clean_comment_body(value)


class OrderCommentOut(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    author_name: str
    body: str
    created_at: datetime
    edited_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class OrderCommentPreview(BaseModel):
    """Последний комментарий в списке заказов — одной строкой."""
    author_name: str
    body: str
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("body")
    @classmethod
    def one_line(cls, value: str) -> str:
        text = " ".join(value.split())
        if len(text) <= COMMENT_PREVIEW_LENGTH:
            return text
        return text[: COMMENT_PREVIEW_LENGTH - 1].rstrip() + "…"


class OrderOut(BaseModel):
    id: uuid.UUID
    order_number: str
    customer_name: str
    customer_email: str
    customer_phone: Optional[str]
    shipping_address: str
    shipping_city: str
    shipping_postal_code: Optional[str]
    subtotal: Decimal
    discount_amount: Decimal
    shipping_cost: Decimal
    total_amount: Decimal
    status: str
    payment_status: str
    is_preorder: bool = False
    customer_note: Optional[str]
    admin_note: Optional[str]
    comments_count: int = 0
    last_comment: Optional[OrderCommentPreview] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OrderDetailOut(OrderOut):
    """Детальное представление заказа — с позициями и комментариями сотрудников."""
    items: list[OrderItemOut] = []
    comments: list[OrderCommentOut] = []
