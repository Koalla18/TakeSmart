from datetime import datetime

from pydantic import BaseModel, EmailStr, Field
from pydantic.config import ConfigDict

from app.schemas.catalog import ProductRead


class OrderItemBase(BaseModel):
    product_id: int = Field(..., description="ID товара")
    quantity: int = Field(1, ge=1, description="Количество")


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemRead(OrderItemBase):
    id: int = Field(..., description="ID позиции заказа")
    price_snapshot: float = Field(..., description="Цена на момент заказа")
    product: ProductRead | None = Field(None, description="Товар")

    model_config = ConfigDict(from_attributes=True)


class OrderCreate(BaseModel):
    name: str = Field(..., description="Имя покупателя")
    phone: str = Field(..., description="Телефон")
    email: EmailStr = Field(..., description="Email")
    comment: str | None = Field(None, description="Комментарий")
    items: list[OrderItemCreate] = Field(default_factory=list, description="Позиции заказа")


class OrderRead(BaseModel):
    id: int = Field(..., description="ID заказа")
    name: str = Field(..., description="Имя покупателя")
    phone: str = Field(..., description="Телефон")
    email: EmailStr = Field(..., description="Email")
    comment: str | None = Field(None, description="Комментарий")
    status: str = Field(..., description="Статус")
    total_amount: float = Field(..., description="Сумма заказа")
    created_at: datetime = Field(..., description="Дата создания")
    items: list[OrderItemRead] = Field(default_factory=list, description="Позиции")

    model_config = ConfigDict(from_attributes=True)
