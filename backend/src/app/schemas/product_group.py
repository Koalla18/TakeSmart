"""Pydantic-схемы для групп товаров."""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


class ProductGroupCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255, examples=["iPhone 17 Pro"])


class ProductGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=255)


class ProductGroupSiblingOut(BaseModel):
    """Краткая информация о карточке-соседе в группе (для переключения цвета)."""
    id: uuid.UUID
    name: str
    slug: str
    color: Optional[str] = None
    main_image_url: Optional[str] = None
    price: Decimal
    discount_price: Optional[Decimal] = None
    is_active: bool
    attributes: Optional[dict[str, Any]] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_product(cls, product) -> "ProductGroupSiblingOut":
        from src.app.schemas.product import ProductOut
        img = ProductOut.normalize_image_url(product.main_image_url)
        return cls(
            id=product.id,
            name=product.name,
            slug=product.slug,
            color=product.color,
            main_image_url=img,
            price=product.price,
            discount_price=product.discount_price,
            is_active=product.is_active,
            attributes=product.attributes,
        )


class ProductGroupOut(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime
    products_count: int = 0

    model_config = {"from_attributes": True}


class ProductGroupDetailOut(ProductGroupOut):
    """Группа с полным списком карточек-соседей."""
    siblings: list[ProductGroupSiblingOut] = Field(default_factory=list)


class ProductGroupMerge(BaseModel):
    """Объединить несколько товаров в группу."""
    product_ids: list[uuid.UUID] = Field(..., min_length=2, description="ID товаров для объединения (минимум 2)")
    name: Optional[str] = Field(None, min_length=2, max_length=255, description="Имя группы (если не указано — берётся из первого товара)")


class ProductGroupUnlink(BaseModel):
    """Убрать товар(ы) из группы."""
    product_ids: list[uuid.UUID] = Field(..., min_length=1)
