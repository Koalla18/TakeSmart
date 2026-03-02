from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class WeeklySlideOut(BaseModel):
    id: uuid.UUID
    badge: Optional[str]
    title: str
    description: Optional[str]
    price: Optional[str]
    image: Optional[str]
    color: Optional[str]
    tags: Optional[List[str]]
    link_url: Optional[str]
    is_new: bool
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WeeklySlideCreate(BaseModel):
    badge: Optional[str] = Field(None, max_length=200)
    title: str = Field(..., min_length=1, max_length=255, examples=["iPhone 17 Pro"])
    description: Optional[str] = Field(None, max_length=2000)
    price: Optional[str] = Field(None, max_length=100, examples=["94 000"])
    image: Optional[str] = Field(None, max_length=500)
    color: Optional[str] = Field(
        None, max_length=300,
        examples=["bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50"]
    )
    tags: Optional[List[str]] = Field(None, examples=[["trade-in", "гарантия 12 месяцев*"]])
    link_url: Optional[str] = Field(None, max_length=500)
    is_new: bool = False
    sort_order: int = Field(0, ge=0)
    is_active: bool = True


class WeeklySlideUpdate(BaseModel):
    badge: Optional[str] = Field(None, max_length=200)
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    price: Optional[str] = Field(None, max_length=100)
    image: Optional[str] = Field(None, max_length=500)
    color: Optional[str] = Field(None, max_length=300)
    tags: Optional[List[str]] = None
    link_url: Optional[str] = Field(None, max_length=500)
    is_new: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
