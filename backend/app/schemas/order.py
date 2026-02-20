from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, field_validator


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
    payment_method: Optional[str] = None
    delivery_method: Optional[str] = None
    delivery_address: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Имя должно быть не менее 2 символов")
        if len(v) > 100:
            raise ValueError("Имя слишком длинное (макс. 100 символов)")
        if not re.match(r"^[а-яА-ЯёЁa-zA-Z\s\-]+$", v):
            raise ValueError("Имя может содержать только буквы, пробелы и дефисы")
        return v

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v)
        if len(digits) < 11:
            raise ValueError("Неполный номер телефона")
        if len(digits) > 11:
            raise ValueError("Слишком много цифр в номере")
        norm = "7" + digits[1:] if digits.startswith("8") else digits
        if not norm.startswith("7"):
            raise ValueError("Номер должен начинаться на +7 или 8")
        return v


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
    status: str = "new"
    created_at: datetime

    class Config:
        from_attributes = True


class OrderStatusUpdate(BaseModel):
    status: str

