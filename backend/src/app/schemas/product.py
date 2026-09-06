from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal, Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from src.app.schemas.product_image import ProductImageOut
from src.app.schemas.product_spec import ProductSpecIn, ProductSpecGroupOut
from src.app.schemas.product_variant import ProductVariantOut
from src.app.schemas.product_group import ProductGroupSiblingOut


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255, examples=["iPhone 16 Pro"])
    description: Optional[str] = Field(None, max_length=10000)
    short_description: Optional[str] = Field(None, max_length=500)
    price: Decimal = Field(..., gt=0, decimal_places=2, examples=[99999.99])
    discount_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    stock_quantity: int = Field(0, ge=0)
    sku: Optional[str] = Field(None, max_length=100, examples=["APL-IP16P-256-BLK"])
    brand: Optional[str] = Field(None, max_length=100, examples=["Apple"])
    model: Optional[str] = Field(None, max_length=150, examples=["iPhone 16 Pro"])
    color: Optional[str] = Field(None, max_length=50, examples=["Чёрный титан"])
    warranty_months: Optional[int] = Field(None, ge=0, le=120)
    condition: str = Field("new", pattern="^(new|used)$", description="Состояние: new или used")
    is_active: bool = Field(True)
    is_featured: bool = Field(False)
    category_id: Optional[uuid.UUID] = None
    group_id: Optional[uuid.UUID] = Field(None, description="ID группы товаров (для объединения карточек по цветам)")

    # Произвольные характеристики — любые ключ-значение
    attributes: Optional[dict[str, Any]] = Field(
        None,
        description=(
            "Произвольные характеристики товара в формате JSON. "
            "Пример для смартфона: {\"ram_gb\": 12, \"storage_gb\": 256, \"5g\": true, \"os\": \"iOS 18\"}. "
            "Пример для наушников: {\"driver_mm\": 40, \"noise_cancelling\": true, \"battery_hours\": 30}."
        ),
        examples=[{"ram_gb": 12, "storage_gb": 256, "5g": True, "os": "iOS 18"}],
    )

    # Структурированные спецификации — для таблицы характеристик на странице товара
    specs: Optional[list[ProductSpecIn]] = Field(
        None,
        description=(
            "Структурированные характеристики с группировкой для отображения "
            "в таблице на странице товара. "
            "Пример: [{\"group_name\": \"Дисплей\", \"name\": \"Диагональ\", \"value\": \"6.7\", \"unit\": \"дюйм\"}]"
        ),
    )

    @field_validator("discount_price", mode="after")
    @classmethod
    def discount_less_than_price(
        cls, discount: Optional[Decimal], info: Any
    ) -> Optional[Decimal]:
        price = info.data.get("price")
        if discount is not None and price is not None and discount >= price:
            raise ValueError("Цена со скидкой должна быть меньше основной цены")
        return discount


class ProductUpdate(BaseModel):
    """Все поля опциональны — PATCH-семантика."""
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    description: Optional[str] = Field(None, max_length=10000)
    short_description: Optional[str] = Field(None, max_length=500)
    price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    discount_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    stock_quantity: Optional[int] = Field(None, ge=0)
    sku: Optional[str] = Field(None, max_length=100)
    brand: Optional[str] = Field(None, max_length=100)
    model: Optional[str] = Field(None, max_length=150)
    color: Optional[str] = Field(None, max_length=50)
    warranty_months: Optional[int] = Field(None, ge=0, le=120)
    condition: Optional[str] = Field(None, pattern="^(new|used)$", description="Состояние: new или used")
    is_active: Optional[bool] = None
    is_featured: Optional[bool] = None
    category_id: Optional[uuid.UUID] = None
    group_id: Optional[uuid.UUID] = Field(None, description="ID группы товаров")

    # Произвольные атрибуты — передать новый dict для полной замены
    attributes: Optional[dict[str, Any]] = Field(
        None,
        description="Полная замена произвольных атрибутов товара. Передай null чтобы очистить.",
    )

    # Спецификации — передать список для полной замены всех спецификаций
    specs: Optional[list[ProductSpecIn]] = Field(
        None,
        description="Полная замена спецификаций товара. Передай [] чтобы удалить все.",
    )

    @model_validator(mode="after")
    def at_least_one_field(self) -> "ProductUpdate":
        if not any(v is not None for v in self.model_dump().values()):
            raise ValueError("Необходимо передать хотя бы одно поле для обновления")
        return self


class ProductOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: Optional[str]
    short_description: Optional[str]
    price: Decimal
    discount_price: Optional[Decimal]
    price_updated_at: Optional[datetime] = Field(
        None,
        description="Когда сотрудник последний раз подтверждал/менял цену",
    )
    stock_quantity: int
    sku: Optional[str]
    brand: Optional[str]
    model: Optional[str]
    color: Optional[str]
    warranty_months: Optional[int]
    attributes: Optional[dict[str, Any]] = Field(
        None,
        description="Произвольные характеристики товара (JSONB)",
    )
    main_image_url: Optional[str]
    condition: str = "new"
    is_active: bool
    is_featured: bool
    category_id: Optional[uuid.UUID]
    group_id: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("main_image_url", mode="after")
    @classmethod
    def normalize_image_url(cls, v: Optional[str]) -> Optional[str]:
        """Нормализует main_image_url. build_url сам разберёт голый ключ / полный
        S3-URL / legacy /static/ и при IMAGE_PROXY вернёт ссылку через наш домен."""
        if not v:
            return v
        from src.app.core.static_service import static_service
        return static_service.build_url(v)


class BulkPriceItem(BaseModel):
    """Одна позиция массового обновления цен.

    Можно передать только id — это «подтверждаю текущую цену»,
    товару лишь проставится price_updated_at. Явный discount_price=null
    сбрасывает скидку (отличаем «не передано» от «передан null»
    через model_fields_set в роутере).
    """
    id: uuid.UUID
    price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    discount_price: Optional[Decimal] = Field(None, gt=0, decimal_places=2)


class BulkPricesIn(BaseModel):
    items: list[BulkPriceItem] = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="Список позиций для обновления/подтверждения цен (до 1000)",
    )


class BulkPricesOut(BaseModel):
    updated: int = Field(..., description="Сколько товаров обновлено/подтверждено")
    not_found: list[uuid.UUID] = Field(
        default_factory=list,
        description="ID из запроса, которых нет в БД (не валят запрос)",
    )


class PriceCommandIn(BaseModel):
    """Команда цен человеческим языком: «наушники apple +2000», «17 pro -1500»,
    «galaxy s26 512 = 89990». Без apply — только предпросмотр."""
    text: str = Field(..., min_length=1, max_length=300, examples=["наушники apple +2000"])
    apply: bool = Field(False, description="Применить к выбранным (product_ids) или ко всем подходящим")
    product_ids: Optional[list[uuid.UUID]] = Field(None, max_length=1000, description="Подмножество из предпросмотра; None = все подошедшие")
    include_inactive: bool = Field(False, description="Захватывать и скрытые товары")


class PriceCommandOperationOut(BaseModel):
    kind: Literal["delta", "percent", "set"]
    value: Decimal
    label: str = Field(..., description="Человеческая подпись: «+2 000 ₽», «−5 %», «= 89 990 ₽»")


class PriceCommandItemOut(BaseModel):
    id: uuid.UUID
    name: str
    color: Optional[str]
    category: Optional[str]
    price: Decimal
    discount_price: Optional[Decimal]
    new_price: Optional[Decimal]
    new_discount_price: Optional[Decimal]
    is_active: bool
    valid: bool = Field(..., description="Можно ли применить (цена не ушла в ноль и т.п.)")
    reason: Optional[str] = None


class PricePreviousOut(BaseModel):
    """Снимок цен до применения — для отката одним запросом в /prices/bulk."""
    id: uuid.UUID
    price: Decimal
    discount_price: Optional[Decimal]


class PriceCommandOut(BaseModel):
    text: str
    operation: Optional[PriceCommandOperationOut]
    filters: dict[str, list[str]] = Field(default_factory=dict, description="Как поняли цель: categories/brands/tokens/exclude")
    include_inactive: bool
    items: list[PriceCommandItemOut]
    total_matched: int
    applied: int = 0
    previous: list[PricePreviousOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ProductDetailOut(ProductOut):
    """Детальное представление товара — со списком изображений, спецификациями и вариантами."""
    images: list[ProductImageOut] = Field(default_factory=list)
    specs_grouped: list[ProductSpecGroupOut] = Field(
        default_factory=list,
        description="Характеристики товара, сгруппированные по group_name",
    )
    variants: list[ProductVariantOut] = Field(
        default_factory=list,
        description="Варианты товара (цвет, память, тип связи и т.д.)",
    )
    siblings: list[ProductGroupSiblingOut] = Field(
        default_factory=list,
        description="Другие карточки в этой группе (для переключения цвета)",
    )
