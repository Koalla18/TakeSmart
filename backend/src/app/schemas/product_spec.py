from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, Field


class ProductSpecIn(BaseModel):
    """Одна характеристика при создании/замене спецификаций товара."""
    group_name: str = Field(
        "Основные",
        max_length=100,
        examples=["Дисплей", "Производительность", "Камера"],
        description="Группа характеристик (для группировки на странице товара)",
    )
    name: str = Field(
        ...,
        min_length=1,
        max_length=150,
        examples=["Диагональ экрана", "ОЗУ", "Основная камера"],
        description="Название характеристики",
    )
    value: str = Field(
        ...,
        min_length=1,
        max_length=500,
        examples=["6.7", "12", "48"],
        description="Значение характеристики",
    )
    unit: Optional[str] = Field(
        None,
        max_length=50,
        examples=["дюйм", "ГБ", "МП", "Гц"],
        description="Единица измерения (опционально)",
    )
    sort_order: int = Field(
        0,
        ge=0,
        description="Порядок сортировки внутри группы",
    )


class ProductSpecOut(BaseModel):
    """Характеристика товара в ответе API."""
    id: uuid.UUID
    product_id: uuid.UUID
    group_name: str
    name: str
    value: str
    unit: Optional[str]
    sort_order: int

    model_config = {"from_attributes": True}


class ProductSpecGroupOut(BaseModel):
    """Группа характеристик — для красивого отображения на фронте."""
    group_name: str = Field(description="Название группы")
    specs: list[ProductSpecOut] = Field(description="Список характеристик в группе")

