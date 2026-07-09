from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class HeroBannerOut(BaseModel):
    id: uuid.UUID
    badge: Optional[str]
    title: str
    highlight: Optional[str]
    description: Optional[str]
    image: Optional[str]
    cta_label: Optional[str]
    cta_link: Optional[str]
    secondary_label: Optional[str]
    secondary_link: Optional[str]
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("image", mode="after")
    @classmethod
    def _normalize_image(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        from src.app.core.static_service import static_service
        return static_service.build_url(v)


class HeroBannerCreate(BaseModel):
    badge: Optional[str] = Field(None, max_length=200)
    title: str = Field(..., min_length=1, max_length=255, examples=["Умная техника"])
    highlight: Optional[str] = Field(None, max_length=255, examples=["будущего"])
    description: Optional[str] = Field(None, max_length=2000)
    image: Optional[str] = Field(None, max_length=500)
    cta_label: Optional[str] = Field(None, max_length=120, examples=["Смотреть каталог"])
    cta_link: Optional[str] = Field(None, max_length=500, examples=["/catalog"])
    secondary_label: Optional[str] = Field(None, max_length=120)
    secondary_link: Optional[str] = Field(None, max_length=500)
    sort_order: int = Field(0, ge=0)
    is_active: bool = True


class HeroBannerUpdate(BaseModel):
    badge: Optional[str] = Field(None, max_length=200)
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    highlight: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    image: Optional[str] = Field(None, max_length=500)
    cta_label: Optional[str] = Field(None, max_length=120)
    cta_link: Optional[str] = Field(None, max_length=500)
    secondary_label: Optional[str] = Field(None, max_length=120)
    secondary_link: Optional[str] = Field(None, max_length=500)
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
