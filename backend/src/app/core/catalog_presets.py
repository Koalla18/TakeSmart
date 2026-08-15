"""
Единый источник стартовых схем категорий каталога.

Содержимое перенесено из «замороженных» миграций:
  - alembic/versions/n4o5p6q7r8s9_restore_empty_category_schemes.py  (схемы полей)
  - alembic/versions/o5p6q7r8s9t0_restore_quick_catalog_models.py    (быстрые модели)
Сами миграции — история, их не трогаем и отсюда не импортируем.

Формат каждого пресета:
    {"id", "label", "description", "product_fields", "quick_filters"}
где product_fields — список словарей в форме Pydantic-модели ProductField
(src/app/schemas/category.py), quick_filters — в форме QuickFilter.

Модуль намеренно без зависимостей (ни config, ни logger, ни Pydantic):
его импортируют и приложение (GET /categories/field-presets),
и scripts/seed_db.py, который гоняется отдельным процессом.

ВАЖНО: словари общие — не мутировать на месте (роут сериализует через
Pydantic, сид — через json.dumps, обоим достаточно чтения).
"""
from __future__ import annotations


def _f(
    key: str,
    label: str,
    *,
    field_type: str = "text",
    placeholder: str = "",
    options: list[str] | None = None,
    hint: str | None = None,
    is_required: bool = False,
    is_variant: bool = False,
) -> dict:
    """Поле карточки товара в форме Pydantic-модели ProductField."""
    return {
        "key": key,
        "label": label,
        "field_type": field_type,
        "placeholder": placeholder,
        "options": options or [],
        "hint": hint,
        "is_required": is_required,
        "is_variant": is_variant,
    }


def _qf(label: str, query: str, brand: str | None = None) -> dict:
    """Быстрый фильтр каталога в форме Pydantic-модели QuickFilter."""
    return {"label": label, "query": query, "brand": brand}


# ─── Пресеты ──────────────────────────────────────────────────────────────────

