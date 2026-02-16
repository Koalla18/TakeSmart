from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, EmailStr


# ============ CATEGORY SCHEMAS ============

class CategoryBase(BaseModel):
    slug: str
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    slug: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class CategoryRead(CategoryBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============ PRODUCT SCHEMAS ============

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
    badge: Optional[str] = None  # hit, new, sale
    in_stock: bool = True
    is_used: bool = False
    is_featured: bool = False  # for landing page hero
    # Variant fields
    variant_group_id: Optional[str] = None
    color: Optional[str] = None
    color_code: Optional[str] = None
    storage: Optional[str] = None
    # Media
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
    # Variant fields
    variant_group_id: Optional[str] = None
    color: Optional[str] = None
    color_code: Optional[str] = None
    storage: Optional[str] = None
    # Media
    image: Optional[str] = None
    images: Optional[List[str]] = None
    description: Optional[str] = None
    specs: Optional[List[SpecItem]] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class ProductVariantInfo(BaseModel):
    """Minimal variant info for listing variants"""
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
    # Variant fields
    variant_group_id: Optional[str] = None
    color: Optional[str] = None
    color_code: Optional[str] = None
    storage: Optional[str] = None
    # Media
    image: Optional[str] = None
    images: Optional[List[str]] = None
    description: Optional[str] = None
    specs: Optional[List[dict]] = None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    # Variants list (populated by API)
    variants: Optional[List[ProductVariantInfo]] = None
    
    class Config:
        from_attributes = True


# ============ ORDER SCHEMAS ============

class CartItem(BaseModel):
    product_id: str
    name: str
    price: int
    quantity: int
    image: str


class OrderCreate(BaseModel):
    name: str
    phone: str
    email: EmailStr
    comment: Optional[str] = None
    items: Optional[List[CartItem]] = None
    total_amount: Optional[int] = None
    payment_method: Optional[str] = None  # cash, card, online
    delivery_method: Optional[str] = None  # pickup, courier, post
    delivery_address: Optional[str] = None


class OrderRead(BaseModel):
    id: int
    name: str
    phone: str
    email: str
    comment: Optional[str]
    items: Optional[List[dict]] = None
    total_amount: Optional[int] = None
    payment_method: Optional[str] = None
    delivery_method: Optional[str] = None
    delivery_address: Optional[str] = None
    status: str = 'new'
    created_at: datetime

    class Config:
        from_attributes = True


class OrderStatusUpdate(BaseModel):
    status: str  # new, processing, ready, completed, cancelled
