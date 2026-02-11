from datetime import datetime

from pydantic import BaseModel, Field
from pydantic.config import ConfigDict

from app.schemas.catalog import ProductRead


class CartItemBase(BaseModel):
    product_id: int = Field(..., description="ID товара")
    quantity: int = Field(1, ge=1, description="Количество")


class CartItemCreate(CartItemBase):
    pass


class CartItemUpdate(BaseModel):
    quantity: int = Field(..., ge=1, description="Количество")


class CartItemRead(CartItemBase):
    id: int = Field(..., description="ID позиции")
    price_snapshot: float = Field(..., description="Цена на момент добавления")
    product: ProductRead | None = Field(None, description="Товар")

    model_config = ConfigDict(from_attributes=True)


class CartRead(BaseModel):
    id: int = Field(..., description="ID корзины")
    status: str = Field(..., description="Статус корзины")
    created_at: datetime = Field(..., description="Дата создания")
    updated_at: datetime = Field(..., description="Дата обновления")
    items: list[CartItemRead] = Field(default_factory=list, description="Позиции")

    model_config = ConfigDict(from_attributes=True)

