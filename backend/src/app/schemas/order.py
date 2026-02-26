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
    customer_note: Optional[str]
    admin_note: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OrderDetailOut(OrderOut):
    """Детальное представление заказа — с позициями."""
    items: list[OrderItemOut] = []
