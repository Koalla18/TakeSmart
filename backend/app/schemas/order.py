from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, field_validator, model_validator

# ─── Лимиты ────────────────────────────────────────────────────────────────────
MAX_QUANTITY_PER_ITEM = 15
MAX_TOTAL_ITEMS = 15
MAX_POSITIONS = 20
MAX_PRICE = 100_000_000  # 100 млн - разумный максимум для суммы заказа
MAX_ITEM_PRICE = 50_000_000  # 50 млн за единицу товара
MAX_COMMENT_LENGTH = 1000
MAX_ADDRESS_LENGTH = 500

ALLOWED_PAYMENT_METHODS = {"cash", "card"}
ALLOWED_DELIVERY_METHODS = {"pickup", "courier", "post"}


class CartItem(BaseModel):
    product_id: str
    name: str
    price: int
    quantity: int
    image: str

    @field_validator("product_id")
    @classmethod
    def validate_product_id(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 100:
            raise ValueError("Некорректный ID товара")
        return v

    @field_validator("name")
    @classmethod
    def validate_item_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 300:
            raise ValueError("Некорректное название товара")
        return v

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: int) -> int:
        if v < 0:
            raise ValueError("Цена не может быть отрицательной")
        if v > MAX_ITEM_PRICE:
            raise ValueError(f"Цена товара слишком большая (макс. {MAX_ITEM_PRICE:,} ₽)")
        return v

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Количество должно быть не менее 1")
        if v > MAX_QUANTITY_PER_ITEM:
            raise ValueError(f"Максимум {MAX_QUANTITY_PER_ITEM} единиц одного товара")
        return v

    @field_validator("image")
    @classmethod
    def validate_image(cls, v: str) -> str:
        # Разрешаем пустую строку, эмодзи, или путь
        if len(v) > 500:
            raise ValueError("Путь к изображению слишком длинный")
        return v


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

    @field_validator("comment")
    @classmethod
    def validate_comment(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) > MAX_COMMENT_LENGTH:
            raise ValueError(f"Комментарий слишком длинный (макс. {MAX_COMMENT_LENGTH} символов)")
        return v if v else None

    @field_validator("payment_method")
    @classmethod
    def validate_payment_method(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().lower()
        if v not in ALLOWED_PAYMENT_METHODS:
            raise ValueError(f"Недопустимый способ оплаты. Разрешено: {', '.join(ALLOWED_PAYMENT_METHODS)}")
        return v

    @field_validator("delivery_method")
    @classmethod
    def validate_delivery_method(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().lower()
        if v not in ALLOWED_DELIVERY_METHODS:
            raise ValueError(f"Недопустимый способ доставки. Разрешено: {', '.join(ALLOWED_DELIVERY_METHODS)}")
        return v

    @field_validator("delivery_address")
    @classmethod
    def validate_delivery_address(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) > MAX_ADDRESS_LENGTH:
            raise ValueError(f"Адрес слишком длинный (макс. {MAX_ADDRESS_LENGTH} символов)")
        return v if v else None

    @field_validator("total_amount")
    @classmethod
    def validate_total_amount(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            return v
        if v < 0:
            raise ValueError("Сумма заказа не может быть отрицательной")
        if v > MAX_PRICE:
            raise ValueError(f"Сумма заказа слишком большая (макс. {MAX_PRICE:,} ₽)")
        return v

    @model_validator(mode="after")
    def validate_order(self) -> "OrderCreate":
        # Проверка количества позиций
        if self.items:
            if len(self.items) > MAX_POSITIONS:
                raise ValueError(f"Слишком много позиций в заказе (макс. {MAX_POSITIONS})")
            
            # Проверка общего количества товаров
            total_quantity = sum(item.quantity for item in self.items)
            if total_quantity > MAX_TOTAL_ITEMS:
                raise ValueError(f"Слишком много товаров в заказе (макс. {MAX_TOTAL_ITEMS} шт)")
            
            # Проверка что сумма товаров примерно соответствует total_amount
            # (с учётом возможной наценки за карту и доставки)
            if self.total_amount is not None:
                items_sum = sum(item.price * item.quantity for item in self.items)
                # Допускаем разницу до 20% (наценка за карту) + 1000 (доставка)
                max_expected = int(items_sum * 1.2) + 1000
                if self.total_amount > max_expected:
                    raise ValueError("Сумма заказа не соответствует товарам в корзине")
                if self.total_amount < items_sum * 0.5:
                    raise ValueError("Сумма заказа слишком мала для выбранных товаров")
        
        # Если доставка не самовывоз — адрес обязателен
        if self.delivery_method and self.delivery_method != "pickup":
            if not self.delivery_address:
                raise ValueError("Для доставки курьером или почтой укажите адрес")
        
        return self


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

