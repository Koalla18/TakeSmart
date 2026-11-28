"""Публикация прайса и поиск по структурированным параметрам."""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Collection
from difflib import SequenceMatcher
from functools import lru_cache
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.core.avito_bot_engine import (
    COLORS, CatalogItem, _aliases, _capacity, _CAPACITY, _line_country, _sim_label,
    family_name, normalize, parse_price_list_full,
)
from src.app.core.avito_colors import color_candidates, color_key, color_spans
from src.app.database.models.avito_catalog import brands, categories, imports, models, variants
from src.app.database.models.product import Product
from src.app.database.models.product_variant import ProductVariant

_CATEGORY_NAMES = {
    "smartphone": "Смартфоны", "tablet": "Планшеты", "computer": "Компьютеры и ноутбуки",
    "headphones": "Наушники", "watch": "Часы", "vacuum": "Пылесосы", "console": "Игровые консоли",
    "camera": "Камеры и дроны", "accessory": "Аксессуары", "haircare": "Уход за волосами",
}
_CATEGORY_ALIASES = {"laptop": "computer", "phone": "smartphone", "смартфон": "smartphone",
                     "ноутбук": "computer", "пылесос": "vacuum", "планшет": "tablet"}
_BRAND_ALIASES = {"самсунг": "samsung", "эпл": "apple", "гугл": "google", "дайсон": "dyson"}
_FAMILIES = (
    (r"^iphone\b", "Apple", "smartphone"), (r"^ipad\b", "Apple", "tablet"),
    (r"^(?:macbook|imac|mac mini|mac studio)\b", "Apple", "computer"),
    (r"^airpods\b", "Apple", "headphones"), (r"^(?:apple )?watch\b", "Apple", "watch"),
    (r"^(?:samsung )?(?:galaxy )?(?:[asz]\s*\d{2}\w*|z ?(?:fold|flip)\w*)\b", "Samsung", "smartphone"),
    (r"^(?:samsung )?galaxy tab\b", "Samsung", "tablet"),
    (r"^(?:samsung )?galaxy (?:buds|watch)\b", "Samsung", None),
    (r"^(?:google )?pixel\s*\d+", "Google", "smartphone"),
    (r"^(?:sony )?(?:playstation|ps5)\b", "Sony", "console"),
    (r"^(?:xiaomi |poco )?(?:redmi|poco)\b", "Xiaomi", "smartphone"),
    (r"^huawei (?:matebook)\b", "Huawei", "computer"),
    (r"^dji\b", "DJI", "camera"), (r"^gopro\b", "GoPro", "camera"),
    (r"^dyson (?:v\d+|gen\d+|washg1)\b", "Dyson", "vacuum"),
    (r"^dyson (?:airwrap|supersonic|airstrait|hs\d{2}|ht\d{2})\b", "Dyson", "haircare"),
    (r"^(?:блок|адаптер|зарядка) apple\b", "Apple", "accessory"),
    (r"^(?:apple )?(?:magic|apple pencil|airtag)\b", "Apple", "accessory"),
    (r"^(?:nothing )?phone \d", "Nothing", "smartphone"),
    (r"^honor (?:magic|x|\d)", "Honor", "smartphone"),
    (r"^xiaomi (?:\d|mix)", "Xiaomi", "smartphone"),
)
_SIM = {"2 sim": "two_physical", "две физические sim": "two_physical", "two physical": "two_physical",
        "2 physical sim": "two_physical", "sim esim": "physical_esim", "physical esim": "physical_esim",
        "только esim": "esim_only", "esim only": "esim_only", "esim": "esim_only",
        "1 sim": "one_physical", "one physical": "one_physical", "physical": "has_physical",
        "has physical": "has_physical", "физическая sim": "has_physical"}
_SIM_LABEL = {"two_physical": "2 SIM", "physical_esim": "SIM + eSIM", "esim_only": "только eSIM",
              "one_physical": "1 SIM"}
Scalar = str | int | bool


