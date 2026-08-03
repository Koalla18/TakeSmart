from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class TradeInOfferFields(BaseModel):
    device_type: str = Field(..., min_length=1, max_length=100, examples=["iphone"])
    device_label: str = Field(..., min_length=1, max_length=100, examples=["iPhone"])
    name: str = Field(..., min_length=2, max_length=200)
    min_price: Decimal = Field(..., ge=0, decimal_places=2)
    max_price: Decimal = Field(..., gt=0, decimal_places=2)
    sort_order: int = Field(0, ge=0)
    is_active: bool = True

    @model_validator(mode="after")
    def valid_price_range(self) -> "TradeInOfferFields":
        if self.min_price > self.max_price:
            raise ValueError("Минимальная цена не может быть больше максимальной")
        return self


class TradeInOfferCreate(TradeInOfferFields):
    pass


class TradeInOfferUpdate(BaseModel):
    device_type: Optional[str] = Field(None, min_length=1, max_length=100)
    device_label: Optional[str] = Field(None, min_length=1, max_length=100)
    name: Optional[str] = Field(None, min_length=2, max_length=200)
    min_price: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    max_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    sort_order: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "TradeInOfferUpdate":
        if not self.model_fields_set:
            raise ValueError("Необходимо передать хотя бы одно поле для обновления")
        if self.min_price is not None and self.max_price is not None and self.min_price > self.max_price:
            raise ValueError("Минимальная цена не может быть больше максимальной")
        return self


class TradeInOfferOut(TradeInOfferFields):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
