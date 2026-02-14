from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr


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

