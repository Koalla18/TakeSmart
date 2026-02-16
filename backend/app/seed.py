"""
Seed data for TakeSmart database.
Contains default categories and products for initial setup.
"""

from sqlalchemy.orm import Session
from .models import Category, Product


# Default categories
DEFAULT_CATEGORIES = [
    {"slug": "smartphones", "name": "Смартфоны", "description": "iPhone, Samsung, Xiaomi", "icon": "📱", "sort_order": 1},
    {"slug": "laptops", "name": "Ноутбуки", "description": "MacBook, Dell, HP", "icon": "💻", "sort_order": 2},
    {"slug": "tablets", "name": "Планшеты", "description": "iPad, Samsung Tab", "icon": "📱", "sort_order": 3},
    {"slug": "headphones", "name": "Наушники", "description": "AirPods, Sony, JBL", "icon": "🎧", "sort_order": 4},
    {"slug": "watches", "name": "Часы", "description": "Apple Watch, Samsung", "icon": "⌚", "sort_order": 5},
    {"slug": "accessories", "name": "Аксессуары", "description": "Чехлы, зарядки, кабели", "icon": "🔌", "sort_order": 6},
    {"slug": "gaming", "name": "Игровые консоли", "description": "PlayStation, Nintendo", "icon": "🎮", "sort_order": 7},
    {"slug": "tv", "name": "ТВ и аудио", "description": "Samsung, LG, Sony", "icon": "📺", "sort_order": 8},
]


