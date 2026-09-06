"""Команды для массового изменения цен человеческим языком.

Сотрудник пишет (или наговаривает) «наушники apple +2000», «17 pro -1500»,
«galaxy s26 512 = 89990», «все iphone кроме 15 +5%» — модуль разбирает
команду на ОПЕРАЦИЮ (сколько и в какую сторону) и ЦЕЛЬ (какие товары),
подбирает товары по каталогу и считает новые цены. Ничего не пишет в БД:
роутер сначала показывает предпросмотр, и только явное «применить» с
перечнем id меняет цены — так тысяча позиций не переоценивается вслепую.

Чистые функции без ORM: их можно гонять тестами на любых списках.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable, Literal

OperationKind = Literal["delta", "percent", "set"]

# ── Словари ────────────────────────────────────────────────────────────────────

# Русское написание → как оно пишется в каталоге (названия товаров латиницей)
TOKEN_ALIASES: dict[str, str] = {
    "айфон": "iphone", "айфоны": "iphone", "айфонов": "iphone", "айфона": "iphone",
    "про": "pro", "макс": "max", "мини": "mini", "плюс": "plus", "ультра": "ultra",
    "эйр": "air", "аир": "air", "эир": "air",
    "эпл": "apple", "эппл": "apple", "апл": "apple",
    "самсунг": "samsung", "самсунга": "samsung",
    "гелекси": "galaxy", "галакси": "galaxy", "гэлакси": "galaxy",
    "сяоми": "xiaomi", "ксиоми": "xiaomi", "шаоми": "xiaomi",
    "макбук": "macbook", "макбуки": "macbook", "макбуков": "macbook",
    "айпад": "ipad", "айпады": "ipad", "айпадов": "ipad",
    "эйрподс": "airpods", "аирподс": "airpods", "эирподс": "airpods",
    "вотч": "watch", "вотчи": "watch",
    "плейстейшн": "playstation", "плейстешн": "playstation", "плойка": "playstation",
    "нинтендо": "nintendo", "свитч": "switch",
    "дайсон": "dyson", "сони": "sony", "джибиэл": "jbl", "джейбиэл": "jbl",
    "гб": "гб", "тб": "тб", "gb": "гб", "tb": "тб",
}

# Слова-цели, которые указывают на категорию (по началу слова)
CATEGORY_ALIASES: dict[str, tuple[str, ...]] = {
    "smartphones": ("смартфон", "телефон", "мобил"),
    "laptops": ("ноутбук", "ноут", "лэптоп"),
    "tablets": ("планшет",),
    "watches": ("часы", "часов", "часам", "смартчас"),
    "headphones": ("наушник", "гарнитур"),
    "tv": ("телевизор", "телек", "аудио", "колонк"),
    "gaming": ("консол", "приставк", "игров"),
    "accessories": ("аксессуар", "зарядк", "чехл", "кабел"),
    "monobloki": ("моноблок",),
}

# Служебные слова, которые ничего не значат для подбора
STOP_WORDS = {
    "на", "у", "для", "по", "и", "а", "в", "во", "с", "со", "к", "ко", "от", "до", "за",
    "все", "всё", "всех", "всем", "весь", "вся", "позиции", "позиция", "позиций", "товар",
    "товары", "товаров", "модели", "модель", "моделей", "цена", "цену", "цены", "ценa",
    "руб", "рублей", "рубля", "р", "₽", "rub", "руб.", "стал", "стала", "стали", "стало",
    "теперь", "сделай", "сделать", "поставь", "поставить", "ставим", "давай", "надо",
    "нужно", "пожалуйста", "это", "этот", "эти", "который", "которые", "тыс", "тысяч",
    "тысячи", "тысяча", "штук", "шт", "каждый", "каждую", "каждой", "всё", "везде",
}

UP_VERBS = re.compile(
    r"^(подорож\w*|поднял\w*|подним\w*|повыс\w*|повыш\w*|вырос\w*|выросл\w*|дорож\w*|дороже|прибав\w*|увелич\w*|плюс|добав\w*|накин\w*)$"
)
DOWN_VERBS = re.compile(
    r"^(подешев\w*|сниз\w*|сниж\w*|упал\w*|упад\w*|дешевле|дешев\w*|минус|уменьш\w*|скин\w*|сбрось\w*|сброс\w*|опуст\w*|убав\w*|отним\w*)$"
)
SET_WORDS = re.compile(r"^(=|равно|цена|по|стоит|стоимость|ставим|поставь|поставить|теперь|сделай|сделать)$")
EXCLUDE_WORDS = {"кроме", "без", "исключая", "минус"}  # «минус» — исключение только перед словом, не числом

NUMBER_RE = re.compile(r"^(\d+(?:[.,]\d+)?)(к|k|тыс\w*)?$")
MEMORY_RE = re.compile(r"^(\d+)\s*(гб|тб|gb|tb)$")


@dataclass
class PriceOperation:
    kind: OperationKind
    value: Decimal  # delta/percent — со знаком; set — итоговая цена

    def label(self) -> str:
        if self.kind == "set":
            return f"= {_fmt(self.value)} ₽"
        sign = "+" if self.value >= 0 else "−"
        if self.kind == "percent":
            return f"{sign}{_fmt(abs(self.value))} %"
        return f"{sign}{_fmt(abs(self.value))} ₽"


@dataclass
class ParsedCommand:
    text: str
    operation: PriceOperation | None
    tokens: list[str] = field(default_factory=list)      # что искать в названии/цвете/атрибутах
    exclude: list[str] = field(default_factory=list)     # чего быть не должно
    category_keys: list[str] = field(default_factory=list)  # ключи CATEGORY_ALIASES
    brand_tokens: list[str] = field(default_factory=list)   # бренды, распознанные по каталогу
    include_inactive: bool = False
    warnings: list[str] = field(default_factory=list)


@dataclass
class PricePreviewItem:
    id: Any
    name: str
    color: str | None
    category: str | None
    price: Decimal
    discount_price: Decimal | None
    new_price: Decimal | None
    new_discount_price: Decimal | None
    is_active: bool
    valid: bool
    reason: str | None = None


def _fmt(value: Decimal) -> str:
    q = value.quantize(Decimal("1")) if value == value.to_integral_value() else value.normalize()
    text = f"{q:,}".replace(",", " ")
    return text.replace(".", ",")


def normalize(text: str) -> str:
    """Нижний регистр, ё→е, латинские кавычки и лишние пробелы прочь."""
    t = text.lower().replace("ё", "е").replace("−", "-").replace("–", "-").replace("—", "-")
    t = re.sub(r"[\"'«»“”„]", " ", t)
    # «256 ГБ» → «256гб», чтобы совпадать с «256ГБ» в названиях
    t = re.sub(r"(\d)\s+(гб|тб|gb|tb)\b", r"\1\2", t)
    # «2 тыс» / «2 к» → «2тыс» / «2к» — единица тысяч приклеивается к числу
    t = re.sub(r"(\d+(?:[.,]\d+)?)\s+(к|k|тыс\w*)\b", r"\1\2", t)
    # «+ 2000» → «+2000»
    t = re.sub(r"([+\-=])\s+(?=\d)", r"\1", t)
    # Разряды через пробел склеиваем ТОЛЬКО у суммы операции: после знака или слов
    # «на/по/цена/стоит/до/за» («= 89 990», «на 2 000»). Иначе «s26 512» стало бы «s26512».
    t = re.sub(r"((?:^|\s)(?:на|по|цена|стоит|до|за)\s|[+\-=])(\d{1,3}) (\d{3})\b", r"\1\2\3", t)
    return re.sub(r"\s+", " ", t).strip()


def _to_number(raw: str) -> Decimal | None:
    m = NUMBER_RE.match(raw)
    if not m:
        return None
    value = Decimal(m.group(1).replace(",", "."))
    if m.group(2):
        value *= 1000
    return value


def parse_command(text: str) -> ParsedCommand:
    """Разобрать команду: операция + цель. Никаких обращений к каталогу."""
    norm = normalize(text)
    words = norm.split(" ") if norm else []
    op: PriceOperation | None = None
    warnings: list[str] = []
    target: list[str] = []
    exclude: list[str] = []
    include_inactive = False
    pending_dir: int | None = None   # направление от глагола, ждём число
    pending_set = False               # «= / цена / по» — ждём число
    excluding = False

    i = 0
    while i < len(words):
        w = words[i]
        nxt = words[i + 1] if i + 1 < len(words) else ""

        # «и скрытые» / «включая скрытые»
        if w in ("скрытые", "скрытых", "неактивные"):
            include_inactive = True
            i += 1
            continue

        # Явный знак: +2000, -1500, +5%, -5%
        m = re.match(r"^([+\-])(\d+(?:[.,]\d+)?)(к|k|тыс\w*)?(%?)$", w)
        if m and op is None:
            value = Decimal(m.group(2).replace(",", "."))
            if m.group(3):
                value *= 1000
            if m.group(1) == "-":
                value = -value
            is_pct = bool(m.group(4)) or nxt in ("%", "процент", "процента", "процентов")
            op = PriceOperation("percent" if is_pct else "delta", value)
            if not m.group(4) and nxt in ("%", "процент", "процента", "процентов"):
                i += 1
            i += 1
            continue

        # «=89990», «= 89990» (уже склеено нормализацией)
        m = re.match(r"^=(\d+(?:[.,]\d+)?)(к|k|тыс\w*)?$", w)
        if m and op is None:
            value = Decimal(m.group(1).replace(",", "."))
            if m.group(2):
                value *= 1000
            op = PriceOperation("set", value)
            i += 1
            continue

        # Одиночный процент: «5%» после глагола направления
        m = re.match(r"^(\d+(?:[.,]\d+)?)%$", w)
        if m and op is None and pending_dir is not None:
            value = Decimal(m.group(1).replace(",", ".")) * pending_dir
            op = PriceOperation("percent", value)
            pending_dir = None
            i += 1
            continue

        # Глаголы направления
        if UP_VERBS.match(w) and not (w == "плюс" and _to_number(nxt) is None):
            pending_dir = 1
            excluding = False
            i += 1
            continue
        if DOWN_VERBS.match(w) and not (w == "минус" and _to_number(nxt) is None):
            pending_dir = -1
            excluding = False
            i += 1
            continue

        # Установка цены словами: «цена 89990», «по 89990», «= 89990»
        if SET_WORDS.match(w) and _to_number(nxt) is not None and op is None and pending_dir is None:
            pending_set = True
            i += 1
            continue

        if w in EXCLUDE_WORDS:
            excluding = True
            i += 1
            continue

        # Число: либо значение операции, либо часть цели (17, 256гб, 15)
        num = _to_number(w)
        if num is not None:
            is_pct = nxt in ("%", "процент", "процента", "процентов")
            if pending_set and op is None:
                op = PriceOperation("set", num)
                pending_set = False
                i += 1
                continue
            if pending_dir is not None and op is None:
                op = PriceOperation("percent" if is_pct else "delta", num * pending_dir)
                pending_dir = None
                if is_pct:
                    i += 1
                i += 1
                continue
            # Число без операции — это часть названия («17», «16», «512гб»)
            (exclude if excluding else target).append(w)
            i += 1
            continue

        if w in STOP_WORDS or w in ("%", "процент", "процента", "процентов"):
            i += 1
            continue

        (exclude if excluding else target).append(TOKEN_ALIASES.get(w, w))
        i += 1

    if pending_dir is not None and op is None:
        warnings.append("Не понял, на сколько менять цену: напишите, например, «+2000», «−1500» или «+5%».")
    if pending_set and op is None:
        warnings.append("Не понял, какую цену поставить: напишите «= 89990».")
    if op is not None:
        if op.kind == "percent" and abs(op.value) > 95:
            warnings.append("Процент больше 95 — проверьте команду.")
        if op.kind == "set" and op.value <= 0:
            warnings.append("Цена должна быть больше нуля.")
            op = None

    parsed = ParsedCommand(text=text, operation=op, include_inactive=include_inactive, warnings=warnings)
    parsed.exclude = exclude
    # Категории распознаём по началу слова, они уходят из токенов названия
    rest: list[str] = []
    for tok in target:
        key = _category_key(tok)
        if key:
            if key not in parsed.category_keys:
                parsed.category_keys.append(key)
        else:
            rest.append(tok)
    parsed.tokens = rest
    return parsed


def _category_key(token: str) -> str | None:
    for key, prefixes in CATEGORY_ALIASES.items():
        if any(token.startswith(p) for p in prefixes):
            return key
    return None


# ── Подбор товаров ─────────────────────────────────────────────────────────────

def _product_haystack(p: Any) -> str:
    parts = [p.name or "", p.color or "", p.brand or "", p.sku or "", p.model or ""]
    attrs = getattr(p, "attributes", None)
    if isinstance(attrs, dict):
        parts.extend(str(v) for v in attrs.values() if v not in (None, ""))
    return normalize(" ".join(parts))


def resolve_targets(
    parsed: ParsedCommand,
    *,
    categories: Iterable[Any],
    brand_names: Iterable[str],
) -> tuple[set[Any], set[str], list[str]]:
    """Свести распознанные категории/бренды к id категорий и именам брендов.

    Возвращает (category_ids, brands_lower, остальные_токены)."""
    cats = list(categories)
    category_ids: set[Any] = set()
    for key in parsed.category_keys:
        prefixes = CATEGORY_ALIASES[key]
        for c in cats:
            slug = (c.slug or "").lower()
            name = normalize(c.name or "")
            if slug == key or any(name.startswith(p) or p in name for p in prefixes):
                category_ids.add(c.id)
    brands_lower = {normalize(b) for b in brand_names if b}
    brands: set[str] = set()
    rest: list[str] = []
    for tok in parsed.tokens:
        # токен может быть категорией по НАЗВАНИЮ («стайлеры») — ищем по словам названий
        matched_cat = [c for c in cats if any(word.startswith(tok) for word in normalize(c.name or "").split()) and len(tok) >= 4]
        if tok in brands_lower:
            brands.add(tok)
        elif matched_cat and tok not in brands_lower:
            category_ids.update(c.id for c in matched_cat)
        else:
            rest.append(tok)
    return category_ids, brands, rest


def compute_new_price(price: Decimal, op: PriceOperation) -> Decimal:
    if op.kind == "set":
        new = op.value
    elif op.kind == "percent":
        new = price * (Decimal(1) + op.value / Decimal(100))
    else:
        new = price + op.value
    return new.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def match_products(
    parsed: ParsedCommand,
    products: Iterable[Any],
    *,
    category_ids: set[Any],
    brands: set[str],
    tokens: list[str],
    category_names: dict[Any, str] | None = None,
) -> list[PricePreviewItem]:
    """Отобрать товары и посчитать новые цены. Ничего не меняет."""
    items: list[PricePreviewItem] = []
    has_target = bool(category_ids or brands or tokens)
    for p in products:
        if not parsed.include_inactive and not p.is_active:
            continue
        if category_ids and p.category_id not in category_ids:
            continue
        if brands and normalize(p.brand or "") not in brands:
            continue
        hay = _product_haystack(p)
        if tokens and not all(tok in hay for tok in tokens):
            continue
        if parsed.exclude and any(tok in hay for tok in parsed.exclude):
            continue
        price = Decimal(p.price)
        discount = Decimal(p.discount_price) if p.discount_price is not None else None
        new_price: Decimal | None = None
        new_discount: Decimal | None = None
        valid = True
        reason: str | None = None
        if parsed.operation is not None:
            op = parsed.operation
            new_price = compute_new_price(price, op)
            if discount is not None:
                if op.kind == "set":
                    new_discount = discount if discount < new_price else None
                else:
                    new_discount = compute_new_price(discount, op)
                    if new_discount <= 0:
                        new_discount = None
            if new_price <= 0:
                valid, reason = False, "цена ушла в ноль или ниже"
            elif new_discount is not None and new_discount >= new_price:
                valid, reason = False, "скидочная цена стала не меньше основной"
        items.append(PricePreviewItem(
            id=p.id, name=p.name, color=p.color,
            category=(category_names or {}).get(p.category_id),
            price=price, discount_price=discount,
            new_price=new_price, new_discount_price=new_discount,
            is_active=bool(p.is_active), valid=valid, reason=reason,
        ))
    if not has_target:
        # «все +5%» — законно, но пусть предпросмотр покажет, что задето ВСЁ
        parsed.warnings.append("Цель не указана — подошли все товары каталога. Проверьте список перед применением.")
    items.sort(key=lambda it: it.name.lower())
    return items