class ImportColors:
    """Additional finish names and translations explicitly paired in this price revision."""

    def __init__(self, aliases: dict[str, set[str]]):
        self.aliases = aliases
        # Keep punctuation in the rest of the title (notably 8/256 and SIM + eSIM).
        phrases = [r"[\W_]+".join(map(re.escape, alias.split())) for alias in sorted(aliases, key=len, reverse=True)]
        self.pattern = re.compile(r"(?<!\w)(?:" + "|".join(phrases) + r")(?!\w)", re.I) if phrases else None

    def candidates(self, value: str) -> set[str]:
        name = normalize(value)
        declared = self.aliases.get(name)
        standard = color_candidates(value)
        if declared and standard == {name} and name not in _OFFICIAL_COLORS:
            return declared
        return standard | (declared or set())

    def key(self, value: str) -> str:
        if normalize(value) not in self.aliases:
            return color_key(value)
        choices = self.candidates(value)
        return next(iter(choices)) if len(choices) == 1 else normalize(value)

    def spans(self, text: str) -> list[tuple[int, int, str]]:
        standard = color_spans(text)
        if not self.pattern:
            return standard
        custom = [(m.start(), m.end(), self.key(m[0]))
                  for m in self.pattern.finditer(text.replace("ё", "е").replace("Ё", "Е"))]
        # A complete official name with its translation wins over a word inside it.
        result = []
        for span in sorted(custom + standard, key=lambda match: (match[0], -match[1])):
            if not result or span[0] >= result[-1][1]:
                result.append(span)
        return result

    def mentions(self, text: str) -> list[str]:
        return list(dict.fromkeys(shade for _, _, shade in self.spans(text)))


_STANDARD_PALETTE = ImportColors({})
_OFFICIAL_COLORS = {normalize(official) for official, _ in COLORS.values()}
# Historical imports can contain a normalized translation or a complete bilingual label.
_HISTORICAL_LABELS = {
    normalize(label) for alias, (official, translated) in COLORS.items()
    for label in (alias, translated, f"{official} {translated}", f"{translated} {official}")
}


@lru_cache(maxsize=2)
def import_colors(price_text: str) -> ImportColors:
    aliases: dict[str, set[str]] = {}
    items, _, _ = parse_price_list_full(price_text, deduplicate=False)
    for item in items:
        attrs = {**item.attributes, **item.attributes.get("catalog_attributes", {})}
        raw = attrs.get("color")
        if not isinstance(raw, str) or not raw.strip():
            continue
        official = color_key(raw)
        if not official:
            continue
        if official not in _OFFICIAL_COLORS:
            aliases.setdefault(normalize(raw), set()).add(official)
        translation = attrs.get("color_ru")
        if not isinstance(translation, str) or not normalize(translation):
            continue
        if official not in color_candidates(translation):
            for phrase in (translation, f"{raw} {translation}", f"{translation} {raw}"):
                aliases.setdefault(normalize(phrase), set()).add(official)
    return ImportColors(aliases)


@lru_cache(maxsize=512)
def _stored_color_labels(official: str) -> frozenset[str]:
    return frozenset({official} | {label for label in _HISTORICAL_LABELS if color_key(label) == official})


def brand_key(name: str) -> str:
    key = normalize(name)
    return _BRAND_ALIASES.get(key, key)


def category_key(name: str) -> str:
    key = normalize(name)
    return _CATEGORY_ALIASES.get(key, key)


def model_key(value: str, brand: str = "") -> str:
    aliases = _aliases()
    value = re.sub(r"(?<=\d)\+(?=\s|$)", " plus", value)
    aliases = {**aliases, "ультра": "ultra", "ультру": "ultra", "галакси": "galaxy"}
    key = " ".join(aliases.get(word, word) for word in normalize(value).split())
    key = re.sub(r"(?<!\w)[сs]\s*(?=\d{2}\b)", "s", key)
    key = re.sub(r"\b(fold|flip|pixel)\s*(?=\d)", r"\1 ", key)
    if brand and key.startswith(brand + " "):
        key = key[len(brand) + 1:]
    key = re.sub(r"^galaxy (?=[asz]\d|z\s*(?:fold|flip))", "", key)
    if key.startswith("ipad "):
        key = re.sub(r"\bwi\s*fi\b", "wifi", key)
        key = re.sub(r"\b(?:cellular|lte)\b", "cellular", key)
        return "ipad " + " ".join(sorted(key.split()[1:]))
    if brand == "dyson" and (code := re.search(r"\b(?:hs|ht)\d{2}\b", key)):
        return code[0]
    return key


