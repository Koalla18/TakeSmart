from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class BrandCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    logo_url: Optional[str] = Field(None, max_length=500)
    is_active: bool = True


class BrandUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    slug: Optional[str] = Field(None, min_length=1, max_length=120)
    logo_url: Optional[str] = Field(None, max_length=500)
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "BrandUpdate":
        if not self.model_fields_set:
            raise ValueError("Необходимо передать хотя бы одно поле для обновления")
        return self


class BrandOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    logo_url: Optional[str]
    is_active: bool
    # Количество товаров с этим брендом (COUNT по lower(products.brand)).
    products_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
