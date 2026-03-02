from __future__ import annotations

import uuid
from collections.abc import Callable, Coroutine
from typing import Any

from slugify import slugify


def generate_slug(text: str, *, suffix: bool = False) -> str:
    """
    Генерирует URL-safe slug из произвольного текста.
    Поддерживает кириллицу, спецсимволы, пробелы.

    Args:
        text:   Исходный текст (название товара, категории и т.д.)
        suffix: Если True — добавляет короткий UUID-суффикс для гарантии уникальности.

    Examples:
        "iPhone 16 Pro"        → "iphone-16-pro"
        "Смартфоны"            → "smartfony"
        "Apple iPhone 16 Pro"  → "apple-iphone-16-pro--a3f1" (suffix=True)
    """
    base = slugify(text, separator="-", lowercase=True, allow_unicode=False)

    if not base:
        # Крайний случай: текст состоит только из спецсимволов
        base = "item"

    if suffix:
        short = uuid.uuid4().hex[:6]
        return f"{base}--{short}"

    return base


def generate_unique_slug(text: str) -> str:
    """Всегда возвращает slug с UUID-суффиксом — гарантированно уникален."""
    return generate_slug(text, suffix=True)


# Тип: async-функция (slug, exclude_id?) -> bool
SlugExistsFunc = Callable[..., Coroutine[Any, Any, bool]]


async def build_unique_slug(
    text: str,
    slug_exists: SlugExistsFunc,
    *,
    exclude_id: Any = None,
    max_attempts: int = 10,
) -> str:
    """
    Генерирует slug из *text* и проверяет его уникальность через *slug_exists*.
    Если базовый slug занят — добавляет случайный суффикс и повторяет.

    Args:
        text:         Исходный текст (name товара / категории).
        slug_exists:  Async-функция репозитория: slug_exists(slug, exclude_id=...) -> bool.
        exclude_id:   UUID текущего объекта (при обновлении, чтобы не конфликтовать с собой).
        max_attempts: Максимальное число попыток подбора (по умолчанию 10).

    Returns:
        Уникальный slug, готовый для сохранения в БД.

    Raises:
        RuntimeError: Если за max_attempts попыток не удалось подобрать уникальный slug.

    Examples:
        slug = await build_unique_slug("Смартфоны", uow.categories.slug_exists)
        # → "smartfony"  (если свободен)
        # → "smartfony--a3f1c2"  (если "smartfony" занят)
    """
    # Первая попытка — чистый slug без суффикса
    candidate = generate_slug(text, suffix=False)
    if not await slug_exists(candidate, exclude_id=exclude_id):
        return candidate

    # Последующие попытки — с уникальным суффиксом
    for _ in range(max_attempts - 1):
        candidate = generate_slug(text, suffix=True)
        if not await slug_exists(candidate, exclude_id=exclude_id):
            return candidate

    raise RuntimeError(
        f"Не удалось сгенерировать уникальный slug для '{text}' "
        f"за {max_attempts} попыток."
    )