def attribute_value(key: str, value: Scalar) -> Scalar:
    if key in ("ram_gb", "storage_gb"):
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
        match = _CAPACITY.fullmatch(str(value).strip())
        if match:
            return _capacity(match)[1]
        if str(value).isdigit():
            return int(value)
    if key == "sim":
        return _SIM.get(normalize(str(value)), normalize(str(value)))
    if key == "color":
        return color_key(str(value))
    if key in ("region", "country"):
        region = _line_country(str(value)) or str(value)
        return _aliases().get(normalize(region), normalize(region))
    return normalize(value) if isinstance(value, str) else value


def identity(item: CatalogItem) -> tuple[str, str, str]:
    attrs = item.attributes
    model = attrs.get("catalog_model") or family_name(item)
    if re.match(r"^duo\b", normalize(model)):
        model = "iPhone " + model
    if re.match(r"^(?:hs|ht)\d{2}\b", normalize(model)):
        model = "Dyson " + model
    brand, category = attrs.get("catalog_brand"), attrs.get("catalog_category")
    if not brand or not category:
        clean = normalize(model)
        for pattern, known_brand, known_category in _FAMILIES:
            if re.search(pattern, clean):
                brand = brand or known_brand
                category = category or known_category or ("headphones" if "buds" in clean else "watch")
                break
    return brand or "", category_key(category or ""), model


def normalized_attrs(item: CatalogItem) -> dict[str, Scalar]:
    raw = item.attributes
    values = {key: value for key, value in raw.get("catalog_attributes", {}).items()
              if key != "color_ru" and value is not None}
    if raw.get("few"):
        values["few"] = True
    storage = _CAPACITY.fullmatch(raw.get("storage") or "")
    if storage:
        ram, size = _capacity(storage)
        values.update(storage_gb=size)
        if ram:
            values["ram_gb"] = int(ram)
    for source, target in (("color", "color"), ("country", "region"), ("sim", "sim")):
        if raw.get(source):
            values[target] = raw[source]
    return {key: attribute_value(key, val) for key, val in values.items()}


def price_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def variant_identity(item: CatalogItem, *, ignore_region_and_sim: bool = False) -> tuple[tuple[str, str, str], str]:
    brand, category, model = identity(item)
    brand = brand_key(brand)[:120]
    model_id = (brand, category[:120], model_key(model, brand)[:300])
    ignored = {"few", "region", "sim"} if ignore_region_and_sim else {"few"}
    attrs = {key: value for key, value in normalized_attrs(item).items() if key not in ignored}
    return model_id, json.dumps(attrs, sort_keys=True, ensure_ascii=False)


def variant_key(item: CatalogItem) -> str:
    return price_hash(json.dumps(variant_identity(item), ensure_ascii=False))


