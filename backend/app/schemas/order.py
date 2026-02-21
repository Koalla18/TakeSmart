from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator, model_validator


VALID_PAYMENT_METHODS = {"cash", "card", "online"}
VALID_DELIVERY_METHODS = {"pickup", "courier", "post"}

# Лимиты
MAX_ITEMS_IN_CART = 50       # макс. уникальных позиций в корзине
MAX_QUANTITY_PER_ITEM = 99   # макс. кол-во одного товара
MAX_EMAIL_LEN = 254          # RFC 5321
MAX_COMMENT_LEN = 1000
MAX_ADDRESS_LEN = 500
MAX_NAME_LEN = 100

# ─── Источник истины по стоимостям — только сервер ───────────────────────────
# Стоимость доставки в рублях
DELIVERY_PRICES: dict[str, int] = {
    "pickup": 0,
    "courier": 500,
    "post": 800,
}

# Коэффициент наценки за метод оплаты (умножается на subtotal)
PAYMENT_MARKUP: dict[str, float] = {
    "cash": 0.0,
    "card": 0.15,   # +15% за оплату картой
    "online": 0.0,
}


class CartItem(BaseModel):
    """
    Клиент передаёт только product_id и quantity.
    Цена, название и фото берутся ИСКЛЮЧИТЕЛЬНО из БД на сервере —
    подмена цены клиентом невозможна.
    Лишние поля (name, price, image и т.п.) жёстко отвергаются.
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
    Клиент передаёт контактные данные, список товаров (только id + кол-во),
    метод оплаты и доставки. Цены и итоговая сумма НЕ принимаются от клиента —
    рассчитываются сервером. Неизвестные поля отвергаются.
    """
    model_config = ConfigDict(extra="forbid")

    name: str
    phone: str
    email: EmailStr
    comment: Optional[str] = None
    items: List[CartItem]          # обязательное поле, пустой список запрещён
    payment_method: Optional[Literal["cash", "card", "online"]] = None
    delivery_method: Optional[Literal["pickup", "courier", "post"]] = None
    delivery_address: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Имя не может быть пустым")
        if len(v) < 2:
            raise ValueError("Имя должно быть не менее 2 символов")
        if len(v) > MAX_NAME_LEN:
            raise ValueError(f"Имя слишком длинное (макс. {MAX_NAME_LEN} символов)")
        if not re.match(r"^[а-яА-ЯёЁa-zA-Z\s\-]+$", v):
            raise ValueError("Имя может содержать только буквы, пробелы и дефисы")
        return v

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Телефон не может быть пустым")
        digits = re.sub(r"\D", "", v)
        if len(digits) < 11:
            raise ValueError("Неполный номер телефона (нужно 11 цифр)")
        if len(digits) > 11:
            raise ValueError("Слишком много цифр в номере (ожидается 11)")
        norm = "7" + digits[1:] if digits.startswith("8") else digits
        if not norm.startswith("7"):
            raise ValueError("Номер должен начинаться на +7 или 8")
        return "+7" + norm[1:]  # нормализуем к +7XXXXXXXXXX

    @field_validator("email")
    @classmethod
    def validate_email_length(cls, v: EmailStr) -> EmailStr:
        if len(str(v)) > MAX_EMAIL_LEN:
            raise ValueError(f"Email слишком длинный (макс. {MAX_EMAIL_LEN} символов)")
        return v

    @field_validator("comment")
    @classmethod
    def validate_comment(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                return None
            if len(v) > MAX_COMMENT_LEN:
                raise ValueError(f"Комментарий не может превышать {MAX_COMMENT_LEN} символов")
        return v

    @field_validator("delivery_address")
    @classmethod
    def validate_delivery_address(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                return None
            if len(v) > MAX_ADDRESS_LEN:
                raise ValueError(f"Адрес не может превышать {MAX_ADDRESS_LEN} символов")
        return v

    @field_validator("items")
    @classmethod
    def validate_items(cls, v: List[CartItem]) -> List[CartItem]:
        if not v:
            raise ValueError("Корзина не может быть пустой")
        if len(v) > MAX_ITEMS_IN_CART:
            raise ValueError(
                f"Корзина не может содержать более {MAX_ITEMS_IN_CART} уникальных позиций"
            )
        # Проверяем дубликаты product_id
        ids = [item.product_id for item in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Корзина содержит дублирующиеся товары")
        return v

    @model_validator(mode="after")
    def validate_delivery_consistency(self) -> "OrderCreate":
        """Адрес доставки обязателен при курьерской доставке и почте."""
        if self.delivery_method in {"courier", "post"} and not self.delivery_address:
            raise ValueError(
                "Адрес доставки обязателен для курьерской доставки и почты"
            )
        return self


class OrderRead(BaseModel):
    id: uuid.UUID
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
    status: Literal["new", "processing", "ready", "completed", "cancelled"]

