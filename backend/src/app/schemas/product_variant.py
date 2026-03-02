from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class ProductVariantOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    sku: Optional[str]
    price: Optional[Decimal]
    discount_price: Optional[Decimal]
    stock_quantity: int
    color: Optional[str]
    storage: Optional[str]
    size: Optional[str]
    image_url: Optional[str]
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("image_url", mode="after")
    @classmethod
    def normalize_image_url(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        if v.startswith("/") or v.startswith("http"):
            return v
        return f"/static/{v}"


class ProductVariantCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, examples=["256 ГБ / Чёрный титан"])
    sku: Optional[str] = Field(None, max_length=100)
    price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    discount_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    stock_quantity: int = Field(0, ge=0)
    color: Optional[str] = Field(None, max_length=80)
    storage: Optional[str] = Field(None, max_length=80)
    size: Optional[str] = Field(None, max_length=80)
    image_url: Optional[str] = Field(None, max_length=500)
    sort_order: int = Field(0, ge=0)
    is_active: bool = True


class ProductVariantUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    sku: Optional[str] = Field(None, max_length=100)
    price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    discount_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    stock_quantity: Optional[int] = Field(None, ge=0)
    color: Optional[str] = Field(None, max_length=80)
    storage: Optional[str] = Field(None, max_length=80)
    size: Optional[str] = Field(None, max_length=80)
    image_url: Optional[str] = Field(None, max_length=500)
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None


class VariantMatrixGenerate(BaseModel):
    """Генерация матрицы вариантов из списков атрибутов.

    Создаёт все комбинации (color × storage × size), пропускает уже
    существующие. Если один из списков пуст — этот атрибут не участвует.
    """

    colors: list[str] = Field(default_factory=list, max_length=20)
    storages: list[str] = Field(default_factory=list, max_length=20)
    sizes: list[str] = Field(default_factory=list, max_length=20)
    default_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    default_stock: int = Field(0, ge=0)
