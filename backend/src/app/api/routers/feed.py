"""
Товарный фид в формате YML (Yandex Market Language).

Отдаётся по адресу /api/v1/feed/yandex.yml — эту ссылку добавляют в
Яндекс.Директ (Библиотека → Фиды) для товарных кампаний и товарной галереи
в поиске. Фид генерируется на лету из живого каталога, поэтому цены и наличие
всегда актуальны.

Документация формата: https://yandex.ru/support/direct/ru/feeds/requirements
"""
from __future__ import annotations

import hashlib
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import quote
from xml.sax.saxutils import escape

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from PIL import Image

from src.app.core.config import settings
from src.app.core.logger import get_logger
from src.app.core.static_service import static_service
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.site_setting import PublicSettingsOut

logger = get_logger(__name__)

router = APIRouter(prefix="/feed", tags=["Feed"])

MSK = timezone(timedelta(hours=3))
# Максимальная длина описания в фиде (Яндекс режет длинные, оставляем запас).
_MAX_DESCRIPTION = 3000
# Категория для товаров без назначенной категории (YML требует categoryId у оффера).
_FALLBACK_CATEGORY_ID = 1
_FALLBACK_CATEGORY_NAME = "Товары"

# ─── Нормализация картинок под требования Яндекса ────────────────────────────
# Директ отбраковывает фото меньше 450px по стороне. Дополняем каждое фото до
# белого квадрата (совпадает с рекомендацией «товар на белом фоне») со стороной
# не меньше 450 и отдаём JPEG. Результат кэшируем в S3 (feed/<hash>.jpg), чтобы
# обрабатывать каждое фото один раз и не грузить сервер на каждый обход робота.
_MIN_SIDE = 450          # минимум Яндекса по каждой стороне
_UPSCALE_MIN = 500       # мелкие фото апскейлим до этого по меньшей стороне (запас над 450)
_MAX_UPSCALE = 2.0       # но не более чем в 2x, чтобы не мылить сильно
_MAX_SIDE = 2000         # верхняя граница, чтобы не раздувать вес/память
_JPEG_QUALITY = 88
_IMG_VERSION = 2         # версия обработки: меняем → и URL, и кэш-ключ обновляются, Яндекс перекачивает
_FEED_IMG_CACHE_PREFIX = f"feed/v{_IMG_VERSION}"
_WHITE = (255, 255, 255)


_RU_MONTHS = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)


def _preorder_sales_note(p) -> str:
    """Подпись предзаказа для <sales_notes>: подпись сотрудника важнее даты.
    Лимит Яндекса — 50 символов: не влезает — остаётся короткое «Предзаказ»."""
    base = "Предзаказ"
    detail = (getattr(p, "preorder_note", None) or "").strip()
    if not detail and getattr(p, "preorder_expected_at", None):
        d = p.preorder_expected_at
        detail = f"Ожидается {d.day} {_RU_MONTHS[d.month - 1]}"
    if detail and detail.lower().startswith("предзаказ"):
        candidate = detail
    elif detail:
        candidate = f"{base}. {detail}"
    else:
        candidate = base
    return candidate if len(candidate) <= 50 else base


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


def _picture_url(base: str, raw: str | None) -> str | None:
    """URL картинки для тега <picture>.

    Фото товаров (ключ products/...) пропускаем через нормализатор /feed/img —
    он гарантирует ≥450px и белый квадрат (иначе Яндекс их отбраковывает).
    Ассеты фронта / внешние URL отдаём как есть."""
    if not raw:
        return None
    bare = static_service.bare_key(raw)
    if bare and bare.startswith(settings.PRODUCTS_IMAGES_DIR + "/"):
        return f"{base}/api/v1/feed/img?key={quote(bare, safe='/')}&v={_IMG_VERSION}"
    return _abs_image(raw)


