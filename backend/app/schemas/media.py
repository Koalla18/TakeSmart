"""Pydantic schemas для MediaFile."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

ALLOWED_ENTITY_TYPES = {"product", "category", "slide", "misc"}


class MediaFileRead(BaseModel):
    """Полная информация о медиафайле — используется в API-ответах."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entity_type: str
    entity_id: Optional[uuid.UUID]
    url: str
    thumbnail_url: Optional[str]
    original_filename: str
    filename: str
    content_type: str
    size: int
    width: Optional[int]
    height: Optional[int]
    is_primary: bool
    sort_order: int
    alt_text: Optional[str]
    created_at: datetime


class MediaFileSetPrimary(BaseModel):
    """Тело запроса для установки главного фото."""
    model_config = ConfigDict(extra="forbid")

    media_id: uuid.UUID


class MediaFileSortOrder(BaseModel):
    """Обновление порядка сортировки файла."""
    model_config = ConfigDict(extra="forbid")

    sort_order: int = Field(ge=0)


class MediaFileAltText(BaseModel):
    """Обновление alt-текста файла."""
    model_config = ConfigDict(extra="forbid")

    alt_text: Optional[str] = Field(None, max_length=300)