def prepare(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    items, errors, _ = parse_price_list_full(text, deduplicate=False)
    lines = text.splitlines()
    rows: dict[str, dict[str, Any]] = {}
    for item in items:
        brand, category, model = identity(item)
        if not brand or not category or not model.strip():
            errors.append(f"{item.name}: укажите производителя, тип и модель в структурированной строке")
            continue
        model_id, _ = variant_identity(item)
        if not model_id[0] or not model_id[1] or not model_id[2] or not 0 < item.price < 10**10:
            errors.append(f"{item.name}: проверьте производителя, тип, модель и цену")
            continue
        attrs = normalized_attrs(item)
        digest = variant_key(item)
        number = int(str(item.key).split(":")[1].split(".")[0])
        record = dict(key=digest, model_key=model_id, brand_name=brand[:120], model_name=model[:300],
                      name=item.name[:350], attributes=attrs, price=Decimal(str(item.price)),
                      available=item.stock > 0, source_number=number,
                      source_line=item.attributes.get("source_line") or lines[number - 1], item=item)
        previous = rows.get(digest)
        if previous and (previous["price"], previous["available"]) != (record["price"], record["available"]):
            errors.append(f"Строки {previous['source_number']} и {number}: разные цены или наличие одной комплектации {item.name}")
        if previous is None or (not record["available"], record["price"]) < (not previous["available"], previous["price"]):
            rows[digest] = record
    return list(rows.values()), errors


def publish(connection, price_text: str, *, source: str | None = None) -> None:
    prepared, errors = prepare(price_text)
    for table, values in (
        (brands, {row["model_key"][0]: row["brand_name"] for row in prepared}),
        (categories, {row["model_key"][1]: _CATEGORY_NAMES.get(row["model_key"][1], row["model_key"][1])
                      for row in prepared}),
    ):
        if values:
            connection.execute(insert(table).on_conflict_do_nothing(),
                                  [{"key": key, "name": name} for key, name in values.items()])
    keys = {row["model_key"]: row["model_name"] for row in prepared}
    if keys:
        connection.execute(insert(models).on_conflict_do_nothing(), [
            dict(brand_key=brand, category_key=category, key=key, name=name)
            for (brand, category, key), name in keys.items()
        ])
        result = connection.execute(select(models).where(
            tuple_(models.c.brand_key, models.c.category_key, models.c.key).in_(keys)
        ))
        model_ids = {(r.brand_key, r.category_key, r.key): r.id for r in result}
    import_id = (connection.execute(insert(imports).values(
        source_hash=price_hash(price_text), source=price_text if source is None else source, errors=errors
    ).returning(imports.c.id))).scalar_one()
    if prepared:
        connection.execute(insert(variants), [
            {**{key: row[key] for key in ("key", "name", "attributes", "price", "available", "source_number", "source_line")},
             "import_id": import_id, "model_id": model_ids[row["model_key"]]}
            for row in prepared
        ])


async def active_import(session: AsyncSession, price_text: str) -> int | None:
    return await session.scalar(select(imports.c.id).where(
        imports.c.source_hash == price_hash(price_text)
    ).order_by(imports.c.id.desc()).limit(1))


class ProductQuery(BaseModel):
    brand: str | None = Field(None, max_length=120)
    category: str | None = Field(None, max_length=120)
    model: str | None = Field(None, max_length=280)
    model_id: int | None = Field(None, gt=0)
    attributes: dict[str, Scalar] = Field(default_factory=dict, max_length=20)
    required: list[str] = Field(default_factory=list, max_length=20)
    reference: Literal["explicit", "conversation", "listing"] = "explicit"

    @model_validator(mode="after")
    def check_required(self):
        if set(self.required) - self.attributes.keys():
            raise ValueError("Обязательное условие должно быть в attributes")
        return self


class SearchIntent(BaseModel):
    queries: list[ProductQuery] = Field(max_length=6)
    clarification: str | None = Field(None, max_length=280)
    booking_requested: bool = False
    price_requested: bool = False


_PRODUCT_CODE = re.compile(r"\b(?:[a-z]*\d+[a-z0-9]*|pro|max|ultra|plus|mini|air|fe|anc|wifi|cellular)\b")


def _similar_model(asked: str, candidate: str) -> bool:
    if not asked or _PRODUCT_CODE.findall(asked) != _PRODUCT_CODE.findall(candidate):
        return False
    return SequenceMatcher(None, asked, candidate).ratio() >= 0.85


async def models_in_text(session: AsyncSession, import_id: int | None, text: str) -> list[ProductQuery]:
    """Извлекает известные названия из исходных слов клиента, даже если модель переписала их."""
    if not import_id:
        return []
    normalized = " " + normalize(text) + " "
    candidates = (await session.execute(select(models.c.brand_key, models.c.category_key, models.c.name, models.c.key)
        .join(variants, variants.c.model_id == models.c.id)
        .where(variants.c.import_id == import_id).distinct())).all()
    mentions = {}
    for brand, category, name, key in candidates:
        names = {" ".join(normalize(name).split()), key}
        if brand == "dyson" and re.fullmatch(r"(?:hs|ht)\d{2}", key):
            names.add(key)
        for label in names:
            if not label or " " + label + " " not in normalized:
                continue
            start = normalized.index(" " + label + " ")
            end = start + len(label) + 1
            mentions[(start, end, brand, category, key)] = ProductQuery(brand=brand, category=category, model=name)
    choices = {}
    for (start, end, brand, category, key), query in sorted(mentions.items()):
        if not any(left <= start and end <= right and (left, right) != (start, end)
                   for left, right, *_ in mentions):
            choices.setdefault((brand, category, key), query)
    return list(choices.values())


@dataclass
class Match:
    item: CatalogItem
    relation: Literal["exact", "same_model", "other_model"]
    differences: dict[str, dict[str, Scalar | None]] = field(default_factory=dict)


@dataclass
class SearchResult:
    query: ProductQuery
    matches: list[Match]
    status: Literal["exact", "same_model", "other_model", "not_found", "ambiguous", "unavailable"]
    revision: int | None = None
    storefront: Literal["listed", "in_stock"] | None = None

    def context(self) -> dict[str, Any]:
        return {"query": self.query.model_dump(exclude_none=True), "status": self.status, "revision": self.revision,
                **({"storefront": self.storefront} if self.storefront else {}), "matches": [
            {"id": m.item.key, "name": m.item.name, "attributes": m.item.attributes.get("catalog_attributes", {}),
             "price_rub": int(m.item.price), "relation": m.relation, "differences": m.differences,
             "source_line": m.item.attributes.get("source_line"), "source_number": m.item.attributes.get("source_number"),
             "model_id": m.item.attributes.get("model_id"), "model": m.item.attributes.get("catalog_model")}
            for m in self.matches
        ]}


def _item(row) -> CatalogItem:
    attrs = row.attributes
    ram, storage = attrs.get("ram_gb"), attrs.get("storage_gb")
    storage_label = f"{ram}/{storage} ГБ" if ram and storage else f"{storage} ГБ" if storage else None
    return CatalogItem(name=row.name, category=row.category_key, price=float(row.price), stock=int(row.available),
        attributes={**{k: v for k, v in (
            ("storage", storage_label), ("color", attrs.get("color")), ("country", attrs.get("region")),
            ("sim", _SIM_LABEL.get(attrs.get("sim"))), ("few", attrs.get("few")),
        ) if v}, "catalog_attributes": attrs, "catalog_model": row.model_name,
            "source_line": row.source_line, "source_number": row.source_number, "model_id": row.model_id}, key=row.key)


def rows_for(import_id: int):
    return select(variants, models.c.key.label("model_key"), models.c.name.label("model_name"),
                  models.c.brand_key, models.c.category_key).join(models).where(variants.c.import_id == import_id)


def _matches_value(key: str, expected: Scalar, actual: Scalar | None, colors: Collection[str]) -> bool:
    if key == "color":
        return actual in colors
    if key == "sim" and expected == "has_physical":
        return actual in ("two_physical", "physical_esim", "one_physical")
    return actual == expected


_SAMSUNG_PHONE_KEY = re.compile(r"([as]\d{2}[a-z]?(?: (?:ultra|plus|fe))?)(?: ([45] ?g|lte))?")
_IPAD_YEAR = re.compile(r"20\d{2}")
_IPAD_CHIP = re.compile(r"m[1-9]\d*")


def _ipad_release(key: str) -> tuple[tuple[str, ...], str | None] | None:
    ipad, _, tail = key.partition(" ")
    features = tail.split()
    years = [value for value in features if _IPAD_YEAR.fullmatch(value)]
    hardware = tuple(value for value in features if not _IPAD_YEAR.fullmatch(value))
    if (ipad != "ipad" or len(years) > 1 or len(hardware) != 4
            or len(set(hardware) & {"air", "pro"}) != 1
            or len(set(hardware) & {"11", "12", "13"}) != 1
            or len(set(hardware) & {"wifi", "cellular"}) != 1
            or sum(bool(_IPAD_CHIP.fullmatch(value)) for value in hardware) != 1):
        return None
    return hardware, years[0] if years else None


async def _ipad_year_keys(session: AsyncSession, scope, key: str, model_id: int | None) -> tuple[str, ...]:
    release = _ipad_release(key)
    if not release:
        return (key,)
    hardware, year = release
    rows = (await session.execute(scope.with_only_columns(variants.c.model_id, models.c.key)
                                  .where(models.c.key.like("ipad %")).distinct())).all()
    if model_id and not any(row.model_id == model_id and row.key == key for row in rows):
        return (key,)
    candidates = {}
    for row in rows:
        candidate = _ipad_release(row.key)
        if candidate and candidate[0] == hardware:
            candidates[row.key] = candidate[1]
    known_years = {value for value in [year, *candidates.values()] if value}
    # An omitted year is compatible only in the absence of contrary year evidence for the same hardware.
    if len(known_years) > 1:
        return (key,)
    return tuple(dict.fromkeys((key, *candidates)))


def _compatible_model_keys(key: str, brand: str) -> tuple[str, ...]:
    # Старые загрузки хранят «5G» как часть модели. Без указания сети ищем обе версии
    # конкретной модели; явно заданные 4G/LTE и 5G остаются разными.
    match = _SAMSUNG_PHONE_KEY.fullmatch(key) if brand == "samsung" else None
    if not match:
        return (key,)
    family, network = match.groups()
    if network in ("5g", "5 g"):
        return f"{family} 5g", f"{family} 5 g"
    if network:
        return f"{family} 4g", f"{family} 4 g", f"{family} lte"
    return family, f"{family} 5g", f"{family} 5 g", f"{family} 4g", f"{family} 4 g", f"{family} lte"


async def search(session: AsyncSession, import_id: int | None, query: ProductQuery, limit: int = 6,
                 *, spread_storage: bool = False, allow_other_models: bool = True,
                 palette: ImportColors | None = None) -> SearchResult:
    brand = brand_key(query.brand or "")
    category = category_key(query.category or "")
    key = model_key(query.model or "", brand)
    if not import_id or not (query.model_id or key or brand or category):
        return SearchResult(query, [], "not_found", import_id)
    scope = rows_for(import_id)
    if brand:
        scope = scope.where(models.c.brand_key == brand)
    if category:
        scope = scope.where(models.c.category_key == category)
    same_model = not key
    year_keys = await _ipad_year_keys(session, scope, key, query.model_id) if key.startswith("ipad ") else (key,)
    if len(year_keys) > 1:
        scope = scope.where(models.c.key.in_(year_keys))
        same_model = True
    elif query.model_id:
        scope = scope.where(variants.c.model_id == query.model_id)
        same_model = True
    elif key:
        keys = _compatible_model_keys(key, brand)
        if brand in ("apple", "samsung") and category == "smartphone" and (
            attribute_value("sim", query.attributes.get("sim", "")) == "esim_only"
        ):
            # До исправления разбора «только eSIM» оставляло «только» в ключе модели.
            keys += tuple(f"{candidate} только" for candidate in keys)
        identity_filter = models.c.key.in_(keys)
        if not brand:
            # Structured imports can introduce a brand unknown to the free-text title parser.
            identity_filter |= func.concat(models.c.brand_key, " ", models.c.key).in_(keys)
        model_scope = scope.where(identity_filter)
        model_ids = list(await session.scalars(
            model_scope.with_only_columns(variants.c.model_id).distinct().limit(2)
        ))
        if not model_ids:
            candidate_rows = (await session.execute(scope.with_only_columns(variants.c.model_id, models.c.key).distinct())).all()
            compatible = []
            if key.startswith("ipad "):
                requested_tokens = set(key.split())
                compatible = [row.model_id for row in candidate_rows if requested_tokens < set(row.key.split())]
            if not compatible:
                compatible = [row.model_id for row in candidate_rows if _similar_model(key, row.key)]
            if len(compatible) > 1:
                return SearchResult(query, [], "ambiguous", import_id)
            if compatible:
                model_ids = compatible
                model_scope = scope.where(variants.c.model_id == compatible[0])
        if len(model_ids) > 1 and len(keys) == 1:
            return SearchResult(query, [], "ambiguous", import_id)
        if model_ids:
            scope = model_scope
            same_model = True
        elif not (allow_other_models and brand and category):
            return SearchResult(query, [], "not_found", import_id)

    wanted = {k: attribute_value(k, v) for k, v in query.attributes.items()}
    conditions = {
        k: variants.c.attributes[k].astext.in_(("two_physical", "physical_esim", "one_physical"))
        if k == "sim" and value == "has_physical" else variants.c.attributes.contains({k: value})
        for k, value in wanted.items()
    }
    color_labels: set[str] = set()
    allowed_colors: set[str] = set()
    if "color" in wanted:
        raw = str(query.attributes["color"])
        allowed_colors = (palette or _STANDARD_PALETTE).candidates(raw)
        for shade in allowed_colors | {str(wanted["color"])}:
            color_labels.update(_stored_color_labels(shade))
        conditions["color"] = variants.c.attributes["color"].astext.in_(sorted(color_labels))
    scoring = sum(case((condition, 0), else_=1) for condition in conditions.values())
    model_scope = scope
    scope = scope.where(variants.c.available.is_(True), *(conditions[k] for k in query.required))
    priority = [case((conditions[k], 0), else_=1) for k in ("storage_gb", "ram_gb") if k in conditions]
    if conditions:
        priority.append(scoring)
    price_order = [variants.c.price, variants.c.key]
    spread = []
    if spread_storage and "storage_gb" not in wanted:
        spread.append(variants.c.attributes["storage_gb"].astext)
    if len(allowed_colors) > 1:
        spread.append(variants.c.attributes["color"].astext)
    if spread:
        priority.append(func.row_number().over(partition_by=spread, order_by=[*priority, *price_order]))
    rows = (await session.execute(scope.order_by(*priority, *price_order).limit(limit))).all()
    matches = []
    for row in rows:
        differences = {k: {"requested": value, "found": row.attributes.get(k)} for k, value in wanted.items()
                       if not _matches_value(k, value, row.attributes.get(k), color_labels)}
        relation = "other_model" if not same_model else "same_model" if differences else "exact"
        matches.append(Match(_item(row), relation, differences))
    if same_model and (key or query.model_id) and (not matches or matches[0].relation != "exact"):
        unavailable = await session.scalar(model_scope.with_only_columns(variants.c.key)
            .where(variants.c.available.is_(False), *conditions.values()).limit(1))
        if unavailable:
            return SearchResult(query, matches, "unavailable", import_id)
    return SearchResult(query, matches, matches[0].relation if matches else "not_found", import_id)


def listing_query(title: str | None, palette: ImportColors | None = None) -> ProductQuery | None:
    if not title or "\n" in title or "|" in title or ";" in title:
        return None
    custom = None
    if palette and palette.pattern:
        spans = palette.spans(title)
        if len(spans) == 1:
            start, end, shade = spans[0]
            if normalize(title[start:end]) in palette.aliases:
                custom = shade
                title = title[:start] + " " + title[end:]
    parsed, _, _ = parse_price_list_full(f"{title} — 99999 ₽")
    if not parsed:
        return None
    brand, category, model = identity(parsed[0])
    attrs = normalized_attrs(parsed[0])
    attrs.pop("few", None)
    if custom:
        attrs["color"] = custom
    return ProductQuery(brand=brand or None, category=category or None, model=model,
                        attributes=attrs, reference="listing")


@lru_cache(maxsize=2048)
def _storefront_title(title: str, palette: ImportColors | None) -> ProductQuery | None:
    return listing_query(title, palette)


async def confirm_storefront_variants(session: AsyncSession, results: list[SearchResult],
                                      palette: ImportColors | None = None) -> None:
    """Проверяем комплектацию по каталогу магазина. Цены магазина здесь не читаем."""
    palette = palette or _STANDARD_PALETTE
    unresolved = [
        (result, brand_key(result.query.brand or ""), category_key(result.query.category or ""),
         model_key(result.query.model or "", brand_key(result.query.brand or "")))
        for result in results
        if result.query.model and result.status in ("not_found", "same_model", "unavailable")
    ]
    if not unresolved:
        return
    products = (await session.execute(select(
        Product.id, Product.name, Product.brand, Product.color, Product.attributes, Product.stock_quantity,
    ).where(Product.is_active.is_(True), Product.is_preorder.is_(False), Product.condition != "used"))).all()
    candidates = []
    for product in products:
        title = _storefront_title(product.name, palette)
        if not title or not title.model:
            continue
        brand = brand_key(title.brand or product.brand or "")
        category = category_key(title.category or "")
        key = model_key(title.model, brand)
        for result, wanted_brand, wanted_category, wanted_key in unresolved:
            same_model = key == wanted_key or (not wanted_brand and wanted_key == f"{brand} {key}")
            if not same_model or (wanted_brand and wanted_brand != brand) or (
                wanted_category and category and wanted_category != category
            ):
                continue
            attrs = dict(title.attributes)
            stored_color = (product.attributes or {}).get("color") or product.color
            if isinstance(stored_color, str) and stored_color.strip():
                field_color = palette.key(stored_color)
                title_color = attrs.get("color")
                if not title_color or field_color in palette.candidates(str(title_color)):
                    attrs["color"] = field_color
            for attr in result.query.attributes.keys() - attrs.keys():
                value = (product.attributes or {}).get(attr)
                if value is None and attr == "color":
                    value = product.color
                if isinstance(value, (str, int)):
                    attrs[attr] = attribute_value(attr, value)
            candidates.append((result, product, attrs))
    if not candidates:
        return

    variant_rows = (await session.execute(select(
        ProductVariant.product_id, ProductVariant.color, ProductVariant.storage,
        ProductVariant.stock_quantity, ProductVariant.is_active,
    ).where(ProductVariant.product_id.in_({product.id for _, product, _ in candidates})))).all()
    by_product: dict[UUID, list] = {}
    for variant in variant_rows:
        by_product.setdefault(variant.product_id, []).append(variant)
    for result, product, attrs in candidates:
        wanted = {key: attribute_value(key, value) for key, value in result.query.attributes.items()}
        expected_colors = set()
        if "color" in wanted:
            raw = str(result.query.attributes["color"])
            expected_colors = palette.candidates(raw) | {str(wanted["color"])}
        product_variants = by_product.get(product.id)
        offers = [(attrs, product.stock_quantity)] if not product_variants else []
        for variant in product_variants or []:
            if not variant.is_active:
                continue
            features = dict(attrs)
            if variant.color:
                features["color"] = palette.key(variant.color)
            if variant.storage:
                if capacity := _CAPACITY.fullmatch(variant.storage.strip()):
                    ram, storage = _capacity(capacity)
                    features["storage_gb"] = storage
                    if ram:
                        features["ram_gb"] = int(ram)
                else:
                    features["storage_gb"] = attribute_value("storage_gb", variant.storage)
            offers.append((features, variant.stock_quantity))
        for features, stock in offers:
            if all(_matches_value(key, value, features.get(key), expected_colors) for key, value in wanted.items()):
                if stock > 0:
                    result.storefront = "in_stock"
                    break
                if not result.storefront:
                    result.storefront = "listed"


async def listing_items(session: AsyncSession, import_id: int | None, title: str | None,
                        palette: ImportColors | None = None) -> list[CatalogItem]:
    query = listing_query(title, palette)
    if not query:
        return []
    result = await search(session, import_id, query, palette=palette)
    return [match.item for match in result.matches if match.relation == "exact"]
