"""
Seeder: заполняет базу данных начальными данными (админ + категории + товары).

Запуск внутри контейнера:
    python scripts/seed_db.py

Или через docker exec:
    docker exec takesmart-backend-1 python scripts/seed_db.py
"""
from __future__ import annotations

import asyncio
import os
import uuid
from decimal import Decimal

import asyncpg
from passlib.context import CryptContext

# ─── Подключение ─────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://take_smart:take_smart_local@db:5432/take_smart",
)

# asyncpg принимает postgres://, а не postgresql+asyncpg://
DB_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://").replace(
    "postgresql://", "postgresql://"
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ─── Исходные данные ──────────────────────────────────────────────────────────

CATEGORIES = [
    {
        "slug": "smartphones",
        "name": "Смартфоны",
        "description": "iPhone, Samsung Galaxy, Xiaomi и другие флагманы",
        "image_url": None,
    },
    {
        "slug": "laptops",
        "name": "Ноутбуки",
        "description": "MacBook Pro, MacBook Air, Ultrabook",
        "image_url": None,
    },
    {
        "slug": "tablets",
        "name": "Планшеты",
        "description": "iPad Pro, Samsung Galaxy Tab",
        "image_url": None,
    },
    {
        "slug": "headphones",
        "name": "Наушники",
        "description": "AirPods Pro, Sony WH, Samsung Galaxy Buds",
        "image_url": None,
    },
    {
        "slug": "watches",
        "name": "Часы",
        "description": "Apple Watch Ultra, Series",
        "image_url": None,
    },
    {
        "slug": "accessories",
        "name": "Аксессуары",
        "description": "Зарядки, чехлы, кабели",
        "image_url": None,
    },
    {
        "slug": "gaming",
        "name": "Игровые консоли",
        "description": "PlayStation, Nintendo Switch, Xbox",
        "image_url": None,
    },
    {
        "slug": "tv",
        "name": "ТВ и аудио",
        "description": "Samsung, LG, Sony",
        "image_url": None,
    },
]

# Все изображения размещены в /static/products/ внутри контейнера
def _img(path: str) -> str:
    return f"/static/products/{path}"