PRESETS: list[dict] = [
    {
        "id": "smartphones",
        "label": "Смартфоны",
        "description": "Цвет, память, ОЗУ, SIM",
        "product_fields": [
            _f("color", "Цвета", placeholder="Белый",
               hint="Каждый цвет = отдельная карточка товара", is_variant=True),
            _f("storage", "Память", placeholder="256 ГБ",
               hint="Объём встроенной памяти", is_variant=True),
            _f("ram", "ОЗУ", placeholder="12 ГБ",
               hint="Объём оперативной памяти", is_variant=True),
            _f("sim", "Связь (SIM)", placeholder="SIM + eSIM",
               hint="Тип SIM-карт", is_variant=True),
        ],
        "quick_filters": [
            _qf("iPhone 17 Pro Max", "iPhone 17 Pro Max", "apple"),
            _qf("iPhone 17 Pro", "iPhone 17 Pro", "apple"),
            _qf("iPhone 17", "iPhone 17", "apple"),
            _qf("iPhone Air", "iPhone Air", "apple"),
            _qf("iPhone 16 Pro Max", "iPhone 16 Pro Max", "apple"),
            _qf("iPhone 16 Pro", "iPhone 16 Pro", "apple"),
            _qf("iPhone 16", "iPhone 16", "apple"),
            _qf("iPhone 15", "iPhone 15", "apple"),
            _qf("iPhone 14", "iPhone 14", "apple"),
            _qf("iPhone 13", "iPhone 13", "apple"),
            _qf("Galaxy S26 Ultra", "Galaxy S26 Ultra", "samsung"),
            _qf("Galaxy S26+", "Galaxy S26 Plus", "samsung"),
            _qf("Galaxy S26", "Galaxy S26", "samsung"),
            _qf("Galaxy S25 Ultra", "Galaxy S25 Ultra", "samsung"),
            _qf("Galaxy S25+", "Galaxy S25 Plus", "samsung"),
            _qf("Galaxy S25", "Galaxy S25", "samsung"),
            _qf("Galaxy S24 Ultra", "Galaxy S24 Ultra", "samsung"),
            _qf("Galaxy S24", "Galaxy S24", "samsung"),
            _qf("Galaxy S23", "Galaxy S23", "samsung"),
            _qf("Galaxy Z Fold", "Z Fold", "samsung"),
            _qf("Galaxy Z Flip", "Z Flip", "samsung"),
            _qf("Xiaomi 15", "Xiaomi 15", "xiaomi"),
            _qf("Xiaomi 14", "Xiaomi 14", "xiaomi"),
            _qf("Xiaomi 13", "Xiaomi 13", "xiaomi"),
        ],
    },
    {
        "id": "laptops",
        "label": "Ноутбуки",
        "description": "Цвет, процессор, ОЗУ, SSD",
        "product_fields": [
            _f("color", "Цвет", placeholder="Серебристый",
               hint="Каждый цвет = отдельная карточка", is_variant=True),
            _f("processor", "Процессор", placeholder="M4 Pro",
               hint="Модель чипа", is_variant=True),
            _f("ram", "ОЗУ", placeholder="16 ГБ",
               hint="Объём оперативной памяти", is_variant=True),
            _f("storage", "Память SSD", placeholder="512 ГБ",
               hint="Объём накопителя", is_variant=True),
        ],
        "quick_filters": [
            _qf("MacBook NEO", "MacBook Neo", "apple"),
            _qf('MacBook Air 13"', "MacBook Air 13", "apple"),
            _qf('MacBook Air 15"', "MacBook Air 15", "apple"),
            _qf('MacBook Pro 14"', "MacBook Pro 14", "apple"),
            _qf('MacBook Pro 16"', "MacBook Pro 16", "apple"),
            _qf("iMac", "iMac", "apple"),
            _qf("Mac mini", "Mac mini", "apple"),
            _qf("Surface Laptop", "Surface Laptop", "microsoft"),
            _qf("ZenBook", "ZenBook", "asus"),
            _qf("ROG", "ROG", "asus"),
            _qf("ThinkPad", "ThinkPad", "lenovo"),
            _qf("Legion", "Legion", "lenovo"),
        ],
    },
    {
        "id": "monobloki",
        "label": "Моноблоки",
        "description": "Цвет, процессор, ОЗУ, SSD",
        "product_fields": [
            _f("color", "Цвет", placeholder="Серебристый",
               hint="Каждый цвет = отдельная карточка", is_variant=True),
            _f("processor", "Процессор", placeholder="M4 Pro",
               hint="Модель чипа", is_variant=True),
            _f("ram", "ОЗУ", placeholder="16 ГБ",
               hint="Объём оперативной памяти", is_variant=True),
            _f("storage", "Память SSD", placeholder="512 ГБ",
               hint="Объём накопителя", is_variant=True),
        ],
        "quick_filters": [
            _qf('iMac 24"', "iMac 24", "apple"),
            _qf("iMac", "iMac", "apple"),
            _qf("HP All-in-One", "HP All-in-One", "hp"),
            _qf("Lenovo IdeaCentre", "IdeaCentre", "lenovo"),
        ],
    },
    {
        "id": "tablets",
        "label": "Планшеты",
        "description": "Цвет, ОЗУ, память, связь",
        "product_fields": [
            _f("color", "Цвета", placeholder="Space Gray", is_variant=True),
            _f("ram", "ОЗУ", placeholder="8 ГБ",
               hint="Объём оперативной памяти", is_variant=True),
            _f("storage", "Память", placeholder="256 ГБ",
               hint="Объём встроенной памяти", is_variant=True),
            _f("connectivity", "Связь", placeholder="WiFi + Cellular",
               hint="Тип связи", is_variant=True),
        ],
        "quick_filters": [
            _qf('iPad 11" (2025)', "iPad 11", "apple"),
            _qf('iPad 10.9"', "iPad 10", "apple"),
            _qf("iPad Air M3", "iPad Air", "apple"),
            _qf("iPad Pro M5", "iPad Pro", "apple"),
            _qf("iPad mini", "iPad mini", "apple"),
            _qf("Galaxy Tab S10", "Tab S10", "samsung"),
            _qf("Galaxy Tab S9", "Tab S9", "samsung"),
            _qf("Xiaomi Pad", "Xiaomi Pad", "xiaomi"),
        ],
    },
    {
        "id": "watches",
        "label": "Часы",
        "description": "Цвет, ремешок, размеры",
        "product_fields": [
            _f("color", "Цвета", placeholder="Титан", is_variant=True),
            _f("strap_type", "Тип ремешка", placeholder="Sport Band", is_variant=True),
            _f("strap_size", "Размер ремешка", placeholder="S/M", is_variant=True),
            _f("case_size", "Размер циферблата", placeholder="42 мм", is_variant=True),
        ],
        "quick_filters": [
            _qf("Apple Watch Ultra 2", "Watch Ultra 2", "apple"),
            _qf("Apple Watch Series 10", "Watch Series 10", "apple"),
            _qf("Apple Watch Series 9", "Watch Series 9", "apple"),
            _qf("Apple Watch SE", "Watch SE", "apple"),
            _qf("Galaxy Watch 7", "Watch 7", "samsung"),
            _qf("Galaxy Watch Ultra", "Watch Ultra", "samsung"),
        ],
    },
    {
        "id": "glasses",
        "label": "Умные очки",
        "description": "Оправа, линзы, размер",
        "product_fields": [
            _f("frame", "Оправа", placeholder="Матовая чёрная",
               hint="Цвет и тип оправы", is_variant=True),
            _f("lenses", "Линзы", placeholder="Прозрачные",
               hint="Тип линз", is_variant=True),
            _f("size", "Размер", placeholder="S, M, L",
               hint="Размер оправы", is_variant=True),
        ],
        "quick_filters": [
            _qf("Ray-Ban Meta Wayfarer", "Ray-Ban Meta", "meta"),
            _qf("Ray-Ban Meta Skyler", "Meta Skyler", "meta"),
            _qf("Oakley Meta", "Oakley Meta", "meta"),
        ],
    },
    {
        "id": "headphones",
        "label": "Наушники",
        "description": "Цвет",
        "product_fields": [
            _f("color", "Цвета", placeholder="Чёрный", is_variant=True),
        ],
        "quick_filters": [
            _qf("AirPods Pro 3", "AirPods Pro 3", "apple"),
            _qf("AirPods Pro 2", "AirPods Pro 2", "apple"),
            _qf("AirPods 4", "AirPods 4", "apple"),
            _qf("AirPods 3", "AirPods 3", "apple"),
            _qf("AirPods Max", "AirPods Max", "apple"),
            _qf("Marshall Major V", "Marshall Major", "marshall"),
            _qf("Marshall Motif", "Marshall Motif", "marshall"),
            _qf("Galaxy Buds", "Galaxy Buds", "samsung"),
        ],
    },
    {
        "id": "tv",
        "label": "ТВ и аудио",
        "description": "Цвет, диагональ",
        "product_fields": [
            _f("color", "Цвета", placeholder="Чёрный", is_variant=True),
            _f("diagonal", "Диагональ", placeholder="55 дюймов", is_variant=True),
        ],
        "quick_filters": [
            _qf("Телевизоры Samsung", "телевизор", "samsung"),
            _qf("Телевизоры LG", "телевизор", "lg"),
            _qf("Телевизоры Xiaomi", "телевизор", "xiaomi"),
            _qf("Apple TV", "Apple TV", "apple"),
            _qf("Саундбары", "саундбар"),
            _qf("Умные колонки", "колонк"),
        ],
    },
    {
        "id": "gaming",
        "label": "Игровые консоли",
        "description": "Цвет, комплектация, память",
        "product_fields": [
            _f("color", "Цвета", placeholder="Чёрный", is_variant=True),
            _f("bundle", "Комплектация", placeholder="Digital", is_variant=True),
            _f("storage", "Память", placeholder="512 ГБ",
               hint="Объём встроенного накопителя", is_variant=True),
        ],
        "quick_filters": [
            _qf("PlayStation 5", "PlayStation 5", "sony"),
            _qf("Xbox Series X", "Xbox Series", "microsoft"),
            _qf("Nintendo Switch", "Switch", "nintendo"),
            _qf("Steam Deck", "Steam Deck"),
            _qf("VR Гарнитуры", "VR"),
            _qf("Геймпады", "геймпад"),
        ],
    },
    {
        "id": "accessories",
        "label": "Аксессуары",
        "description": "Цвет, размер / тип",
        "product_fields": [
            _f("color", "Цвета", placeholder="Чёрный", is_variant=True),
            _f("size", "Размер / тип", placeholder="M", is_variant=True),
        ],
        "quick_filters": [
            _qf("Чехлы Pitaka", "Pitaka"),
            _qf("Чехлы Apple", "чехол", "apple"),
            _qf("Ремешки", "ремешок"),
            _qf("Apple Pencil", "Apple Pencil", "apple"),
            _qf("Зарядки", "зарядк"),
            _qf("Кабели", "кабел"),
            _qf("Защитные стекла", "стекл"),
        ],
    },
    # ─── Новые пресеты (не из миграций) ──────────────────────────────────────
    {
        "id": "appliances",
        "label": "Бытовая техника",
        "description": "Цвет, мощность, тип устройства",
        "product_fields": [
            _f("color", "Цвет", placeholder="Белый",
               hint="Каждый цвет = отдельная карточка товара", is_variant=True),
            _f("power", "Мощность (Вт)", field_type="number", placeholder="1200",
               hint="Потребляемая мощность в ваттах"),
            _f("type", "Тип", field_type="select",
               options=[
                   "Пылесос",
                   "Робот-пылесос",
                   "Очиститель воздуха",
                   "Увлажнитель",
                   "Климатическая техника",
                   "Кухонная техника",
                   "Другое",
               ],
               hint="Тип устройства"),
        ],
        "quick_filters": [],
    },
    {
        "id": "beauty",
        "label": "Красота и уход",
        "description": "Стайлеры и фены: цвет, насадки, мощность, режимы",
        "product_fields": [
            _f("color", "Цвет", placeholder="Розовое золото",
               hint="Каждый цвет = отдельная карточка товара", is_variant=True),
            _f("attachments", "Насадки в комплекте", field_type="number",
               placeholder="5", hint="Количество насадок"),
            _f("power", "Мощность (Вт)", field_type="number", placeholder="1600",
               hint="Потребляемая мощность в ваттах"),
            _f("heat_modes", "Температурные режимы", field_type="number",
               placeholder="4", hint="Количество температурных режимов"),
        ],
        "quick_filters": [],
    },
    {
        "id": "home",
        "label": "Умный дом",
        "description": "Цвет, питание",
        "product_fields": [
            _f("color", "Цвет", placeholder="Белый",
               hint="Каждый цвет = отдельная карточка товара", is_variant=True),
            _f("power_source", "Питание", field_type="select",
               options=["От сети", "Аккумулятор", "Батарейки"],
               hint="Тип питания устройства"),
        ],
        "quick_filters": [],
    },
    {
        "id": "generic",
        "label": "Универсальная",
        "description": "Только цвет — подойдёт любой категории",
        "product_fields": [
            _f("color", "Цвета", placeholder="Чёрный",
               hint="Каждый цвет = отдельная карточка товара", is_variant=True),
        ],
        "quick_filters": [],
    },
    {
        "id": "empty",
        "label": "Пустая",
        "description": "Без стартовых полей — схема настраивается вручную",
        "product_fields": [],
        "quick_filters": [],
    },
]


# ─── Маппинг slug категории → id пресета (для сидов) ─────────────────────────

SLUG_TO_PRESET: dict[str, str] = {
    "smartphones": "smartphones",
    "laptops": "laptops",
    "tablets": "tablets",
    "watches": "watches",
    "headphones": "headphones",
    "tv": "tv",
    "gaming": "gaming",
    "accessories": "accessories",
}


def preset_by_id(preset_id: str) -> dict | None:
    """Найти пресет по id (None, если такого нет)."""
    return next((preset for preset in PRESETS if preset["id"] == preset_id), None)


def preset_for_slug(slug: str) -> dict:
    """Пресет для slug категории; неизвестный slug → универсальный «generic»."""
    preset = preset_by_id(SLUG_TO_PRESET.get(slug, "generic"))
    if preset is None:  # generic всегда существует — страховка от опечатки в списке
        raise KeyError(f"Пресет для slug={slug!r} не найден")
    return preset
