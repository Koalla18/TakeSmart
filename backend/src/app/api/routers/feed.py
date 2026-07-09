"""
Товарный фид в формате YML (Yandex Market Language).

Отдаётся по адресу /api/v1/feed/yandex.yml — эту ссылку добавляют в
Яндекс.Директ (Библиотека → Фиды) для товарных кампаний и товарной галереи
в поиске. Фид генерируется на лету из живого каталога, поэтому цены и наличие
всегда актуальны.

Документация формата: https://yandex.ru/support/direct/ru/feeds/requirements
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from xml.sax.saxutils import escape

from fastapi import APIRouter
from fastapi.responses import Response

from src.app.core.config import settings
from src.app.core.static_service import static_service
from src.app.database.unit_of_work import UnitOfWork

router = APIRouter(prefix="/feed", tags=["Feed"])

MSK = timezone(timedelta(hours=3))
# Максимальная длина описания в фиде (Яндекс режет длинные, оставляем запас).
_MAX_DESCRIPTION = 3000
# Категория для товаров без назначенной категории (YML требует categoryId у оффера).
_FALLBACK_CATEGORY_ID = 1
_FALLBACK_CATEGORY_NAME = "Товары"


def _fmt_price(value: Decimal) -> str:
    """Целое без копеек (89890), дробное — с двумя знаками (89890.50)."""
    if value == value.to_integral_value():
        return str(int(value))
    return f"{value:.2f}"


def _abs_image(raw: str | None) -> str | None:
    """Абсолютный публичный URL картинки для фида.

    build_url отдаёт: прямой S3-URL (доступен роботу Яндекса), либо корневой
    путь фронта (/iphone-17-pro.png), либо внешний http-URL. Относительные пути
    достраиваем до полного адреса витрины."""
    if not raw:
        return None
    url = static_service.build_url(raw)
    if url.startswith("http"):
        return url
    if url.startswith("/"):
        return settings.PUBLIC_SITE_URL.rstrip("/") + url
    return url


def _build_yml(products) -> str:
    base = settings.PUBLIC_SITE_URL.rstrip("/")

    # Сквозная нумерация категорий: UUID → целочисленный id для YML.
    categories: dict[object, tuple[int, str]] = {}
    next_id = _FALLBACK_CATEGORY_ID + 1
    for p in products:
        if p.category and p.category.id not in categories:
            categories[p.category.id] = (next_id, p.category.name)
            next_id += 1

    out: list[str] = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>')
    out.append(f'<yml_catalog date="{datetime.now(MSK).strftime("%Y-%m-%d %H:%M")}">')
    out.append("  <shop>")
    out.append("    <name>Take Smart</name>")
    out.append("    <company>Take Smart</company>")
    out.append(f"    <url>{escape(base)}</url>")
    out.append("    <currencies>")
    out.append('      <currency id="RUB" rate="1"/>')
    out.append("    </currencies>")
    out.append("    <categories>")
    out.append(f'      <category id="{_FALLBACK_CATEGORY_ID}">{escape(_FALLBACK_CATEGORY_NAME)}</category>')
    for cid, name in categories.values():
        out.append(f'      <category id="{cid}">{escape(name)}</category>')
    out.append("    </categories>")
    out.append("    <offers>")

    for p in products:
        price = p.discount_price if p.discount_price is not None else p.price
        if price is None or price <= 0:
            continue  # без цены товар в фид не берём

        available = "true" if (p.stock_quantity or 0) > 0 else "false"
        cat_id = (
            categories[p.category.id][0]
            if (p.category and p.category.id in categories)
            else _FALLBACK_CATEGORY_ID
        )

        out.append(f'      <offer id="{p.id}" available="{available}">')
        out.append(f"        <url>{escape(base)}/product/{escape(p.slug)}</url>")
        out.append(f"        <price>{_fmt_price(price)}</price>")
        if p.discount_price is not None and p.price and p.price > p.discount_price:
            out.append(f"        <oldprice>{_fmt_price(p.price)}</oldprice>")
        out.append("        <currencyId>RUB</currencyId>")
        out.append(f"        <categoryId>{cat_id}</categoryId>")

        picture = _abs_image(p.main_image_url)
        if picture:
            out.append(f"        <picture>{escape(picture)}</picture>")

        out.append(f"        <name>{escape(p.name)}</name>")
        if p.brand:
            out.append(f"        <vendor>{escape(p.brand)}</vendor>")
        if p.model:
            out.append(f"        <model>{escape(p.model)}</model>")

        description = p.short_description or p.description
        if description:
            out.append(f"        <description>{escape(description[:_MAX_DESCRIPTION])}</description>")
        if p.warranty_months:
            out.append(f"        <sales_notes>Гарантия {p.warranty_months} мес.</sales_notes>")

        out.append("      </offer>")

    out.append("    </offers>")
    out.append("  </shop>")
    out.append("</yml_catalog>")
    return "\n".join(out)


@router.get("/yandex.yml", summary="Товарный фид YML для Яндекс.Директа")
async def yandex_feed() -> Response:
    async with UnitOfWork() as uow:
        products = await uow.products.list_for_feed()
    xml = _build_yml(products)
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={"Cache-Control": "public, max-age=3600"},
    )
