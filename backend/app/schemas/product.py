from datetime import datetime
from typing import Optional, List
import re
import uuid

from pydantic import BaseModel, field_validator


# ============ CATEGORY SCHEMAS ============

class CategoryBase(BaseModel):
    slug: str
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("slug не может быть пустым")
        if len(v) > 100:
            raise ValueError("slug слишком длинный (макс. 100 символов)")
        if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", v):
            raise ValueError("slug может содержать только строчные буквы, цифры и дефисы (не в начале/конце)")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Название не может быть пустым")
        if len(v) > 200:
            raise ValueError("Название слишком длинное (макс. 200 символов)")
        return v

    @field_validator("sort_order")
    @classmethod
    def validate_sort_order(cls, v: int) -> int:
        if v < 0:
            raise ValueError("sort_order не может быть отрицательным")
        return v


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    slug: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip().lower()
            if not v:
                raise ValueError("slug не может быть пустым")
            if len(v) > 100:
                raise ValueError("slug слишком длинный (макс. 100 символов)")
            if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", v):
                raise ValueError("slug может содержать только строчные буквы, цифры и дефисы")
        return v

    @field_validator("sort_order")
    @classmethod
    def validate_sort_order(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("sort_order не может быть отрицательным")
        return v


class CategoryRead(CategoryBase):
    id: uuid.UUID
    created_at: datetime

    class Config:
        from_attributes = True


# ============ PRODUCT SCHEMAS ============

class SpecItem(BaseModel):
    label: str
    value: str

    @field_validator("label", "value")
    @classmethod
    def validate_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Поле не может быть пустым")
        if len(v) > 500:
            raise ValueError("Значение слишком длинное (макс. 500 символов)")
        return v


class ProductBase(BaseModel):
    name: str
    slug: str
    brand: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
    price: int
    old_price: Optional[int] = None
    badge: Optional[str] = None  # hit, new, sale
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

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Название товара не может быть пустым")
        if len(v) > 300:
            raise ValueError("Название слишком длинное (макс. 300 символов)")
        return v

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("slug не может быть пустым")
        if len(v) > 300:
            raise ValueError("slug слишком длинный (макс. 300 символов)")
        if not re.match(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$", v):
            raise ValueError(
                "slug может содержать только строчные буквы, цифры, дефисы и подчёркивания"
            )
        return v

    @field_validator("brand")
    @classmethod
    def validate_brand(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                return None
            if len(v) > 100:
                raise ValueError("Бренд слишком длинный (макс. 100 символов)")
        return v

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Цена должна быть не менее 1 рубля")
        if v > 100_000_000:
            raise ValueError("Цена слишком большая (макс. 100 000 000)")
        return v

    @field_validator("old_price")
    @classmethod
    def validate_old_price(cls, v: Optional[int]) -> Optional[int]:
        if v is not None:
            if v < 1:
                raise ValueError("Старая цена должна быть не менее 1 рубля")
            if v > 100_000_000:
                raise ValueError("Старая цена слишком большая (макс. 100 000 000)")
        return v

    @field_validator("badge")
    @classmethod
    def validate_badge(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if v and v not in {"hit", "new", "sale"}:
                raise ValueError("badge должен быть одним из: hit, new, sale")
        return v or None

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            if len(v) > 50_000:
                raise ValueError("Описание слишком длинное (макс. 50 000 символов)")
        return v

    @field_validator("images")
    @classmethod
    def validate_images(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None:
            if len(v) > 20:
                raise ValueError("Нельзя добавить более 20 изображений")
            for img in v:
                if len(img) > 500:
                    raise ValueError("URL изображения слишком длинный (макс. 500 символов)")
        return v

    @field_validator("specs")
    @classmethod
    def validate_specs(cls, v: Optional[List[SpecItem]]) -> Optional[List[SpecItem]]:
        if v is not None and len(v) > 100:
            raise ValueError("Нельзя добавить более 100 характеристик")
        return v

    @field_validator("sort_order")
    @classmethod
    def validate_sort_order(cls, v: int) -> int:
        if v < 0:
            raise ValueError("sort_order не может быть отрицательным")
        return v

    @field_validator("color_code")
    @classmethod
    def validate_color_code(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if v and not re.match(r"^#[0-9A-Fa-f]{3,8}$", v):
                raise ValueError("color_code должен быть HEX-цветом (например #FF0000)")
        return v or None


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    brand: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
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

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Название товара не может быть пустым")
            if len(v) > 300:
                raise ValueError("Название слишком длинное (макс. 300 символов)")
        return v

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip().lower()
            if not v:
                raise ValueError("slug не может быть пустым")
            if len(v) > 300:
                raise ValueError("slug слишком длинный (макс. 300 символов)")
            if not re.match(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$", v):
                raise ValueError(
                    "slug может содержать только строчные буквы, цифры, дефисы и подчёркивания"
                )
        return v

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: Optional[int]) -> Optional[int]:
        if v is not None:
            if v < 1:
                raise ValueError("Цена должна быть не менее 1 рубля")
            if v > 100_000_000:
                raise ValueError("Цена слишком большая (макс. 100 000 000)")
        return v

    @field_validator("old_price")
    @classmethod
    def validate_old_price(cls, v: Optional[int]) -> Optional[int]:
        if v is not None:
            if v < 1:
                raise ValueError("Старая цена должна быть не менее 1 рубля")
            if v > 100_000_000:
                raise ValueError("Старая цена слишком большая")
        return v

    @field_validator("badge")
    @classmethod
    def validate_badge(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if v and v not in {"hit", "new", "sale"}:
                raise ValueError("badge должен быть одним из: hit, new, sale")
        return v or None

    @field_validator("images")
    @classmethod
    def validate_images(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None:
            if len(v) > 20:
                raise ValueError("Нельзя добавить более 20 изображений")
            for img in v:
                if len(img) > 500:
                    raise ValueError("URL изображения слишком длинный (макс. 500 символов)")
        return v

    @field_validator("sort_order")
    @classmethod
    def validate_sort_order(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("sort_order не может быть отрицательным")
        return v

    @field_validator("color_code")
    @classmethod
    def validate_color_code(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if v and not re.match(r"^#[0-9A-Fa-f]{3,8}$", v):
                raise ValueError("color_code должен быть HEX-цветом (например #FF0000)")
        return v or None



class ProductVariantInfo(BaseModel):
    """Minimal variant info for listing variants"""
    id: uuid.UUID
    slug: str
    color: Optional[str] = None
    color_code: Optional[str] = None
    storage: Optional[str] = None
    price: int
    in_stock: bool
    
    class Config:
        from_attributes = True


class ProductRead(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    brand: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
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


