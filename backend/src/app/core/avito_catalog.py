"""Публикация прайса и поиск по структурированным параметрам."""
from __future__ import annotations

import hashlib
import json
import re
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
from src.app.database.models.avito_catalog import brands, categories, imports, models, variants

_CATEGORY_NAMES = {
    "smartphone": "Смартфоны", "tablet": "Планшеты", "computer": "Компьютеры и ноутбуки",
    "headphones": "Наушники", "watch": "Часы", "vacuum": "Пылесосы", "console": "Игровые консоли",
    "camera": "Камеры и дроны", "accessory": "Аксессуары",
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
    (r"^dyson (?:airwrap|supersonic|airstrait)\b", "Dyson", "haircare"),
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
        color = COLORS.get(normalize(str(value)))
        return normalize(color[0]) if color else _aliases().get(normalize(str(value)), normalize(str(value)))
    if key in ("region", "country"):
        region = _line_country(str(value)) or str(value)
        return _aliases().get(normalize(region), normalize(region))
    return normalize(value) if isinstance(value, str) else value


def identity(item: CatalogItem) -> tuple[str, str, str]:
    attrs = item.attributes
    model = attrs.get("catalog_model") or family_name(item)
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
    values = {key: value for key, value in raw.get("catalog_attributes", {}).items() if value is not None}
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


def prepare(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    items, errors, _ = parse_price_list_full(text)
    lines = text.splitlines()
    rows: dict[str, dict[str, Any]] = {}
    for item in items:
        brand, category, model = identity(item)
        if not brand or not category or not model.strip():
            errors.append(f"{item.name}: укажите производителя, тип и модель в структурированной строке")
            continue
        model_id = (brand_key(brand)[:120], category[:120], model_key(model, brand_key(brand))[:300])
        if not model_id[0] or not model_id[1] or not model_id[2] or not 0 < item.price < 10**10:
            errors.append(f"{item.name}: проверьте производителя, тип, модель и цену")
            continue
        attrs = normalized_attrs(item)
        digest = price_hash(json.dumps([model_id, {k: v for k, v in attrs.items() if k != "few"}], sort_keys=True, ensure_ascii=False))
        number = int(str(item.key).split(":")[1].split(".")[0])
        record = dict(key=digest, model_key=model_id, brand_name=brand[:120], model_name=model[:300],
                      name=item.name[:350], attributes=attrs, price=Decimal(str(item.price)),
                      available=item.stock > 0, source_number=number,
                      source_line=item.attributes.get("source_line") or lines[number - 1])
        if digest not in rows or record["price"] < rows[digest]["price"]:
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


@dataclass
class Match:
    item: CatalogItem
    relation: Literal["exact", "same_model", "other_model"]
    differences: dict[str, dict[str, Scalar | None]] = field(default_factory=dict)


@dataclass
class SearchResult:
    query: ProductQuery
    matches: list[Match]
    status: Literal["exact", "same_model", "other_model", "not_found", "ambiguous"]

    def context(self) -> dict[str, Any]:
        return {"query": self.query.model_dump(exclude_none=True), "status": self.status, "matches": [
            {"id": m.item.key, "name": m.item.name, "attributes": m.item.attributes.get("catalog_attributes", {}),
             "price_rub": int(m.item.price), "relation": m.relation, "differences": m.differences}
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
        ) if v}, "catalog_attributes": attrs, "catalog_model": row.model_name}, key=row.key)


def rows_for(import_id: int):
    return select(variants, models.c.key.label("model_key"), models.c.name.label("model_name"),
                  models.c.brand_key, models.c.category_key).join(models).where(variants.c.import_id == import_id)


def _matches_value(key: str, expected: Scalar, actual: Scalar | None) -> bool:
    if key == "sim" and expected == "has_physical":
        return actual in ("two_physical", "physical_esim", "one_physical")
    return actual == expected


async def search(session: AsyncSession, import_id: int | None, query: ProductQuery, limit: int = 6,
                 *, spread_storage: bool = False) -> SearchResult:
    brand = brand_key(query.brand or "")
    category = category_key(query.category or "")
    key = model_key(query.model or "", brand)
    if not import_id or not (key or brand or category):
        return SearchResult(query, [], "not_found")
    scope = rows_for(import_id)
    if brand:
        scope = scope.where(models.c.brand_key == brand)
    if category:
        scope = scope.where(models.c.category_key == category)
    same_model = not key
    if key:
        model_scope = scope.where(models.c.key == key)
        model_ids = list(await session.scalars(
            model_scope.with_only_columns(variants.c.model_id).distinct().limit(2)
        ))
        if len(model_ids) > 1:
            return SearchResult(query, [], "ambiguous")
        if model_ids:
            scope = model_scope
            same_model = True
        elif not (brand and category):
            return SearchResult(query, [], "not_found")

    wanted = {k: attribute_value(k, v) for k, v in query.attributes.items()}
    conditions = {
        k: variants.c.attributes[k].astext.in_(("two_physical", "physical_esim", "one_physical"))
        if k == "sim" and value == "has_physical" else variants.c.attributes.contains({k: value})
        for k, value in wanted.items()
    }
    scoring = sum(case((condition, 0), else_=1) for condition in conditions.values())
    scope = scope.where(variants.c.available.is_(True), *(conditions[k] for k in query.required))
    priority = [scoring] if conditions else []
    price_order = [variants.c.price, variants.c.key]
    if spread_storage and "storage_gb" not in wanted:
        priority.append(func.row_number().over(
            partition_by=variants.c.attributes["storage_gb"].astext, order_by=[*priority, *price_order],
        ))
    rows = (await session.execute(scope.order_by(*priority, *price_order).limit(limit))).all()
    matches = []
    for row in rows:
        differences = {k: {"requested": value, "found": row.attributes.get(k)} for k, value in wanted.items()
                       if not _matches_value(k, value, row.attributes.get(k))}
        relation = "other_model" if not same_model else "same_model" if differences else "exact"
        matches.append(Match(_item(row), relation, differences))
    return SearchResult(query, matches, matches[0].relation if matches else "not_found")


def listing_query(title: str | None) -> ProductQuery | None:
    if not title or "\n" in title or "|" in title or ";" in title:
        return None
    parsed, _, _ = parse_price_list_full(f"{title} — 99999 ₽")
    if not parsed:
        return None
    brand, category, model = identity(parsed[0])
    attrs = normalized_attrs(parsed[0])
    attrs.pop("few", None)
    return ProductQuery(brand=brand or None, category=category or None, model=model,
                        attributes=attrs, reference="listing")


async def listing_items(session: AsyncSession, import_id: int | None, title: str | None) -> list[CatalogItem]:
    query = listing_query(title)
    if not query:
        return []
    result = await search(session, import_id, query)
    return [match.item for match in result.matches if match.relation == "exact"]
