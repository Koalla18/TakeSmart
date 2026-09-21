from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PublicSettingsOut(BaseModel):
    """Настройки витрины, которые читает сайт. Дефолты — когда ключ ещё не сохранён."""
    preorder_section_enabled: bool = Field(
        True, description="Показывать раздел «Предзаказ» на сайте (меню, блок на главной, /preorder)"
    )
    preorder_in_catalog: bool = Field(
        False, description="Показывать предзаказные товары и в общем каталоге, а не только в разделе"
    )
    new_models_feed_query: str = Field(
        "iphone 18, watch series 12, watch se 3, airpods pro 3, airpods max usb-c (2026)",
        max_length=500,
        description=(
            "Какие модели считать новинками в фиде /feed/yandex-new.yml — фразы через запятую; "
            "фраза ищется в названии целиком, слово за словом (по границам слов). "
            "Предзаказные товары попадают всегда."
        ),
    )


class SettingUpdateIn(BaseModel):
    value: Any = Field(..., description="Новое значение (тип проверяется по ключу)")
