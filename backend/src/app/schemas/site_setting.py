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


class SettingUpdateIn(BaseModel):
    value: Any = Field(..., description="Новое значение (тип проверяется по ключу)")
