from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field, field_validator

from src.app.schemas.product import ProductOut

# Места под картинки на странице /gta6. Пока своя картинка не загружена, в блоке
# стоит стандартный официальный арт, который лежит в статике сайта (public/gta6).
IMAGE_SLOTS: tuple[str, ...] = (
    "hero", "promo", "story", "jason", "lucia",
    "vice_city", "keys", "grassrivers", "port_gellhorn", "ambrosia", "kalaga", "finale",
)

MAX_PRODUCTS = 60


class Gta6Config(BaseModel):
    """Настройки страницы GTA VI: показ на сайте, подарок и состав товаров."""
    enabled: bool = False        # страница /gta6 открыта покупателям
    menu_link: bool = True       # выделенный пункт «GTA VI» в меню сайта
    home_banner: bool = True     # блок-анонс на главной
    gift_enabled: bool = True    # показывать «игра в подарок» на странице и карточках
    gift_title: str = Field("", max_length=120)   # пусто — стандартный заголовок
    gift_text: str = Field("", max_length=600)    # пусто — стандартные условия
    # Свой главный ролик (YouTube / RuTube / VK Видео / прямая ссылка на mp4); пусто — официальные трейлеры с YouTube
    trailer_url: str = Field("", max_length=300)
    product_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_PRODUCTS)
    images: dict[str, str] = Field(default_factory=dict)

    @field_validator("trailer_url")
    @classmethod
    def _https_only(cls, v: str) -> str:
        if v and not v.startswith("https://"):
            raise ValueError("Ссылка на ролик должна начинаться с https://")
        return v

    @field_validator("gift_title", "gift_text", "trailer_url", mode="before")
    @classmethod
    def _strip_text(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v

    @field_validator("product_ids")
    @classmethod
    def _unique_ids(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        return list(dict.fromkeys(v))

    @field_validator("images")
    @classmethod
    def _known_slots(cls, v: dict[str, str]) -> dict[str, str]:
        return {k: s for k, s in v.items() if k in IMAGE_SLOTS and isinstance(s, str) and s and len(s) <= 1000}


class Gta6PageOut(BaseModel):
    """То, что читает страница /gta6: настройки и карточки товаров в заданном порядке."""
    enabled: bool
    gift_enabled: bool
    gift_title: str
    gift_text: str
    trailer_url: str = ""
    images: dict[str, str]
    products: list[ProductOut]


class Gta6ImageOut(BaseModel):
    slot: str
    url: str