def get_default_products(category_ids: dict) -> list:
    """
    Get default products with category IDs.
    
    Args:
        category_ids: Dict mapping category slug to category ID
    
    Returns:
        List of product dictionaries
    """
    return [
        # iPhone 15 Pro Max - Natural Titanium variants
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-natural",
            "brand": "Apple",
            "category_id": category_ids.get("smartphones"),
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
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 512 ГБ",
            "slug": "iphone-15-pro-max-512gb-natural",
            "brand": "Apple",
            "category_id": category_ids.get("smartphones"),
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
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-blue",
            "brand": "Apple",
            "category_id": category_ids.get("smartphones"),
            "price": 124990,
            "old_price": 139990,
            "in_stock": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "голубой титан",
            "color_code": "#87CEEB",
            "storage": "256 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-bluetitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 512 ГБ",
            "slug": "iphone-15-pro-max-512gb-blue",
            "brand": "Apple",
            "category_id": category_ids.get("smartphones"),
            "price": 144990,
            "in_stock": False,
            "variant_group_id": "iphone-15-pro-max",
            "color": "голубой титан",
            "color_code": "#87CEEB",
            "storage": "512 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-bluetitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "512 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-white",
            "brand": "Apple",
            "category_id": category_ids.get("smartphones"),
            "price": 124990,
            "old_price": 139990,
            "in_stock": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "белый титан",
            "color_code": "#F5F5F5",
            "storage": "256 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-whitetitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-black",
            "brand": "Apple",
            "category_id": category_ids.get("smartphones"),
            "price": 124990,
            "old_price": 139990,
            "in_stock": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "чёрный титан",
            "color_code": "#1C1C1E",
            "storage": "256 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-blacktitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro 128 ГБ",
            "slug": "iphone-15-pro-128gb",
            "brand": "Apple",
            "category_id": category_ids.get("smartphones"),
            "price": 109990,
            "badge": "new",
            "in_stock": True,
            "image": "📱",
            "description": "Компактный флагман с титановым дизайном и Action Button.",
            "specs": [
                {"label": "Дисплей", "value": "6.1\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "128 ГБ"},
            ],
            "sort_order": 2
        },
        {
            "name": "Samsung Galaxy S24 Ultra",
            "slug": "samsung-galaxy-s24-ultra",
            "brand": "Samsung",
            "category_id": category_ids.get("smartphones"),
            "price": 109990,
            "in_stock": True,
            "image": "📱",
            "description": "Флагман Samsung с Galaxy AI, S Pen и революционной камерой 200 Мп.",
            "specs": [
                {"label": "Дисплей", "value": "6.8\" Dynamic AMOLED 2X"},
                {"label": "Процессор", "value": "Snapdragon 8 Gen 3"},
                {"label": "Память", "value": "256 ГБ"},
            ],
            "sort_order": 3
        },
        {
            "name": "MacBook Pro 14\" M3 Pro",
            "slug": "macbook-pro-14-m3-pro",
            "brand": "Apple",
            "category_id": category_ids.get("laptops"),
            "price": 249990,
            "badge": "new",
            "in_stock": True,
            "image": "💻",
            "description": "Профессиональный ноутбук с чипом M3 Pro и дисплеем Liquid Retina XDR.",
            "specs": [
                {"label": "Дисплей", "value": "14\" Liquid Retina XDR"},
                {"label": "Процессор", "value": "Apple M3 Pro"},
                {"label": "Память", "value": "512 ГБ SSD"},
            ],
            "sort_order": 4
        },
        {
            "name": "PlayStation 5",
            "slug": "playstation-5",
            "brand": "Sony",
            "category_id": category_ids.get("gaming"),
            "price": 54990,
            "badge": "hit",
            "in_stock": True,
            "image": "🎮",
            "description": "Консоль нового поколения от Sony с поддержкой 4K и молниеносным SSD.",
            "specs": [
                {"label": "SSD", "value": "825 ГБ"},
                {"label": "Разрешение", "value": "4K 120fps"},
            ],
            "sort_order": 5
        },
        {
            "name": "AirPods Pro 2",
            "slug": "airpods-pro-2",
            "brand": "Apple",
            "category_id": category_ids.get("headphones"),
            "price": 24990,
            "in_stock": True,
            "image": "🎧",
            "description": "TWS-наушники Apple с адаптивным шумоподавлением и пространственным звуком.",
            "specs": [
                {"label": "Тип", "value": "TWS"},
                {"label": "Шумоподавление", "value": "Адаптивное ANC"},
                {"label": "Время работы", "value": "6 ч"},
            ],
            "sort_order": 6
        },
        {
            "name": "Apple Watch Series 9",
            "slug": "apple-watch-series-9",
            "brand": "Apple",
            "category_id": category_ids.get("watches"),
            "price": 44990,
            "in_stock": True,
            "image": "⌚",
            "description": "Умные часы Apple с жестовым управлением и новым чипом S9.",
            "specs": [
                {"label": "Дисплей", "value": "Always-On Retina"},
                {"label": "Процессор", "value": "Apple S9"},
            ],
            "sort_order": 7
        },
        {
            "name": "iPad Pro 12.9\" M2",
            "slug": "ipad-pro-129-m2",
            "brand": "Apple", 
            "category_id": category_ids.get("tablets"),
            "price": 129990,
            "in_stock": True,
            "image": "📱",
            "description": "Профессиональный планшет с дисплеем Liquid Retina XDR и чипом M2.",
            "specs": [
                {"label": "Дисплей", "value": "12.9\" Liquid Retina XDR"},
                {"label": "Процессор", "value": "Apple M2"},
                {"label": "Память", "value": "256 ГБ"},
            ],
            "sort_order": 8
        },
        # БУ товары  
        {
            "name": "iPhone 13 Pro 128 ГБ (Б/У)",
            "slug": "iphone-13-pro-128gb-bu",
            "brand": "Apple",
            "category_id": category_ids.get("smartphones"),
            "price": 54990,
            "old_price": 84990,
            "badge": "sale",
            "in_stock": True,
            "is_used": True,
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-13-pro-graphite-select?wid=400"
            ],
            "description": "iPhone 13 Pro в отличном состоянии. Батарея 92%, без царапин.",
            "specs": [
                {"label": "Состояние", "value": "Отличное (9/10)"},
                {"label": "Батарея", "value": "92%"},
                {"label": "Память", "value": "128 ГБ"},
                {"label": "Гарантия", "value": "6 месяцев"},
            ],
            "sort_order": 100
        },
        {
            "name": "MacBook Air M1 2020 (Б/У)",
            "slug": "macbook-air-m1-2020-bu",
            "brand": "Apple",
            "category_id": category_ids.get("laptops"),
            "price": 64990,
            "old_price": 99990,
            "badge": "sale",
            "in_stock": True,
            "is_used": True,
            "image": "💻",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/macbook-air-space-gray-select-201810?wid=400"
            ],
            "description": "MacBook Air в идеальном состоянии. Цикл зарядки 87, как новый.",
            "specs": [
                {"label": "Состояние", "value": "Идеальное (10/10)"},
                {"label": "Циклы батареи", "value": "87"},
                {"label": "Память", "value": "256 ГБ SSD"},
                {"label": "Гарантия", "value": "12 месяцев"},
            ],
            "sort_order": 101
        },
        {
            "name": "Samsung Galaxy S23 Ultra (Б/У)",
            "slug": "samsung-galaxy-s23-ultra-bu",
            "brand": "Samsung",
            "category_id": category_ids.get("smartphones"),
            "price": 69990,
            "old_price": 109990,
            "in_stock": True,
            "is_used": True,
            "image": "📱",
            "description": "Galaxy S23 Ultra с S Pen, небольшие следы использования.",
            "specs": [
                {"label": "Состояние", "value": "Хорошее (8/10)"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "200 Мп"},
                {"label": "Гарантия", "value": "3 месяца"},
            ],
            "sort_order": 102
        },
        {
            "name": "AirPods Pro (Б/У)",
            "slug": "airpods-pro-bu",
            "brand": "Apple",
            "category_id": category_ids.get("headphones"),
            "price": 12990,
            "old_price": 24990,
            "badge": "sale",
            "in_stock": True,
            "is_used": True,
            "image": "🎧",
            "description": "AirPods Pro 1-го поколения. Заменены амбушюры, работают идеально.",
            "specs": [
                {"label": "Состояние", "value": "Хорошее (8/10)"},
                {"label": "Батарея", "value": "85%"},
                {"label": "Гарантия", "value": "3 месяца"},
            ],
            "sort_order": 103
        },
    ]