PRODUCTS = [
    # ── Смартфоны ──────────────────────────────────────────────────────────────
    {
        "slug": "iphone-15-pro-max-256gb-natural",
        "name": "iPhone 15 Pro Max 256 ГБ",
        "brand": "Apple",
        "category_slug": "smartphones",
        "price": Decimal("124990"),
        "discount_price": None,
        "old_price": Decimal("139990"),
        "stock_quantity": 15,
        "is_featured": True,
        "sku": "APL-IP15PM-256-NAT",
        "model": "iPhone 15 Pro Max",
        "color": "Natural Titanium",
        "warranty_months": 12,
        "main_image_url": _img("phone/apple/iphone-15-pro-natural-titanium.png"),
        "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
        "short_description": "Топовый iPhone с чипом A17 Pro",
    },
    {
        "slug": "iphone-15-pro-128gb",
        "name": "iPhone 15 Pro 128 ГБ",
        "brand": "Apple",
        "category_slug": "smartphones",
        "price": Decimal("109990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 20,
        "is_featured": True,
        "sku": "APL-IP15P-128-BLK",
        "model": "iPhone 15 Pro",
        "color": "Black Titanium",
        "warranty_months": 12,
        "main_image_url": _img("phone/apple/Iphone-15-pro-Black-Titanium.png"),
        "description": "Компактный флагман с титановым дизайном и Action Button.",
        "short_description": "iPhone 15 Pro с чипом A17 Pro",
    },
    {
        "slug": "iphone-14-128gb",
        "name": "iPhone 14 128 ГБ",
        "brand": "Apple",
        "category_slug": "smartphones",
        "price": Decimal("69990"),
        "discount_price": Decimal("64990"),
        "old_price": Decimal("79990"),
        "stock_quantity": 25,
        "is_featured": False,
        "sku": "APL-IP14-128",
        "model": "iPhone 14",
        "color": None,
        "warranty_months": 12,
        "main_image_url": _img("phone/apple/iphone-14.jpg"),
        "description": "Отличный выбор для тех, кто хочет получить премиальное качество Apple по доступной цене.",
        "short_description": "iPhone 14 с чипом A15 Bionic",
    },
    {
        "slug": "iphone-17-pro",
        "name": "iPhone 17 Pro",
        "brand": "Apple",
        "category_slug": "smartphones",
        "price": Decimal("154990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 10,
        "is_featured": True,
        "sku": "APL-IP17P-256",
        "model": "iPhone 17 Pro",
        "color": None,
        "warranty_months": 12,
        "main_image_url": _img("phone/apple/iphone-17-pro.png"),
        "description": "Новейший iPhone 17 Pro с улучшенным чипом и камерой нового поколения.",
        "short_description": "iPhone 17 Pro с чипом A19 Pro",
    },
    {
        "slug": "samsung-galaxy-s25-ultra",
        "name": "Samsung Galaxy S25 Ultra",
        "brand": "Samsung",
        "category_slug": "smartphones",
        "price": Decimal("114990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 18,
        "is_featured": True,
        "sku": "SAM-S25U-256",
        "model": "Galaxy S25 Ultra",
        "color": None,
        "warranty_months": 12,
        "main_image_url": _img("phone/samsung/samsung-galaxy-s25.png"),
        "description": "Флагман Samsung с Galaxy AI, S Pen и революционной камерой 200 Мп.",
        "short_description": "Samsung Galaxy S25 Ultra с S Pen",
    },
    {
        "slug": "xiaomi-15",
        "name": "Xiaomi 15",
        "brand": "Xiaomi",
        "category_slug": "smartphones",
        "price": Decimal("79990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 12,
        "is_featured": False,
        "sku": "XMI-15-256",
        "model": "Xiaomi 15",
        "color": None,
        "warranty_months": 12,
        "main_image_url": _img("phone/xiaomi/Xiaomi-15.png"),
        "description": "Флагман Xiaomi с камерой Leica и чипом Snapdragon 8 Elite.",
        "short_description": "Xiaomi 15 с камерой Leica",
    },
    # ── Ноутбуки ───────────────────────────────────────────────────────────────
    {
        "slug": "macbook-pro-14-m3-pro",
        "name": 'MacBook Pro 14" M3 Pro',
        "brand": "Apple",
        "category_slug": "laptops",
        "price": Decimal("249990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 8,
        "is_featured": True,
        "sku": "APL-MBP14-M3P",
        "model": "MacBook Pro 14",
        "color": "Space Gray",
        "warranty_months": 12,
        "main_image_url": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mbp14-spacegray-select-202310?wid=800&hei=800&fmt=jpeg&qlt=90",
        "description": "Профессиональный ноутбук с чипом M3 Pro и дисплеем Liquid Retina XDR.",
        "short_description": "MacBook Pro с чипом M3 Pro",
    },
    {
        "slug": "macbook-air-15-m3",
        "name": 'MacBook Air 15" M3',
        "brand": "Apple",
        "category_slug": "laptops",
        "price": Decimal("179990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 10,
        "is_featured": False,
        "sku": "APL-MBA15-M3",
        "model": "MacBook Air 15",
        "color": "Midnight",
        "warranty_months": 12,
        "main_image_url": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mba15-midnight-select-202306?wid=800&hei=800&fmt=jpeg&qlt=90",
        "description": "Самый тонкий 15-дюймовый ноутбук в мире с чипом M3.",
        "short_description": "MacBook Air 15 с чипом M3",
    },
    # ── Планшеты ───────────────────────────────────────────────────────────────
    {
        "slug": "ipad-pro-12-m2",
        "name": 'iPad Pro 12.9" M2',
        "brand": "Apple",
        "category_slug": "tablets",
        "price": Decimal("139990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 7,
        "is_featured": False,
        "sku": "APL-IPADPRO12-M2",
        "model": "iPad Pro 12.9",
        "color": "Space Gray",
        "warranty_months": 12,
        "main_image_url": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/ipad-pro-13-select-wifi-spacegray-202210?wid=800&hei=800&fmt=jpeg&qlt=90",
        "description": "Самый мощный iPad с чипом M2 и дисплеем Liquid Retina XDR.",
        "short_description": "iPad Pro с чипом M2",
    },
    # ── Наушники ───────────────────────────────────────────────────────────────
    {
        "slug": "airpods-pro-2",
        "name": "AirPods Pro 2",
        "brand": "Apple",
        "category_slug": "headphones",
        "price": Decimal("24990"),
        "discount_price": Decimal("21990"),
        "old_price": Decimal("29990"),
        "stock_quantity": 30,
        "is_featured": True,
        "sku": "APL-AIRPODSPRO2",
        "model": "AirPods Pro 2",
        "color": "White",
        "warranty_months": 12,
        "main_image_url": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MQD83?wid=800&hei=800&fmt=jpeg&qlt=90",
        "description": "Беспроводные наушники с активным шумоподавлением и пространственным аудио.",
        "short_description": "AirPods Pro с ANC",
    },
    {
        "slug": "airpods-max",
        "name": "AirPods Max",
        "brand": "Apple",
        "category_slug": "headphones",
        "price": Decimal("59990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 5,
        "is_featured": False,
        "sku": "APL-AIRPODSMAX",
        "model": "AirPods Max",
        "color": None,
        "warranty_months": 12,
        "main_image_url": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/airpods-max-hero-select-202011_FMT_WHH?wid=800&hei=800&fmt=jpeg&qlt=90",
        "description": "Премиальные накладные наушники с невероятным звуком.",
        "short_description": "AirPods Max — Hi-Fi звук",
    },
    {
        "slug": "sony-wh-1000xm5",
        "name": "Sony WH-1000XM5",
        "brand": "Sony",
        "category_slug": "headphones",
        "price": Decimal("39990"),
        "discount_price": Decimal("34990"),
        "old_price": Decimal("44990"),
        "stock_quantity": 14,
        "is_featured": True,
        "sku": "SNY-WH1000XM5",
        "model": "WH-1000XM5",
        "color": "Black",
        "warranty_months": 12,
        "main_image_url": _img("headphones/sony/sony-wh-1000xm5-black.png"),
        "description": "Лучшие наушники с шумоподавлением от Sony.",
        "short_description": "Sony WH-1000XM5 с ANC",
    },
    {
        "slug": "samsung-galaxy-buds3-pro",
        "name": "Samsung Galaxy Buds3 Pro",
        "brand": "Samsung",
        "category_slug": "headphones",
        "price": Decimal("21990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 22,
        "is_featured": False,
        "sku": "SAM-BUDS3PRO",
        "model": "Galaxy Buds3 Pro",
        "color": None,
        "warranty_months": 12,
        "main_image_url": _img("headphones/samsung/Samsung-Galaxy-Buds3.png"),
        "description": "Премиальные TWS-наушники Samsung с Galaxy AI.",
        "short_description": "Galaxy Buds3 Pro с Galaxy AI",
    },
    # ── Часы ──────────────────────────────────────────────────────────────────
    {
        "slug": "apple-watch-ultra-3",
        "name": "Apple Watch Ultra 3",
        "brand": "Apple",
        "category_slug": "watches",
        "price": Decimal("84990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 9,
        "is_featured": True,
        "sku": "APL-WU3",
        "model": "Watch Ultra 3",
        "color": "Titanium",
        "warranty_months": 12,
        "main_image_url": _img("smartwatches/apple-watch-3-ultra.png"),
        "description": "Самые защищённые и функциональные Apple Watch третьего поколения Ultra.",
        "short_description": "Apple Watch Ultra 3",
    },
    {
        "slug": "apple-watch-series-11",
        "name": "Apple Watch Series 11",
        "brand": "Apple",
        "category_slug": "watches",
        "price": Decimal("49990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 13,
        "is_featured": False,
        "sku": "APL-WS11",
        "model": "Watch Series 11",
        "color": None,
        "warranty_months": 12,
        "main_image_url": _img("smartwatches/Apple-Watch-Series-11.png"),
        "description": "Новейшие умные часы Apple с чипом нового поколения.",
        "short_description": "Apple Watch Series 11",
    },
    # ── Игровые консоли ────────────────────────────────────────────────────────
    {
        "slug": "playstation-5-slim",
        "name": "PlayStation 5 Slim",
        "brand": "Sony",
        "category_slug": "gaming",
        "price": Decimal("54990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 6,
        "is_featured": True,
        "sku": "SNY-PS5SLIM",
        "model": "PlayStation 5 Slim",
        "color": "White",
        "warranty_months": 12,
        "main_image_url": _img("consoles/playstation-5.png"),
        "description": "Компактная версия PlayStation 5 с 1 ТБ SSD.",
        "short_description": "PS5 Slim — 4K 120fps",
    },
    {
        "slug": "nintendo-switch-2",
        "name": "Nintendo Switch 2",
        "brand": "Nintendo",
        "category_slug": "gaming",
        "price": Decimal("39990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 11,
        "is_featured": False,
        "sku": "NTD-SWITCH2",
        "model": "Switch 2",
        "color": None,
        "warranty_months": 12,
        "main_image_url": _img("consoles/Nintendo-Switch-2.png"),
        "description": "Новое поколение портативной консоли Nintendo с увеличенным экраном.",
        "short_description": "Nintendo Switch 2",
    },
    # ── Аксессуары ─────────────────────────────────────────────────────────────
    {
        "slug": "magsafe-charger",
        "name": "MagSafe Charger",
        "brand": "Apple",
        "category_slug": "accessories",
        "price": Decimal("4990"),
        "discount_price": None,
        "old_price": None,
        "stock_quantity": 50,
        "is_featured": False,
        "sku": "APL-MAGSAFE15W",
        "model": "MagSafe Charger",
        "color": "White",
        "warranty_months": 6,
        "main_image_url": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MHXH3?wid=800&hei=800&fmt=jpeg&qlt=90",
        "description": "Беспроводная зарядка MagSafe для iPhone.",
        "short_description": "MagSafe 15 Вт для iPhone 12+",
    },
]


# ─── Основная логика ──────────────────────────────────────────────────────────

async def seed() -> None:
    print("🌱 Подключаемся к БД...")
    conn = await asyncpg.connect(DB_URL)

    try:
        # ── Создаём/обновляем администратора ─────────────────────────────────
        admin_username = os.getenv("ADMIN_USERNAME", "admin")
        admin_password = os.getenv("ADMIN_PASSWORD", "admin")
        hashed = pwd_context.hash(admin_password)

        existing_admin = await conn.fetchval(
            "SELECT id FROM admins WHERE username = $1", admin_username
        )
        if existing_admin:
            await conn.execute(
                "UPDATE admins SET hashed_password = $1 WHERE username = $2",
                hashed, admin_username,
            )
            print(f"🔑 Пароль администратора '{admin_username}' обновлён")
        else:
            await conn.execute(
                "INSERT INTO admins (username, hashed_password) VALUES ($1, $2)",
                admin_username, hashed,
            )
            print(f"🔑 Администратор '{admin_username}' создан")

        # ── Проверяем: уже засеяно? ───────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM products")
        skip_products = count and count > 0
        if skip_products:
            print(f"⚠️  В БД уже {count} товаров. Пропускаем сидирование товаров.")
            print("    Чтобы сидировать повторно: DELETE FROM products; DELETE FROM categories;")

        # ── Создаём категории ─────────────────────────────────────────────────
        if not skip_products:
            print("📁 Создаём категории...")
            cat_id_map: dict[str, uuid.UUID] = {}

            for cat in CATEGORIES:
                cat_id = uuid.uuid4()
                cat_id_map[cat["slug"]] = cat_id
                await conn.execute(
                    """
                    INSERT INTO categories (id, name, slug, description, image_url, is_active, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """,
                    str(cat_id),
                    cat["name"],
                    cat["slug"],
                    cat["description"],
                    cat["image_url"],
                )

            # Перечитываем реальные ID из БД (на случай конфликтов ON CONFLICT)
            rows = await conn.fetch("SELECT id, slug FROM categories")
            for row in rows:
                cat_id_map[row["slug"]] = row["id"]

            print(f"  ✅ Создано {len(CATEGORIES)} категорий")

            # ── Создаём товары ────────────────────────────────────────────────────
            print("📦 Создаём товары...")
            created = 0

            for p in PRODUCTS:
                prod_id = uuid.uuid4()
                cat_id = cat_id_map.get(p["category_slug"])

                await conn.execute(
                    """
                    INSERT INTO products (
                        id, name, slug, description, short_description,
                        price, discount_price, stock_quantity,
                        sku, brand, model, color, warranty_months,
                        main_image_url, is_active, is_featured, category_id,
                        created_at, updated_at
                    )
                    VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8,
                        $9, $10, $11, $12, $13,
                        $14, TRUE, $15, $16,
                        NOW(), NOW()
                    )
                    ON CONFLICT (slug) DO NOTHING
                    """,
                    str(prod_id),
                    p["name"],
                    p["slug"],
                    p["description"],
                    p["short_description"],
                    p["price"],
                    p.get("discount_price"),
                    p["stock_quantity"],
                    p.get("sku"),
                    p.get("brand"),
                    p.get("model"),
                    p.get("color"),
                    p.get("warranty_months"),
                    p.get("main_image_url"),
                    p["is_featured"],
                    str(cat_id) if cat_id else None,
                )
                created += 1

            print(f"  ✅ Создано {created} товаров")

        # ── Создаём слайды «Товары недели» ────────────────────────────────────
        print("🎠 Создаём слайды «Товары недели»...")
        weekly_slides = [
            {
                "badge": "Мощь. Стиль. Pro.",
                "title": "iPhone 17 Pro",
                "description": "Оригинальная техника Apple без переплат.\nОбмен старого устройства на новое с выгодой до 50%.\nДоставка в день заказа по Москве и МО.",
                "price": "94 000",
                "image": "/iphone-17-pro.png",
                "color": "bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50",
                "tags": ["trade-in", "гарантия 12 месяцев*", "новинка"],
                "link_url": "/catalog",
                "is_new": True,
                "sort_order": 0,
            },
            {
                "badge": "Лёгкость. Мощь. Air.",
                "title": "MacBook Air M3",
                "description": "Невероятно тонкий и лёгкий.\nДо 18 часов работы без подзарядки.\nЧип M3 — производительность нового уровня.",
                "price": "119 990",
                "image": "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/macbook-air-midnight-select-20220606?wid=800&hei=800&fmt=png-alpha",
                "color": "bg-gradient-to-br from-slate-100 via-gray-50 to-slate-50",
                "tags": ["trade-in", "гарантия 12 месяцев*", "хит"],
                "link_url": "/catalog",
                "is_new": False,
                "sort_order": 1,
            },
            {
                "badge": "Звук. Без границ.",
                "title": "AirPods Pro 2",
                "description": "Активное шумоподавление нового поколения.\nАдаптивное аудио — под вас.\nДо 6 часов прослушивания.",
                "price": "24 990",
                "image": "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/airpods-pro-2-hero-select-202409?wid=800&hei=800&fmt=png-alpha",
                "color": "bg-gradient-to-br from-purple-50 via-white to-fuchsia-50",
                "tags": ["trade-in", "гарантия 12 месяцев*"],
                "link_url": "/catalog",
                "is_new": False,
                "sort_order": 2,
            },
            {
                "badge": "Создан для приключений.",
                "title": "Apple Watch Ultra 2",
                "description": "Титановый корпус 49 мм.\nСамый яркий дисплей Apple Watch.\nДо 36 часов автономной работы.",
                "price": "79 990",
                "image": "/watch-ultra-2.png",
                "color": "bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50",
                "tags": ["trade-in", "гарантия 12 месяцев*", "новинка"],
                "link_url": "/catalog",
                "is_new": True,
                "sort_order": 3,
            },
        ]

        import json as _json

        slides_created = 0
        for slide in weekly_slides:
            s_id = uuid.uuid4()
            exists = await conn.fetchval(
                "SELECT 1 FROM weekly_slides WHERE title = $1", slide["title"]
            )
            if exists:
                continue
            await conn.execute(
                """
                INSERT INTO weekly_slides (
                    id, badge, title, description, price, image, color,
                    tags, link_url, is_new, sort_order, is_active, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, TRUE, NOW(), NOW())
                """,
                str(s_id),
                slide["badge"],
                slide["title"],
                slide["description"],
                slide["price"],
                slide["image"],
                slide["color"],
                _json.dumps(slide["tags"], ensure_ascii=False),
                slide["link_url"],
                slide["is_new"],
                slide["sort_order"],
            )
            slides_created += 1

        print(f"  ✅ Создано {slides_created} слайдов")
        print("✅ Сидирование завершено!")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
