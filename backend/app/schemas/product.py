from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class SpecItem(BaseModel):
    label: str
    value: str


class ProductBase(BaseModel):
    name: str
    slug: str
    brand: Optional[str] = None
    category_id: Optional[int] = None
    price: int
    old_price: Optional[int] = None
    badge: Optional[str] = None
    in_stock: bool = True
    is_used: bool = False
    is_featured: bool = False
    variant_group_id: Optional[str] = None
    color: Optional[str] = None
    color_code: Optional[str] = None
    storage: Optional[str] = None
    image: Optional[str] = None
    images: Optional[List[str]] = None
    description: Optional[str] = None
    specs: Optional[List[SpecItem]] = None
    sort_order: int = 0
    is_active: bool = True


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    brand: Optional[str] = None
    category_id: Optional[int] = None
    price: Optional[int] = None
    old_price: Optional[int] = None
    badge: Optional[str] = None
    in_stock: Optional[bool] = None
    is_used: Optional[bool] = None
    is_featured: Optional[bool] = None
    variant_group_id: Optional[str] = None
    color: Optional[str] = None
    color_code: Optional[str] = None
    storage: Optional[str] = None
    image: Optional[str] = None
    images: Optional[List[str]] = None
    description: Optional[str] = None
    specs: Optional[List[SpecItem]] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class ProductVariantInfo(BaseModel):
    id: int
    slug: str
    color: Optional[str] = None
    color_code: Optional[str] = None
    storage: Optional[str] = None
    price: int
    in_stock: bool

    class Config:
        from_attributes = True


class ProductRead(BaseModel):
    id: int
    name: str
    slug: str
    brand: Optional[str] = None
    category_id: Optional[int] = None
    price: int
    old_price: Optional[int] = None
    badge: Optional[str] = None
    in_stock: bool
    is_used: bool
    is_featured: bool
    variant_group_id: Optional[str] = None
    color: Optional[str] = None
    color_code: Optional[str] = None
    storage: Optional[str] = None
    image: Optional[str] = None
    images: Optional[List[str]] = None
    description: Optional[str] = None
    specs: Optional[List[dict]] = None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    variants: Optional[List[ProductVariantInfo]] = None

    class Config:
        from_attributes = True

