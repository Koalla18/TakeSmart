from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator, model_validator

# ─── Лимиты ────────────────────────────────────────────────────────────────────
MAX_QUANTITY_PER_ITEM = 15
MAX_POSITIONS = 20
MAX_COMMENT_LENGTH = 1000
MAX_ADDRESS_LENGTH = 500
MAX_NAME_LENGTH = 100

# ─── Источник истины по стоимостям — ТОЛЬКО сервер ────────────────────────────
# Клиент не передаёт цены, доставку и наценки — всё считается здесь
DELIVERY_PRICES: dict[str, int] = {
    "pickup": 0,
    "courier": 500,
    "post": 800,
}

# При заказе от этой суммы (subtotal) — доставка бесплатна (как на фронтенде)
FREE_DELIVERY_THRESHOLD: int = 200_000

PAYMENT_MARKUP: dict[str, float] = {
    "cash": 0.0,
    "card": 0.15,   # +15% за оплату картой
    "online": 0.0,
}


class CartItem(BaseModel):
    """
    Клиент передаёт ТОЛЬКО product_id и quantity.
    Цена берётся исключительно из БД — подмена цены невозможна.
    Любые лишние поля (name, price, image, line_total и т.п.) отвергаются.
    """
    model_config = ConfigDict(extra="forbid")

    product_id: str
    quantity: int

    @field_validator("product_id")
    @classmethod
    def validate_product_id(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("product_id не может быть пустым")
        try:
            uuid.UUID(v)
        except ValueError:
            raise ValueError("product_id должен быть корректным UUID")
        return v

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Количество должно быть не менее 1")
        if v > MAX_QUANTITY_PER_ITEM:
            raise ValueError(f"Количество не может превышать {MAX_QUANTITY_PER_ITEM}")
        return v


class OrderCreate(BaseModel):
    """
    Входные данные при создании заказа.
    Цены, total_amount и детали стоимости НЕ принимаются — считаются сервером.
    Неизвестные поля отвергаются.
    """
    model_config = ConfigDict(extra="forbid")

    name: str
    phone: str
    email: EmailStr
    comment: Optional[str] = None
    items: List[CartItem]  # обязательное поле, пустой список запрещён
    payment_method: Optional[Literal["cash", "card", "online"]] = None
    delivery_method: Optional[Literal["pickup", "courier", "post"]] = None
    delivery_address: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Имя должно быть не менее 2 символов")
        if len(v) > MAX_NAME_LENGTH:
            raise ValueError(f"Имя слишком длинное (макс. {MAX_NAME_LENGTH} символов)")
        if not re.match(r"^[а-яА-ЯёЁa-zA-Z\s\-]+$", v):
            raise ValueError("Имя может содержать только буквы, пробелы и дефисы")
        return v

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        v = v.strip()
        digits = re.sub(r"\D", "", v)
        if len(digits) < 11:
            raise ValueError("Неполный номер телефона (нужно 11 цифр)")
        if len(digits) > 11:
            raise ValueError("Слишком много цифр в номере (ожидается 11)")
        norm = "7" + digits[1:] if digits.startswith("8") else digits
        if not norm.startswith("7"):
            raise ValueError("Номер должен начинаться на +7 или 8")
        return "+7" + norm[1:]  # нормализуем к +7XXXXXXXXXX

    @field_validator("comment")
    @classmethod
    def validate_comment(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                return None
            if len(v) > MAX_COMMENT_LENGTH:
                raise ValueError(f"Комментарий не может превышать {MAX_COMMENT_LENGTH} символов")
        return v

    @field_validator("delivery_address")
    @classmethod
    def validate_delivery_address(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                return None
            if len(v) > MAX_ADDRESS_LENGTH:
                raise ValueError(f"Адрес не может превышать {MAX_ADDRESS_LENGTH} символов")
        return v

    @field_validator("items")
    @classmethod
    def validate_items(cls, v: List[CartItem]) -> List[CartItem]:
        if not v:
            raise ValueError("Корзина не может быть пустой")
        if len(v) > MAX_POSITIONS:
            raise ValueError(f"Корзина не может содержать более {MAX_POSITIONS} позиций")
        ids = [item.product_id for item in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Корзина содержит дублирующиеся товары")
        return v

    @model_validator(mode="after")
    def validate_delivery_consistency(self) -> "OrderCreate":
        """Адрес доставки обязателен при курьерской доставке и почте."""
        if self.delivery_method in {"courier", "post"} and not self.delivery_address:
            raise ValueError("Адрес доставки обязателен для курьерской доставки и почты")
        return self


class OrderRead(BaseModel):
    id: uuid.UUID  # UUID, не int
    name: str
    phone: str
    email: str
    comment: Optional[str] = None
    items: Optional[List[dict]] = None
    total_amount: Optional[int] = None
    payment_method: Optional[str] = None
    delivery_method: Optional[str] = None
    delivery_address: Optional[str] = None
    status: str = "new"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OrderStatusUpdate(BaseModel):
    """Допустимые статусы заказа — только из enum, произвольная строка не принимается."""
    status: Literal["new", "processing", "ready", "completed", "cancelled"]
