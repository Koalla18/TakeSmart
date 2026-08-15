from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class QuickFilter(BaseModel):
    label: str = Field(..., min_length=1, max_length=100)
    query: str = Field(..., min_length=1, max_length=200)
    brand: Optional[str] = Field(None, min_length=1, max_length=100)


class ProductField(BaseModel):
    """Полностью настраиваемое поле карточки товара для одной категории."""

    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]{0,49}$", examples=["ram"])
    label: str = Field(..., min_length=1, max_length=100)
    field_type: Literal["text", "number", "select", "boolean"] = "text"
    placeholder: str = Field("", max_length=150)
    options: list[str] = Field(default_factory=list, max_length=100)
    hint: Optional[str] = Field(None, max_length=250)
    is_required: bool = False
    is_variant: bool = False

    @model_validator(mode="after")
    def select_requires_options(self) -> "ProductField":
        if self.field_type == "select" and not self.options:
            raise ValueError("Для поля типа «список» добавьте хотя бы один вариант")
        return self


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, examples=["Смартфоны"])
    description: Optional[str] = Field(None, max_length=2000)
    image_url: Optional[str] = Field(None, max_length=500)
    is_active: bool = Field(True)
    sort_order: int = Field(0, ge=0, description="Порядок отображения (меньше — выше в списке)")
    parent_id: Optional[uuid.UUID] = Field(None, description="UUID родительской категории (не передавать или null — корневая категория)")
    quick_filters: Optional[list[QuickFilter]] = Field(None, description="Теги для быстрой фильтрации в каталоге")
    product_fields: Optional[list[ProductField]] = Field(
        None,
        description="Полная схема характеристик и вариантов товара для этой категории",
    )

    @model_validator(mode="after")
    def unique_product_field_keys(self) -> "CategoryBase":
        if self.product_fields:
            keys = [field.key for field in self.product_fields]
            if len(keys) != len(set(keys)):
                raise ValueError("Ключи полей категории не должны повторяться")
        return self


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    """Все поля опциональны — PATCH-семантика.

    Чтобы убрать родителя и сделать категорию корневой — передай parent_id: null явно.
    """
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    slug: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    image_url: Optional[str] = Field(None, max_length=500)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0, description="Порядок отображения (меньше — выше в списке)")
    parent_id: Optional[uuid.UUID] = None
    quick_filters: Optional[list[QuickFilter]] = None
    product_fields: Optional[list[ProductField]] = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "CategoryUpdate":
        # Проверяем по model_fields_set — какие поля были реально переданы в запросе,
        # а не по значениям (parent_id: null — валидный запрос для снятия родителя)
        if not self.model_fields_set:
            raise ValueError("Необходимо передать хотя бы одно поле для обновления")
        if self.product_fields is not None:
            keys = [field.key for field in self.product_fields]
            if len(keys) != len(set(keys)):
                raise ValueError("Ключи полей категории не должны повторяться")
        return self


class CategoryOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: Optional[str]
    image_url: Optional[str]
    is_active: bool
    sort_order: int
    parent_id: Optional[uuid.UUID]
    quick_filters: Optional[list[QuickFilter]] = None
    product_fields: Optional[list[ProductField]] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("image_url", mode="after")
    @classmethod
    def _normalize_image(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        from src.app.core.static_service import static_service
        return static_service.build_url(v)


class CategoryWithChildrenOut(CategoryOut):
    children: list[CategoryOut] = []


class CategoryFieldPreset(BaseModel):
    """Готовый пресет схемы категории (стартовые поля + быстрые фильтры)."""

    id: str
    label: str
    description: str
    product_fields: list[ProductField]
    quick_filters: list[QuickFilter]


class CategoryFieldPresetsOut(BaseModel):
    presets: list[CategoryFieldPreset]
