"""
SEO витрины: что видят поисковики и превью ссылок в мессенджерах.

Сайт — SPA: без этого модуля любой адрес отдаёт один и тот же index.html с
заголовком «Take Smart — Магазин современной техники», а robots.txt и
sitemap.xml открывали главную. Здесь — единый источник заголовков, описаний и
разметки для каждой страницы:

- GET /seo/head/{path}  — HTML-фрагмент для <head>: title, description,
  canonical, robots, Open Graph, JSON-LD (товар, хлебные крошки, магазин).
- GET /seo/body/{path}  — HTML-фрагмент для <div id="root">: заголовок, цена,
  описание и ссылки на соседние страницы — чтобы робот видел содержимое и
  находил все товары, даже не выполняя JavaScript.
- GET /seo/meta/{path}  — то же, что head, в JSON: сайт обновляет заголовок
  вкладки и мета-теги при переходах внутри SPA.
- GET /seo/sitemap.xml  — карта сайта из живого каталога.

head и body подставляет nginx (SSI) в index.html только для роботов и
сборщиков превью (Яндекс, Google, Telegram, WhatsApp, VK…); покупатели получают
обычный index.html без задержки. Содержимое то же, что показывает сайт.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from decimal import Decimal
from html import escape
from typing import Any
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from src.app.api.routers.feed import _picture_url, ad_safe, clean_name, offer_model
from src.app.api.routers.gta6 import GIFT_NAME, parse_config as parse_gta6_config
from src.app.core.config import settings
from src.app.core.logger import get_logger
from src.app.database.unit_of_work import UnitOfWork

logger = get_logger(__name__)
router = APIRouter(prefix="/seo", tags=["SEO"])

SITE_NAME = "TakeSmart"
CITY = "Москве"
PHONE = "+7 (999) 802-10-22"
PHONE_E164 = "+79998021022"
EMAIL = "takesmart99@gmail.com"
ADDRESS_STREET = "ул. Барклая, д. 10, ТЦ «Багратионовский», павильон А60"
DEFAULT_TITLE = "TakeSmart — магазин техники Apple, Samsung и Sony в Москве"
DEFAULT_DESCRIPTION = (
    "Смартфоны, ноутбуки, планшеты, часы, наушники и игровые консоли с гарантией. "
    "Самовывоз у м. Багратионовская, доставка по Москве за 30 минут и по России. Trade-in и рассрочка."
)
DEFAULT_IMAGE = "/lion.jpg"

# Внутренние разделы — не для поиска
NOINDEX_PREFIXES = ("/admin", "/app", "/login", "/i/", "/cart")
# Короткий кэш: SSI дёргает head и body на каждый заход робота
CACHE_TTL = 300
_cache: dict[str, tuple[float, "PageMeta"]] = {}


def _base() -> str:
    return settings.PUBLIC_SITE_URL.rstrip("/")


def _abs(url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith("http"):
        return url
    return _base() + (url if url.startswith("/") else "/" + url)


def _price(value: Decimal | None) -> str:
    if value is None:
        return ""
    return f"{int(value):,}".replace(",", " ") + " ₽"


def _plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def _sentence(text: str) -> str:
    """Текст с точкой в конце — чтобы описания не слипались."""
    text = " ".join((text or "").split())
    return text if not text or text[-1] in ".!?…" else text + "."


def _clip(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0]
    return cut.rstrip(",.;:—- ") + "…"


@dataclass
class PageMeta:
    title: str = DEFAULT_TITLE
    description: str = DEFAULT_DESCRIPTION
    canonical: str | None = None
    image: str | None = None
    robots: str = "index, follow"
    og_type: str = "website"
    json_ld: list[dict[str, Any]] = field(default_factory=list)
    # Содержимое страницы для робота (уже экранированный HTML)
    body: str = ""
    status: int = 200


# ─── Общие куски разметки ────────────────────────────────────────────────────

def _store_ld() -> dict[str, Any]:
    return {
        "@context": "https://schema.org",
        "@type": "ElectronicsStore",
        "@id": _base() + "/#store",
        "name": SITE_NAME,
        "url": _base() + "/",
        "logo": _abs(DEFAULT_IMAGE),
        "image": _abs(DEFAULT_IMAGE),
        "telephone": PHONE_E164,
        "email": EMAIL,
        "priceRange": "₽₽",
        "address": {
            "@type": "PostalAddress",
            "streetAddress": ADDRESS_STREET,
            "addressLocality": "Москва",
            "addressCountry": "RU",
        },
        "openingHoursSpecification": [{
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            "opens": "10:30",
            "closes": "20:30",
        }],
    }


def _website_ld() -> dict[str, Any]:
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE_NAME,
        "url": _base() + "/",
        "potentialAction": {
            "@type": "SearchAction",
            "target": _base() + "/catalog?q={search_term_string}",
            "query-input": "required name=search_term_string",
        },
    }


def _breadcrumbs_ld(items: list[tuple[str, str]]) -> dict[str, Any]:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": _abs(url)}
            for i, (name, url) in enumerate(items)
        ],
    }


def _availability(p) -> str:
    if getattr(p, "is_preorder", False):
        return "https://schema.org/PreOrder"
    return "https://schema.org/InStock" if (p.stock_quantity or 0) > 0 else "https://schema.org/OutOfStock"


def _product_url(p) -> str:
    return f"/used/{p.slug}" if p.condition == "used" else f"/product/{p.slug}"


def _effective_price(p) -> Decimal | None:
    return p.discount_price if p.discount_price is not None else p.price


def _breadcrumbs_html(items: list[tuple[str, str]]) -> str:
    links = " / ".join(f'<a href="{escape(url)}">{escape(name)}</a>' for name, url in items)
    return f"<nav aria-label=\"Навигация\">{links}</nav>"


def _products_list_html(products, gift_ids: set | None = None, limit: int = 300) -> str:
    rows = []
    for p in products[:limit]:
        price = _price(_effective_price(p))
        gift = f" + {GIFT_NAME} в подарок" if gift_ids and p.id in gift_ids else ""
        rows.append(f'<li><a href="{escape(_product_url(p))}">{escape(clean_name(p.name))}</a> — {escape(price)}{escape(gift)}</li>')
    return "<ul>" + "".join(rows) + "</ul>" if rows else ""


def _site_nav_html(categories) -> str:
    links = [("Каталог", "/catalog"), ("GTA VI и PlayStation 5", "/gta6"), ("Предзаказ новинок", "/preorder"),
             ("Доставка и оплата", "/delivery"), ("Trade-in", "/trade-in"), ("Б/у техника", "/used")]
    links += [(c.name, f"/catalog?category={quote(c.slug)}") for c in categories]
    items = "".join(f'<li><a href="{escape(url)}">{escape(name)}</a></li>' for name, url in links)
    contacts = (
        f"<p>{escape(SITE_NAME)}: г. Москва, {escape(ADDRESS_STREET)}. Ежедневно 10:30–20:30. "
        f'Телефон <a href="tel:{PHONE_E164}">{escape(PHONE)}</a>.</p>'
    )
    return f"<nav aria-label=\"Разделы\"><ul>{items}</ul></nav>{contacts}"


# ─── Страницы ────────────────────────────────────────────────────────────────

async def _build(path: str, query: dict[str, str]) -> PageMeta:
    path = "/" + path.strip("/") if path.strip("/") else "/"
    async with UnitOfWork() as uow:
        categories = await uow.categories.get_active(limit=100)
        nav = _site_nav_html(categories)

        if path.startswith(NOINDEX_PREFIXES):
            title = "Оформление заказа" if path.startswith("/cart") else SITE_NAME
            return PageMeta(title=f"{title} | {SITE_NAME}" if title != SITE_NAME else SITE_NAME,
                            robots="noindex, nofollow", canonical=None, body="")

        gta6 = parse_gta6_config(await uow.site_settings.get("gta6_config"))
        gift_ids = set(gta6.product_ids) if gta6.enabled and gta6.gift_enabled else set()

        # ── Товар ────────────────────────────────────────────────────────────
        if path.startswith("/product/") or path.startswith("/used/"):
            slug = path.split("/", 2)[2]
            p = await uow.products.get_by_slug_with_specs(slug)
            if not p or not p.is_active:
                return PageMeta(title=f"Товар не найден — {SITE_NAME}", robots="noindex, follow", body=nav, status=404)
            url = _product_url(p)
            price = _effective_price(p)
            name = clean_name(p.name)
            gift = p.id in gift_ids
            cat = p.category
            crumbs = [("Главная", "/"), ("Каталог", "/catalog")]
            if cat:
                crumbs.append((cat.name, f"/catalog?category={quote(cat.slug)}"))
            elif p.condition == "used":
                crumbs.append(("Б/у техника", "/used"))
            crumbs.append((name, url))

            used = " б/у" if p.condition == "used" else ""
            title = f"{name}{used} — купить в {CITY}"
            if price:
                title += f" за {_price(price)}"
            title += f" | {SITE_NAME}"
            base_desc = ad_safe(p.short_description or p.description)
            lead = f"{name}{used}"
            if price:
                lead += f" по цене {_price(price)}"
            if gift:
                lead += f" + {GIFT_NAME} в подарок"
            lead += ". "
            if getattr(p, "is_preorder", False):
                lead += "Предзаказ. "
            elif (p.stock_quantity or 0) > 0:
                lead += "В наличии. "
            tail = f"Гарантия{f' {p.warranty_months} мес.' if p.warranty_months else ''}, доставка по Москве и России, самовывоз."
            description = _clip(lead + (_sentence(base_desc) + " " if base_desc else "") + tail, 300)

            gallery = sorted(p.images or [], key=lambda i: (not i.is_main, i.sort_order))[:6]
            images = [_picture_url(_base(), p.main_image_url)] + [_picture_url(_base(), i.file_path) for i in gallery]
            images = list(dict.fromkeys(i for i in images if i))
            offer: dict[str, Any] = {
                "@type": "Offer",
                "url": _abs(url),
                "priceCurrency": "RUB",
                "availability": _availability(p),
                "itemCondition": "https://schema.org/UsedCondition" if p.condition == "used" else "https://schema.org/NewCondition",
                "seller": {"@id": _base() + "/#store"},
            }
            if price:
                offer["price"] = str(int(price)) if price == price.to_integral_value() else f"{price:.2f}"
            product_ld: dict[str, Any] = {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": name,
                "description": _clip(base_desc or description, 1000),
                "image": images,
                "url": _abs(url),
                "offers": offer,
            }
            if p.sku:
                product_ld["sku"] = p.sku
            model = offer_model(p)
            if model:
                product_ld["model"] = model
            if p.brand:
                product_ld["brand"] = {"@type": "Brand", "name": p.brand}
            if cat:
                product_ld["category"] = cat.name

            specs = ""
            if getattr(p, "specs", None):
                rows = "".join(
                    f"<tr><th>{escape(s.name or '')}</th><td>{escape(' '.join(x for x in (s.value, s.unit) if x))}</td></tr>"
                    for s in p.specs[:40]
                )
                specs = f"<h2>Характеристики</h2><table>{rows}</table>" if rows else ""
            status_text = "Предзаказ" if getattr(p, "is_preorder", False) else ("В наличии" if (p.stock_quantity or 0) > 0 else "Нет в наличии")
            body = (
                _breadcrumbs_html(crumbs)
                + f"<article><h1>{escape(name)}</h1>"
                + (f'<img src="{escape(images[0])}" alt="{escape(name)}" width="450" height="450">' if images else "")
                + f"<p><strong>{escape(_price(price))}</strong> · {escape(status_text)}</p>"
                + (f"<p>В подарок к покупке — {escape(GIFT_NAME)}. <a href=\"/gta6\">Подробнее об акции</a></p>" if gift else "")
                + (f"<p>{escape(base_desc)}</p>" if base_desc else "")
                + specs
                + "</article>"
                + nav
            )
            return PageMeta(
                title=title, description=description, canonical=_abs(url), image=images[0] if images else None,
                og_type="product", json_ld=[product_ld, _breadcrumbs_ld(crumbs)], body=body,
            )

        # ── Каталог и категории ──────────────────────────────────────────────
        if path == "/catalog":
            products = await uow.products.list_for_feed()
            cat_slug = (query.get("category") or "").strip()
            cat = next((c for c in categories if c.slug == cat_slug), None) if cat_slug else None
            q = (query.get("q") or "").strip()
            if cat:
                items = [p for p in products if p.category and p.category.id == cat.id]
                prices = [_effective_price(p) for p in items if _effective_price(p)]
                from_price = f" от {_price(min(prices))}" if prices else ""
                title = f"{cat.name} — купить в {CITY}{from_price}, цены и наличие | {SITE_NAME}"
                description = _clip(
                    f"{cat.name} в {SITE_NAME}: {len(items)} {_plural(len(items), 'модель', 'модели', 'моделей')}{from_price}. "
                    "Гарантия магазина, доставка по Москве за 30 минут и по России, самовывоз у м. Багратионовская, "
                    "Trade-in и рассрочка.", 300)
                url = f"/catalog?category={quote(cat.slug)}"
                crumbs = [("Главная", "/"), ("Каталог", "/catalog"), (cat.name, url)]
                item_list = {
                    "@context": "https://schema.org", "@type": "ItemList", "name": cat.name,
                    "itemListElement": [
                        {"@type": "ListItem", "position": i + 1, "url": _abs(_product_url(p)), "name": clean_name(p.name)}
                        for i, p in enumerate(items[:100])
                    ],
                }
                body = (_breadcrumbs_html(crumbs) + f"<h1>{escape(cat.name)}</h1>"
                        + (f"<p>{escape(cat.description)}</p>" if getattr(cat, 'description', None) else "")
                        + _products_list_html(items, gift_ids) + nav)
                return PageMeta(title=title, description=description, canonical=_abs(url),
                                json_ld=[_breadcrumbs_ld(crumbs), item_list], body=body)
            # Поисковая выдача по сайту — не индексируем, но ссылки обходим
            robots = "noindex, follow" if q or query.get("brand") else "index, follow"
            title = f"Каталог техники — смартфоны, ноутбуки, консоли с гарантией | {SITE_NAME}"
            description = _clip(
                f"Каталог {SITE_NAME}: {len(products)} {_plural(len(products), 'товар', 'товара', 'товаров')} — iPhone, Samsung Galaxy, MacBook, iPad, Apple Watch, "
                "AirPods, PlayStation и аксессуары. Доставка по Москве и России, самовывоз, Trade-in.", 300)
            crumbs = [("Главная", "/"), ("Каталог", "/catalog")]
            body = _breadcrumbs_html(crumbs) + "<h1>Каталог техники</h1>" + _products_list_html(products, gift_ids) + nav
            return PageMeta(title=title, description=description, canonical=_abs("/catalog"), robots=robots,
                            json_ld=[_breadcrumbs_ld(crumbs)], body=body)

        # ── GTA VI ───────────────────────────────────────────────────────────
        if path == "/gta6":
            products = await uow.products.list_for_feed()
            by_id = {p.id: p for p in products}
            items = [by_id[i] for i in gta6.product_ids if i in by_id]
            prices = [_effective_price(p) for p in items if _effective_price(p)]
            from_price = f" от {_price(min(prices))}" if prices else ""
            gift = gta6.enabled and gta6.gift_enabled
            title = (f"GTA 6 в подарок к PlayStation 5 — купить PS5{from_price} | {SITE_NAME}" if gift
                     else f"GTA VI и PlayStation 5 — купить PS5{from_price} | {SITE_NAME}")
            description = _clip(
                "Grand Theft Auto VI выходит 19 ноября 2026 на PlayStation 5. "
                + ("Покупайте PS5 Slim или PS5 Pro в TakeSmart — GTA VI дарим. " if gift else "PS5 Slim и PS5 Pro в наличии. ")
                + "Трейлеры, герои, карта Леониды. Доставка по Москве и России, самовывоз.", 300)
            crumbs = [("Главная", "/"), ("GTA VI и PlayStation 5", "/gta6")]
            item_list = {
                "@context": "https://schema.org", "@type": "ItemList", "name": "PlayStation 5 с GTA VI в подарок",
                "itemListElement": [
                    {"@type": "ListItem", "position": i + 1, "url": _abs(_product_url(p)), "name": clean_name(p.name)}
                    for i, p in enumerate(items)
                ],
            }
            body = (
                _breadcrumbs_html(crumbs)
                + "<h1>GTA VI в подарок к PlayStation 5</h1>"
                + "<p>Grand Theft Auto VI выходит 19 ноября 2026 года. Вайс-Сити, штат Леонида, Джейсон и Лусия.</p>"
                + "<h2>PlayStation 5" + (" с игрой в подарок" if gift else "") + "</h2>"
                + _products_list_html(items, gift_ids)
                + nav
            )
            return PageMeta(
                title=title, description=description, canonical=_abs("/gta6"), image=_abs("/gta6-art/hero.webp"),
                robots="index, follow" if gta6.enabled else "noindex, follow",
                json_ld=[_breadcrumbs_ld(crumbs), item_list], body=body,
            )

        # ── Б/у ──────────────────────────────────────────────────────────────
        if path == "/used":
            used = [p for p in await uow.products.get_active(limit=500) if p.condition == "used"]
            crumbs = [("Главная", "/"), ("Б/у техника", "/used")]
            body = _breadcrumbs_html(crumbs) + "<h1>Б/у техника с гарантией</h1>" + _products_list_html(used) + nav
            return PageMeta(
                title=f"Б/у iPhone и техника с гарантией — купить в {CITY} | {SITE_NAME}",
                description="Проверенная б/у техника Apple и Samsung с гарантией магазина. Самовывоз у м. Багратионовская, доставка по Москве и России.",
                canonical=_abs("/used"), json_ld=[_breadcrumbs_ld(crumbs)], body=body,
            )

        # ── Остальные страницы ───────────────────────────────────────────────
        static_pages: dict[str, tuple[str, str, str]] = {
            "/preorder": ("Предзаказ новинок — iPhone, Apple Watch, AirPods", "Предзаказ новинок",
                          "Оформите предзаказ новинок до старта продаж: закрепим устройство за вами и сообщим о поступлении первыми."),
            "/delivery": ("Доставка и оплата", "Доставка и оплата",
                          "Доставка по Москве за 30 минут, по России — почтой и СДЭК. Самовывоз у м. Багратионовская. Оплата наличными, картой, по QR, рассрочка."),
            "/trade-in": ("Trade-in — сдать старый телефон в зачёт нового", "Trade-in",
                          "Оценим ваш смартфон, планшет или часы и зачтём стоимость в покупку нового устройства. Онлайн-калькулятор и оценка в магазине."),
            "/apps": ("Приложения на iPhone, которых нет в App Store", "Приложения на iPhone",
                      "Установим на iPhone банки, маркетплейсы и сервисы, которых больше нет в App Store."),
            "/offer": ("Публичная оферта", "Публичная оферта", "Условия продажи товаров в интернет-магазине TakeSmart."),
            "/privacy-policy": ("Политика конфиденциальности", "Политика конфиденциальности", "Как TakeSmart обрабатывает персональные данные."),
            "/cookie-policy": ("Политика использования cookie", "Политика cookie", "Какие cookie использует сайт TakeSmart."),
            "/personal-data": ("Согласие на обработку персональных данных", "Согласие на обработку персональных данных", "Текст согласия на обработку персональных данных."),
        }
        if path in static_pages:
            title, h1, desc = static_pages[path]
            robots = "index, follow"
            if path == "/preorder":
                enabled = await uow.site_settings.get("preorder_section_enabled")
                robots = "noindex, follow" if enabled is False else robots
            if path == "/apps":
                cfg = await uow.site_settings.get("installs_config")
                robots = "index, follow" if isinstance(cfg, dict) and cfg.get("storefront_enabled") else "noindex, follow"
            if path in ("/offer", "/privacy-policy", "/cookie-policy", "/personal-data"):
                robots = "noindex, follow"
            crumbs = [("Главная", "/"), (h1, path)]
            return PageMeta(
                title=f"{title} | {SITE_NAME}", description=desc, canonical=_abs(path), robots=robots,
                json_ld=[_breadcrumbs_ld(crumbs)],
                body=_breadcrumbs_html(crumbs) + f"<h1>{escape(h1)}</h1><p>{escape(desc)}</p>" + nav,
            )

        # ── Главная ──────────────────────────────────────────────────────────
        if path == "/":
            featured = list(await uow.products.get_featured(limit=24))
            body = (
                "<h1>TakeSmart — магазин техники в Москве</h1>"
                f"<p>{escape(DEFAULT_DESCRIPTION)}</p>"
                + ("<p><a href=\"/gta6\">GTA VI в подарок к PlayStation 5</a></p>" if gta6.enabled else "")
                + "<h2>Популярные товары</h2>" + _products_list_html(featured, gift_ids)
                + nav
            )
            return PageMeta(canonical=_abs("/"), image=_abs(DEFAULT_IMAGE),
                            json_ld=[_store_ld(), _website_ld()], body=body)

        # ── Неизвестный адрес ────────────────────────────────────────────────
        return PageMeta(title=f"Страница не найдена — {SITE_NAME}", robots="noindex, follow", body=nav, status=404)


async def page_meta(path: str, query: dict[str, str]) -> PageMeta:
    # В ключ кэша — только параметры, которые меняют страницу
    relevant = {k: v for k, v in query.items() if k in ("category", "q", "brand")}
    key = path.strip("/") + "?" + urlencode(sorted(relevant.items()))
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < CACHE_TTL:
        return hit[1]
    meta = await _build(path, relevant)
    if len(_cache) > 2000:
        _cache.clear()
    _cache[key] = (now, meta)
    return meta


def _head_html(m: PageMeta) -> str:
    image = m.image or _abs(DEFAULT_IMAGE)
    parts = [
        f"<title>{escape(m.title)}</title>",
        f'<meta name="description" content="{escape(m.description)}" />',
        f'<meta name="robots" content="{escape(m.robots)}" />',
        f'<meta property="og:site_name" content="{SITE_NAME}" />',
        '<meta property="og:locale" content="ru_RU" />',
        f'<meta property="og:type" content="{escape(m.og_type)}" />',
        f'<meta property="og:title" content="{escape(m.title)}" />',
        f'<meta property="og:description" content="{escape(m.description)}" />',
        f'<meta property="og:image" content="{escape(image)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
    ]
    if m.canonical:
        parts.append(f'<link rel="canonical" href="{escape(m.canonical)}" />')
        parts.append(f'<meta property="og:url" content="{escape(m.canonical)}" />')
    for ld in m.json_ld:
        # </script> внутри строки сломал бы разметку
        payload = json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")
        parts.append(f'<script type="application/ld+json">{payload}</script>')
    return "\n    ".join(parts)


_HTML_HEADERS = {"Cache-Control": "public, max-age=120"}


@router.get("/head/{path:path}", response_class=HTMLResponse, include_in_schema=True,
            summary="Фрагмент <head> страницы для роботов (подставляет nginx)")
async def seo_head(path: str, request: Request) -> HTMLResponse:
    m = await page_meta(path, dict(request.query_params))
    return HTMLResponse(_head_html(m), headers=_HTML_HEADERS)


@router.get("/body/{path:path}", response_class=HTMLResponse,
            summary="Содержимое страницы для роботов, без JavaScript (подставляет nginx)")
async def seo_body(path: str, request: Request) -> HTMLResponse:
    m = await page_meta(path, dict(request.query_params))
    return HTMLResponse(m.body, headers=_HTML_HEADERS)


@router.get("/meta/{path:path}", summary="Заголовок и мета-теги страницы (для переходов внутри сайта)")
async def seo_meta(path: str, request: Request) -> JSONResponse:
    m = await page_meta(path, dict(request.query_params))
    return JSONResponse(
        {"title": m.title, "description": m.description, "canonical": m.canonical,
         "robots": m.robots, "image": m.image or _abs(DEFAULT_IMAGE)},
        headers=_HTML_HEADERS,
    )


@router.get("/sitemap.xml", summary="Карта сайта для поисковиков")
async def sitemap() -> Response:
    base = _base()
    urls: list[tuple[str, str | None, str, str]] = []  # (loc, lastmod, changefreq, priority)
    async with UnitOfWork() as uow:
        categories = await uow.categories.get_active(limit=200)
        products = await uow.products.list_for_feed()
        gta6 = parse_gta6_config(await uow.site_settings.get("gta6_config"))
        preorder_enabled = await uow.site_settings.get("preorder_section_enabled")

    urls.append((base + "/", None, "daily", "1.0"))
    urls.append((base + "/catalog", None, "daily", "0.9"))
    if gta6.enabled:
        urls.append((base + "/gta6", None, "daily", "0.9"))
    for c in categories:
        urls.append((f"{base}/catalog?category={quote(c.slug)}", None, "daily", "0.8"))
    if preorder_enabled is not False:
        urls.append((base + "/preorder", None, "weekly", "0.6"))
    for path in ("/delivery", "/trade-in", "/used"):
        urls.append((base + path, None, "monthly", "0.5"))
    for p in products:
        lastmod = p.updated_at.date().isoformat() if getattr(p, "updated_at", None) else None
        urls.append((base + _product_url(p), lastmod, "weekly", "0.7"))

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod, freq, prio in urls:
        lines.append("  <url>")
        lines.append(f"    <loc>{escape(loc)}</loc>")
        if lastmod:
            lines.append(f"    <lastmod>{lastmod}</lastmod>")
        lines.append(f"    <changefreq>{freq}</changefreq>")
        lines.append(f"    <priority>{prio}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return Response("\n".join(lines), media_type="application/xml; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=3600"})
