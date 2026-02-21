from __future__ import annotations

from typing import Any

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

    created_categories: dict[str, Any] = {}
    for cat_data in categories_data:
        existing = await CategoryRepository.get_by_slug(db, cat_data["slug"])
        if not existing:
            cat = await CategoryRepository.create(db, cat_data)
            created_categories[cat_data["slug"]] = cat.id
        else:
            created_categories[cat_data["slug"]] = existing.id

    products_data = [
        # === SMARTPHONES ===
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
            "image": "/products/phone/apple/iphone-15-pro-natural-titanium.png",
            "images": ["/products/phone/apple/iphone-15-pro-natural-titanium.png"],
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
            "name": "iPhone 15 Pro 128 ГБ",
            "slug": "iphone-15-pro-128gb",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 109990,
            "badge": "new",
            "in_stock": True,
            "is_featured": True,
            "color": "чёрный титан",
            "color_code": "#3C3C3C",
            "storage": "128 ГБ",
            "image": "/products/phone/apple/Iphone-15-pro-Black-Titanium.png",
            "images": ["/products/phone/apple/Iphone-15-pro-Black-Titanium.png"],
            "description": "Компактный флагман с титановым дизайном и Action Button.",
            "specs": [
                {"label": "Дисплей", "value": "6.1\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "128 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 2,
        },
        {
            "name": "iPhone 14 128 ГБ",
            "slug": "iphone-14-128gb",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 69990,
            "old_price": 79990,
            "badge": "sale",
            "in_stock": True,
            "image": "/products/phone/apple/iphone-14.jpg",
            "images": ["/products/phone/apple/iphone-14.jpg"],
            "description": "Отличный выбор для тех, кто хочет получить премиальное качество Apple по доступной цене.",
            "specs": [
                {"label": "Дисплей", "value": "6.1\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A15 Bionic"},
                {"label": "Память", "value": "128 ГБ"},
            ],
            "sort_order": 3,
        },
        {
            "name": "iPhone 17 Pro",
            "slug": "iphone-17-pro",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 154990,
            "badge": "new",
            "in_stock": True,
            "is_featured": True,
            "image": "/products/phone/apple/iphone-17-pro.png",
            "images": ["/products/phone/apple/iphone-17-pro.png"],
            "description": "Новейший iPhone 17 Pro с улучшенным чипом и камерой нового поколения.",
            "specs": [
                {"label": "Дисплей", "value": "6.3\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A19 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 48 Мп + 12 Мп"},
            ],
            "sort_order": 4,
        },
        {
            "name": "Samsung Galaxy S25 Ultra",
            "slug": "samsung-galaxy-s25-ultra",
            "brand": "Samsung",
            "category_id": created_categories.get("smartphones"),
            "price": 114990,
            "in_stock": True,
            "is_featured": True,
            "image": "/products/phone/samsung/samsung-galaxy-s25.png",
            "images": ["/products/phone/samsung/samsung-galaxy-s25.png"],
            "description": "Флагман Samsung с Galaxy AI, S Pen и революционной камерой 200 Мп.",
            "specs": [
                {"label": "Дисплей", "value": "6.9\" Dynamic AMOLED 2X"},
                {"label": "Процессор", "value": "Snapdragon 8 Elite"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "200 Мп"},
            ],
            "sort_order": 5,
        },
        {
            "name": "Xiaomi 15",
            "slug": "xiaomi-15",
            "brand": "Xiaomi",
            "category_id": created_categories.get("smartphones"),
            "price": 79990,
            "badge": "new",
            "in_stock": True,
            "image": "/products/phone/xiaomi/Xiaomi-15.png",
            "images": ["/products/phone/xiaomi/Xiaomi-15.png"],
            "description": "Флагман Xiaomi с камерой Leica и чипом Snapdragon 8 Elite.",
            "specs": [
                {"label": "Дисплей", "value": "6.36\" AMOLED"},
                {"label": "Процессор", "value": "Snapdragon 8 Elite"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "Leica 50 Мп"},
            ],
            "sort_order": 6,
        },
        # === LAPTOPS ===
        {
            "name": "MacBook Pro 14\" M3 Pro",
            "slug": "macbook-pro-14-m3-pro",
            "brand": "Apple",
            "category_id": created_categories.get("laptops"),
            "price": 249990,
            "badge": "new",
            "in_stock": True,
            "is_featured": True,
            "image": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mbp14-spacegray-select-202310?wid=800&hei=800&fmt=jpeg&qlt=90",
            "images": ["https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mbp14-spacegray-select-202310?wid=800&hei=800&fmt=jpeg&qlt=90"],
            "description": "Профессиональный ноутбук с чипом M3 Pro и дисплеем Liquid Retina XDR.",
            "specs": [
                {"label": "Дисплей", "value": "14.2\" Liquid Retina XDR"},
                {"label": "Процессор", "value": "Apple M3 Pro"},
                {"label": "Память", "value": "18 ГБ / 512 ГБ SSD"},
                {"label": "Автономность", "value": "до 17 часов"},
            ],
            "sort_order": 1,
        },
        {
            "name": "MacBook Air 15\" M3",
            "slug": "macbook-air-15-m3",
            "brand": "Apple",
            "category_id": created_categories.get("laptops"),
            "price": 179990,
            "in_stock": True,
            "image": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mba15-midnight-select-202306?wid=800&hei=800&fmt=jpeg&qlt=90",
            "images": ["https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mba15-midnight-select-202306?wid=800&hei=800&fmt=jpeg&qlt=90"],
            "description": "Самый тонкий 15-дюймовый ноутбук в мире с чипом M3.",
            "specs": [
                {"label": "Дисплей", "value": "15.3\" Liquid Retina"},
                {"label": "Процессор", "value": "Apple M3"},
                {"label": "Память", "value": "8 ГБ / 256 ГБ SSD"},
            ],
            "sort_order": 2,
        },
        # === TABLETS ===
        {
            "name": "iPad Pro 12.9\" M2",
            "slug": "ipad-pro-12-m2",
            "brand": "Apple",
            "category_id": created_categories.get("tablets"),
            "price": 139990,
            "in_stock": True,
            "is_featured": True,
            "image": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/ipad-pro-13-select-wifi-spacegray-202210?wid=800&hei=800&fmt=jpeg&qlt=90",
            "images": ["https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/ipad-pro-13-select-wifi-spacegray-202210?wid=800&hei=800&fmt=jpeg&qlt=90"],
            "description": "Самый мощный iPad с чипом M2 и дисплеем Liquid Retina XDR.",
            "specs": [
                {"label": "Дисплей", "value": "12.9\" Liquid Retina XDR"},
                {"label": "Процессор", "value": "Apple M2"},
                {"label": "Память", "value": "256 ГБ"},
            ],
            "sort_order": 1,
        },
        # === HEADPHONES ===
        {
            "name": "AirPods Pro 2",
            "slug": "airpods-pro-2",
            "brand": "Apple",
            "category_id": created_categories.get("headphones"),
            "price": 24990,
            "old_price": 29990,
            "badge": "sale",
            "in_stock": True,
            "image": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MQD83?wid=800&hei=800&fmt=jpeg&qlt=90",
            "images": ["https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MQD83?wid=800&hei=800&fmt=jpeg&qlt=90"],
            "description": "Беспроводные наушники с активным шумоподавлением и пространственным аудио.",
            "specs": [
                {"label": "Тип", "value": "Внутриканальные TWS"},
                {"label": "Шумоподавление", "value": "Активное (ANC)"},
                {"label": "Время работы", "value": "6 ч (30 ч с кейсом)"},
            ],
            "sort_order": 1,
        },
        {
            "name": "AirPods Max",
            "slug": "airpods-max",
            "brand": "Apple",
            "category_id": created_categories.get("headphones"),
            "price": 59990,
            "in_stock": True,
            "image": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/airpods-max-hero-select-202011_FMT_WHH?wid=800&hei=800&fmt=jpeg&qlt=90",
            "images": ["https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/airpods-max-hero-select-202011_FMT_WHH?wid=800&hei=800&fmt=jpeg&qlt=90"],
            "description": "Премиальные накладные наушники с невероятным звуком.",
            "specs": [
                {"label": "Тип", "value": "Накладные"},
                {"label": "Шумоподавление", "value": "Активное (ANC)"},
                {"label": "Время работы", "value": "до 20 часов"},
            ],
            "sort_order": 2,
        },
        {
            "name": "Sony WH-1000XM5",
            "slug": "sony-wh-1000xm5",
            "brand": "Sony",
            "category_id": created_categories.get("headphones"),
            "price": 39990,
            "old_price": 44990,
            "badge": "hit",
            "in_stock": True,
            "image": "/products/headphones/sony/sony-wh-1000xm5-black.png",
            "images": ["/products/headphones/sony/sony-wh-1000xm5-black.png"],
            "description": "Лучшие наушники с шумоподавлением от Sony.",
            "specs": [
                {"label": "Тип", "value": "Накладные"},
                {"label": "Шумоподавление", "value": "Активное (ANC)"},
                {"label": "Время работы", "value": "до 30 часов"},
            ],
            "sort_order": 3,
        },
        {
            "name": "Samsung Galaxy Buds3 Pro",
            "slug": "samsung-galaxy-buds3-pro",
            "brand": "Samsung",
            "category_id": created_categories.get("headphones"),
            "price": 21990,
            "badge": "new",
            "in_stock": True,
            "image": "/products/headphones/samsung/Samsung-Galaxy-Buds3.png",
            "images": ["/products/headphones/samsung/Samsung-Galaxy-Buds3.png"],
            "description": "Премиальные TWS-наушники Samsung с Galaxy AI.",
            "specs": [
                {"label": "Тип", "value": "Внутриканальные TWS"},
                {"label": "Шумоподавление", "value": "Активное (ANC)"},
                {"label": "Время работы", "value": "7 ч"},
            ],
            "sort_order": 4,
        },
        # === WATCHES ===
        {
            "name": "Apple Watch Ultra 3",
            "slug": "apple-watch-ultra-3",
            "brand": "Apple",
            "category_id": created_categories.get("watches"),
            "price": 84990,
            "badge": "new",
            "in_stock": True,
            "is_featured": True,
            "image": "/products/smart bands/apple-watch-3-ultra.png",
            "images": ["/products/smart bands/apple-watch-3-ultra.png"],
            "description": "Самые защищённые и функциональные Apple Watch третьего поколения Ultra.",
            "specs": [
                {"label": "Дисплей", "value": "49 мм OLED"},
                {"label": "Защита", "value": "WR100, IP6X"},
                {"label": "GPS", "value": "Двухдиапазонный"},
            ],
            "sort_order": 1,
        },
        {
            "name": "Apple Watch Series 11",
            "slug": "apple-watch-series-11",
            "brand": "Apple",
            "category_id": created_categories.get("watches"),
            "price": 49990,
            "in_stock": True,
            "image": "/products/smart bands/Apple-Watch-Series-11.png",
            "images": ["/products/smart bands/Apple-Watch-Series-11.png"],
            "description": "Новейшие умные часы Apple с чипом нового поколения.",
            "specs": [
                {"label": "Дисплей", "value": "45 мм OLED"},
                {"label": "Чип", "value": "Apple S11"},
                {"label": "Защита", "value": "WR50"},
            ],
            "sort_order": 2,
        },
        # === ACCESSORIES ===
        {
            "name": "MagSafe Charger",
            "slug": "magsafe-charger",
            "brand": "Apple",
            "category_id": created_categories.get("accessories"),
            "price": 4990,
            "in_stock": True,
            "image": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MHXH3?wid=800&hei=800&fmt=jpeg&qlt=90",
            "images": ["https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MHXH3?wid=800&hei=800&fmt=jpeg&qlt=90"],
            "description": "Беспроводная зарядка MagSafe для iPhone.",
            "specs": [
                {"label": "Мощность", "value": "15 Вт"},
                {"label": "Совместимость", "value": "iPhone 12+"},
            ],
            "sort_order": 1,
        },
        # === GAMING ===
        {
            "name": "PlayStation 5 Slim",
            "slug": "playstation-5-slim",
            "brand": "Sony",
            "category_id": created_categories.get("gaming"),
            "price": 54990,
            "badge": "hit",
            "in_stock": True,
            "is_featured": True,
            "image": "/products/portative console/playstation-5.png",
            "images": ["/products/portative console/playstation-5.png"],
            "description": "Компактная версия PlayStation 5.",
            "specs": [
                {"label": "Накопитель", "value": "1 ТБ SSD"},
                {"label": "Разрешение", "value": "4K 120fps"},
            ],
            "sort_order": 1,
        },
        {
            "name": "Nintendo Switch 2",
            "slug": "nintendo-switch-2",
            "brand": "Nintendo",
            "category_id": created_categories.get("gaming"),
            "price": 39990,
            "badge": "new",
            "in_stock": True,
            "image": "/products/portative console/Nintendo-Switch-2.png",
            "images": ["/products/portative console/Nintendo-Switch-2.png"],
            "description": "Новое поколение портативной консоли Nintendo с увеличенным экраном.",
            "specs": [
                {"label": "Дисплей", "value": "8\" LCD"},
                {"label": "Память", "value": "256 ГБ"},
            ],
            "sort_order": 2,
        },
    ]

    products_created = 0
    for product_data in products_data:
        existing = await ProductRepository.get_by_slug(db, product_data["slug"], active_only=False)
        if not existing:
            await ProductRepository.create(db, product_data)
            products_created += 1

    return {
        "message": "База данных заполнена",
        "categories_count": len(created_categories),
        "products_created": products_created,
        "products_total": len(products_data),
    }

