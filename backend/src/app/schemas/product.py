from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from src.app.schemas.product_image import ProductImageOut


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255, examples=["iPhone 16 Pro"])
    description: Optional[str] = Field(None, max_length=10000)
    short_description: Optional[str] = Field(None, max_length=500)
    price: Decimal = Field(..., gt=0, decimal_places=2, examples=[99999.99])
    discount_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    stock_quantity: int = Field(0, ge=0)
    sku: Optional[str] = Field(None, max_length=100, examples=["APL-IP16P-256-BLK"])
    brand: Optional[str] = Field(None, max_length=100, examples=["Apple"])
    model: Optional[str] = Field(None, max_length=150, examples=["iPhone 16 Pro"])
    color: Optional[str] = Field(None, max_length=50, examples=["Чёрный титан"])
    warranty_months: Optional[int] = Field(None, ge=0, le=120)
    is_active: bool = Field(True)
    is_featured: bool = Field(False)
    category_id: Optional[uuid.UUID] = None

    @field_validator("discount_price", mode="after")
    @classmethod
    def discount_less_than_price(
        cls, discount: Optional[Decimal], info: Any
    ) -> Optional[Decimal]:
        price = info.data.get("price")
        if discount is not None and price is not None and discount >= price:
            raise ValueError("Цена со скидкой должна быть меньше основной цены")
        return discount


class ProductUpdate(BaseModel):
    """Все поля опциональны — PATCH-семантика."""
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    short_description: Optional[str] = Field(None, max_length=500)
    price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    discount_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    stock_quantity: Optional[int] = Field(None, ge=0)
    sku: Optional[str] = Field(None, max_length=100)
    brand: Optional[str] = Field(None, max_length=100)
    model: Optional[str] = Field(None, max_length=150)
    color: Optional[str] = Field(None, max_length=50)
    warranty_months: Optional[int] = Field(None, ge=0, le=120)
    is_active: Optional[bool] = None
    is_featured: Optional[bool] = None
    category_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "ProductUpdate":
        if not any(v is not None for v in self.model_dump().values()):
            raise ValueError("Необходимо передать хотя бы одно поле для обновления")
        return self


class ProductOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: Optional[str]
    short_description: Optional[str]
    price: Decimal
    discount_price: Optional[Decimal]
    stock_quantity: int
    sku: Optional[str]
    brand: Optional[str]
    model: Optional[str]
    color: Optional[str]
    warranty_months: Optional[int]
    main_image_url: Optional[str]
    is_active: bool
    is_featured: bool
    category_id: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("main_image_url", mode="after")
    @classmethod
    def normalize_image_url(cls, v: Optional[str]) -> Optional[str]:
        """
        Нормализует main_image_url перед отдачей клиенту.

        В БД путь может хранится двумя способами:
          - Голый relative path от static-директории: "products/{id}/{uuid}.jpg"
            (так сохраняет static_service после admin-upload)
          - URL-путь с префиксом: "/static/products/..." или "https://..."
            (так сохраняет seeder и внешние ссылки)

        Нормализация: если путь не начинается с "/" или "http" —
        добавляем "/static/" чтобы браузер корректно разрезолвил через nginx.
        """
        if not v:
            return v
        if v.startswith("/") or v.startswith("http"):
            return v
        return f"/static/{v}"


class ProductDetailOut(ProductOut):
    """Детальное представление товара — со списком изображений."""
    images: list[ProductImageOut] = []