def seed_categories(db: Session) -> dict[str, int]:
    """
    Seed default categories.
    
    Returns:
        Dict mapping category slug to category ID
    """
    created_categories = {}
    
    for cat_data in DEFAULT_CATEGORIES:
        existing = db.query(Category).filter(Category.slug == cat_data["slug"]).first()
        if not existing:
            cat = Category(**cat_data)
            db.add(cat)
            db.commit()
            db.refresh(cat)
            created_categories[cat_data["slug"]] = cat.id
        else:
            created_categories[cat_data["slug"]] = existing.id
    
    return created_categories


def seed_products(db: Session, category_ids: dict[str, int]) -> int:
    """
    Seed default products.
    
    Args:
        db: Database session
        category_ids: Dict mapping category slug to ID
    
    Returns:
        Number of products created
    """
    products_data = get_default_products(category_ids)
    created_count = 0
    
    for prod_data in products_data:
        existing = db.query(Product).filter(Product.slug == prod_data["slug"]).first()
        if not existing:
            product = Product(**prod_data)
            db.add(product)
            created_count += 1
    
    db.commit()
    return created_count


def seed_database(db: Session) -> dict:
    """
    Seed the database with default categories and products.
    
    Returns:
        Dict with seeding results
    """
    # Create categories
    category_ids = seed_categories(db)
    
    # Create products
    products_created = seed_products(db, category_ids)
    
    return {
        "message": "Database seeded successfully",
        "categories_count": len(category_ids),
        "products_created": products_created
    }
