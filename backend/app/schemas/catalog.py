from datetime import datetime

from pydantic import BaseModel, Field
from pydantic.config import ConfigDict


class CategoryBase(BaseModel):
    name: str = Field(..., description="Название категории")
    slug: str = Field(..., description="Слаг категории")
    parent_id: int | None = Field(None, description="Родительская категория")


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, description="Название категории")
    slug: str | None = Field(None, description="Слаг категории")
    parent_id: int | None = Field(None, description="Родительская категория")


class CategoryRead(CategoryBase):
    id: int = Field(..., description="ID категории")

    model_config = ConfigDict(from_attributes=True)


class BrandBase(BaseModel):
    name: str = Field(..., description="Название бренда")
    slug: str = Field(..., description="Слаг бренда")


class BrandCreate(BrandBase):
    pass


class BrandUpdate(BaseModel):
    name: str | None = Field(None, description="Название бренда")
    slug: str | None = Field(None, description="Слаг бренда")


class BrandRead(BrandBase):
    id: int = Field(..., description="ID бренда")

    model_config = ConfigDict(from_attributes=True)


class ProductImageBase(BaseModel):
    url: str = Field(..., description="URL изображения")
    is_main: bool = Field(False, description="Главное изображение")
    sort_order: int = Field(0, description="Порядок сортировки")


class ProductImageCreate(ProductImageBase):
    pass


class ProductImageRead(ProductImageBase):
    id: int = Field(..., description="ID изображения")

    model_config = ConfigDict(from_attributes=True)


class ProductSpecBase(BaseModel):
    key: str = Field(..., description="Название характеристики")
    value: str = Field(..., description="Значение характеристики")


class ProductSpecCreate(ProductSpecBase):
    pass


class ProductSpecRead(ProductSpecBase):
    id: int = Field(..., description="ID характеристики")

    model_config = ConfigDict(from_attributes=True)


class ProductBase(BaseModel):
    name: str = Field(..., description="Название товара")
    slug: str = Field(..., description="Слаг товара")
    description: str | None = Field(None, description="Описание товара")
    price: float = Field(..., description="Цена")
    currency: str = Field("RUB", description="Валюта")
    stock: int = Field(0, description="Остаток")
    is_active: bool = Field(True, description="Товар активен")
    brand_id: int | None = Field(None, description="ID бренда")
    category_id: int | None = Field(None, description="ID категории")
    name_embedding: list[float] | None = Field(None, description="Вектор названия")


class ProductCreate(ProductBase):
    images: list[ProductImageCreate] = Field(default_factory=list, description="Изображения")
    specs: list[ProductSpecCreate] = Field(default_factory=list, description="Характеристики")


class ProductUpdate(BaseModel):
    name: str | None = Field(None, description="Название товара")
    slug: str | None = Field(None, description="Слаг товара")
    description: str | None = Field(None, description="Описание товара")
    price: float | None = Field(None, description="Цена")
    currency: str | None = Field(None, description="Валюта")
    stock: int | None = Field(None, description="Остаток")
    is_active: bool | None = Field(None, description="Товар активен")
    brand_id: int | None = Field(None, description="ID бренда")
    category_id: int | None = Field(None, description="ID категории")
    name_embedding: list[float] | None = Field(None, description="Вектор названия")
    images: list[ProductImageCreate] | None = Field(None, description="Изображения")
    specs: list[ProductSpecCreate] | None = Field(None, description="Характеристики")


class ProductRead(ProductBase):
    id: int = Field(..., description="ID товара")
    created_at: datetime = Field(..., description="Дата создания")
    updated_at: datetime = Field(..., description="Дата обновления")
    images: list[ProductImageRead] = Field(default_factory=list, description="Изображения")
    specs: list[ProductSpecRead] = Field(default_factory=list, description="Характеристики")

    model_config = ConfigDict(from_attributes=True)


class ProductSearchVector(BaseModel):
    vector: list[float] = Field(..., description="Вектор для поиска")
    limit: int = Field(20, ge=1, le=100, description="Лимит результатов")