def _normalize_image(data: bytes) -> bytes:
    """Дополняет фото до белого квадрата со стороной ≥450px, отдаёт JPEG-байты."""
    with Image.open(io.BytesIO(data)) as im:
        im.load()
        # Прозрачность/палитра → плоский RGB на белом фоне.
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            flat = Image.new("RGB", rgba.size, _WHITE)
            flat.paste(rgba, mask=rgba.split()[-1])
            im = flat
        else:
            im = im.convert("RGB")

        w, h = im.size
        # Мелкие фото апскейлим, чтобы карточка была чёткой и с запасом над 450px
        # (не более чем в _MAX_UPSCALE раз — иначе сильно мылит).
        if min(w, h) < _UPSCALE_MIN:
            scale = min(_UPSCALE_MIN / min(w, h), _MAX_UPSCALE)
            if scale > 1.0:
                im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
                w, h = im.size
        # Слишком большие — ужимаем, чтобы квадрат не раздувал вес.
        if max(w, h) > _MAX_SIDE:
            im.thumbnail((_MAX_SIDE, _MAX_SIDE), Image.LANCZOS)
            w, h = im.size

        side = max(w, h, _MIN_SIDE)
        canvas = Image.new("RGB", (side, side), _WHITE)
        canvas.paste(im, ((side - w) // 2, (side - h) // 2))

        out = io.BytesIO()
        canvas.save(out, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
        return out.getvalue()


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

        # Предзаказ можно заказать без остатка на складе — для Директа он «в наличии»,
        # иначе новинки не показываются в объявлениях
        is_preorder = bool(getattr(p, "is_preorder", False))
        available = "true" if (is_preorder or (p.stock_quantity or 0) > 0) else "false"
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

        picture = _picture_url(base, p.main_image_url)
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
        if is_preorder:
            out.append(f"        <sales_notes>{escape(_preorder_sales_note(p))}</sales_notes>")
        elif p.warranty_months:
            out.append(f"        <sales_notes>Гарантия {p.warranty_months} мес.</sales_notes>")

        out.append("      </offer>")

    out.append("    </offers>")
    out.append("  </shop>")
    out.append("</yml_catalog>")
    return "\n".join(out)


@router.get("/yandex.yml", summary="Товарный фид YML для Яндекс.Директа")
async def yandex_feed(
    slugs: str | None = Query(
        None,
        description="Опционально: только эти товары (slug через запятую) — для точечного фида под отдельную кампанию.",
    ),
) -> Response:
    async with UnitOfWork() as uow:
        products = await uow.products.list_for_feed()

    # Точечный фид: оставляем только выбранные товары, в заданном порядке.
    if slugs:
        wanted = [s.strip().lower() for s in slugs.split(",") if s.strip()]
        by_slug = {p.slug.lower(): p for p in products}
        products = [by_slug[s] for s in wanted if s in by_slug]

    xml = _build_yml(products)
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/yandex-preorder.yml", summary="Фид YML только с предзаказами (новинки) для Яндекс.Директа")
async def yandex_preorder_feed(
    q: str | None = Query(
        None,
        description="Опционально: сузить состав по названию (все слова должны входить), напр. `iphone 18`.",
    ),
) -> Response:
    """Самообновляющийся фид новинок: всё, что сейчас отмечено предзаказом в админке.
    Ссылку добавляют отдельным фидом в Директ под кампанию по новинкам."""
    async with UnitOfWork() as uow:
        products = await uow.products.list_for_feed()

    products = [p for p in products if getattr(p, "is_preorder", False)]
    if q:
        tokens = [t for t in q.lower().split() if t]
        products = [p for p in products if all(t in p.name.lower() for t in tokens)]

    xml = _build_yml(products)
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _parse_model_query(raw: str | None) -> list[list[str]]:
    """«iphone 18, watch series 12» → [["iphone","18"], ["watch","series","12"]]:
    товар — новинка, если ВСЕ слова хотя бы одной фразы входят в его название."""
    phrases: list[list[str]] = []
    for chunk in (raw or "").split(","):
        words = [w for w in chunk.lower().split() if w]
        if words:
            phrases.append(words)
    return phrases


def _matches_new_models(name: str, phrases: list[list[str]]) -> bool:
    low = name.lower()
    return any(all(w in low for w in words) for words in phrases)


@router.get("/yandex-new.yml", summary="Фид YML «Новинки»: предзаказы + новые модели по маске названия")
async def yandex_new_feed(
    q: str | None = Query(
        None,
        description=(
            "Опционально: маска моделей через запятую вместо настройки из админки, "
            "напр. `iphone 18 pro, airpods pro 3`."
        ),
    ),
) -> Response:
    """Общий фид новинок для рекламы: всё, что отмечено предзаказом, ПЛЮС товары,
    в названии которых есть одна из фраз маски (независимо от наличия на складе —
    приехавшие новинки после «Перенести в каталог» из фида не выпадают).
    Маска по умолчанию правится в админке: настройка `new_models_feed_query`."""
    async with UnitOfWork() as uow:
        products = await uow.products.list_for_feed()
        if q is None:
            q = await uow.site_settings.get("new_models_feed_query")
    if q is None:
        q = PublicSettingsOut().new_models_feed_query

    phrases = _parse_model_query(q)
    products = [
        p for p in products
        if getattr(p, "is_preorder", False) or _matches_new_models(p.name, phrases)
    ]
    # Предзаказы первыми (ближайшие даты), затем новинки по имени — стабильный порядок между обходами
    products.sort(key=lambda p: (not getattr(p, "is_preorder", False), p.name.lower()))

    xml = _build_yml(products)
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _process_feed_image(key: str) -> bytes | None:
    """Синхронно (в threadpool): вернуть нормализованный JPEG для фото товара.
    Кэшируется в S3 по хэшу исходного ключа — обработка происходит один раз."""
    cache_key = f"{_FEED_IMG_CACHE_PREFIX}/{hashlib.md5(key.encode()).hexdigest()}.jpg"

    cached, _ = static_service.fetch_object(cache_key)
    if cached:
        return cached

    original, _ = static_service.fetch_object(key)
    if not original:
        return None

    jpeg = _normalize_image(original)  # может бросить — обрабатываем у вызывающего

    try:
        static_service.store_bytes(cache_key, jpeg, "image/jpeg")
    except Exception as exc:  # noqa: BLE001 — кэш необязателен, не валим ответ
        logger.warning("feed_image_cache_failed", key=key, error=str(exc)[:160])

    return jpeg


@router.get("/img", summary="Нормализованное фото товара для фида (≥450px, JPEG)")
async def feed_image(key: str = Query(..., description="S3-ключ фото, напр. products/<id>/<file>.webp")) -> Response:
    # Только наши товарные фото — не даём тянуть произвольные объекты.
    if not key.startswith(settings.PRODUCTS_IMAGES_DIR + "/") or ".." in key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    try:
        jpeg = await run_in_threadpool(_process_feed_image, key)
    except Exception as exc:  # noqa: BLE001 — битый/неподдерживаемый файл
        logger.warning("feed_image_process_failed", key=key, error=str(exc)[:160])
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Bad image")

    if jpeg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=604800"},  # неделя
    )
