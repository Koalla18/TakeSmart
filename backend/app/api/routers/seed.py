from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session
from ...repositories.category import CategoryRepository
from ...repositories.product import ProductRepository

router = APIRouter(prefix="/api/admin", tags=["seed"])


@router.post("/seed", status_code=201, summary="Seed database (admin)")
async def seed_database(
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    categories_data = [
        {"slug": "smartphones", "name": "Смартфоны", "description": "iPhone, Samsung, Xiaomi", "icon": "📱", "sort_order": 1},
        {"slug": "laptops", "name": "Ноутбуки", "description": "MacBook, Dell, HP", "icon": "💻", "sort_order": 2},
        {"slug": "tablets", "name": "Планшеты", "description": "iPad, Samsung Tab", "icon": "📱", "sort_order": 3},
        {"slug": "headphones", "name": "Наушники", "description": "AirPods, Sony, JBL", "icon": "🎧", "sort_order": 4},
        {"slug": "watches", "name": "Часы", "description": "Apple Watch, Samsung", "icon": "⌚", "sort_order": 5},
        {"slug": "accessories", "name": "Аксессуары", "description": "Чехлы, зарядки, кабели", "icon": "🔌", "sort_order": 6},
        {"slug": "gaming", "name": "Игровые консоли", "description": "PlayStation, Nintendo", "icon": "🎮", "sort_order": 7},
        {"slug": "tv", "name": "ТВ и аудио", "description": "Samsung, LG, Sony", "icon": "📺", "sort_order": 8},
    ]

    created_categories: dict[str, int] = {}
    for cat_data in categories_data:
        existing = await CategoryRepository.get_by_slug(db, cat_data["slug"])
        if not existing:
            cat = await CategoryRepository.create(db, cat_data)
            created_categories[cat_data["slug"]] = cat.id
        else:
            created_categories[cat_data["slug"]] = existing.id

    products_data = [
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-natural",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 124990,
            "old_price": 139990,
            "badge": "hit",
            "in_stock": True,
            "is_featured": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "натуральный титан",
            "color_code": "#8B8378",
            "storage": "256 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1,
        },
        {
            "name": "iPhone 15 Pro Max 512 ГБ",
            "slug": "iphone-15-pro-max-512gb-natural",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 144990,
            "old_price": 159990,
            "in_stock": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "натуральный титан",
            "color_code": "#8B8378",
            "storage": "512 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "512 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1,
        },
    ]

    for product_data in products_data:
        existing = await ProductRepository.get_by_slug(db, product_data["slug"], active_only=False)
        if not existing:
            await ProductRepository.create(db, product_data)

    return {"ok": True}

