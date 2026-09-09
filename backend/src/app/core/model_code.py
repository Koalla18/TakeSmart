"""Код модели в конце названия товара.

Владелец пишет код в конце названия: «… серебристый (Silver) (MDE54)». Правило одно
на всю систему — панель «Цены» на фронте (lib/modelCode.ts) и data-миграция
v2w3x4y5z6a7 повторяют его дословно: последняя скобочная группа из латиницы,
цифр, дефиса и слэша длиной 3–12 символов, минимум одна цифра и хотя бы одна
буква или дефис. Так «(MDE54)» и «(492747-01)» — код, а «(2024)» (год) и
«(Silver)» (цвет) — нет.
"""
from __future__ import annotations

import re

CODE_TAIL = re.compile(r"\s*\(([A-Z0-9][A-Z0-9/-]{2,11})\)\s*$")


def code_from_name(name: str | None) -> str | None:
    if not name:
        return None
    m = CODE_TAIL.search(name.rstrip())
    if not m:
        return None
    code = m.group(1)
    if not re.search(r"\d", code) or not re.search(r"[A-Z-]", code):
        return None
    return code


def strip_model_code(name: str | None) -> str:
    """Название без кода в конце (если код там есть)."""
    if not name:
        return ""
    if code_from_name(name) is None:
        return name.strip()
    return CODE_TAIL.sub("", name.rstrip()).rstrip()
