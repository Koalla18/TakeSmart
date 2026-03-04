from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, examples=["Смартфоны"])
    description: Optional[str] = Field(None, max_length=2000)
    image_url: Optional[str] = Field(None, max_length=500)
    is_active: bool = Field(True)
    parent_id: Optional[uuid.UUID] = Field(None, description="UUID родительской категории (не передавать или null — корневая категория)")


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
    parent_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "CategoryUpdate":
        # Проверяем по model_fields_set — какие поля были реально переданы в запросе,
        # а не по значениям (parent_id: null — валидный запрос для снятия родителя)
        if not self.model_fields_set:
            raise ValueError("Необходимо передать хотя бы одно поле для обновления")
        return self


class CategoryOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: Optional[str]
    image_url: Optional[str]
    is_active: bool
    parent_id: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CategoryWithChildrenOut(CategoryOut):
    children: list[CategoryOut] = []
