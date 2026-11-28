"""Обновление прайса бота кусками: что изменится, если вставить новые цены.

Сравнивает текущую базу с тем, что прислали (одно сообщение или весь прайс), и отдаёт
список изменений; применяются только те, что не сняты галочкой. Чистые функции: без базы
и сети.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Literal, Sequence

from src.app.core.avito_bot_engine import (
    CatalogItem, family_name, parse_price_list_full, position_key, price_storage_gb, words_without_years,
)
from src.app.core.avito_catalog import brand_key, identity, model_key

# models — пропажи только у моделей из вставленного текста; full — это весь прайс; add — ничего не удалять
Mode = Literal["models", "full", "add"]
JUMP = 0.15          # изменение цены больше чем на 15% просим проверить


@dataclass
class Change:
    id: str
    kind: str                       # changed | added | removed
    old: CatalogItem | None
    new: CatalogItem | None
    warning: str | None = None

    @property
    def item(self) -> CatalogItem:
        return self.new or self.old   # type: ignore[return-value]


@dataclass
class Diff:
    changes: list[Change]
    unchanged: int
    errors: list[str]               # строки вставленного текста, которые не прочитались
    duplicates: list[str]           # повторы во вставленном: взята меньшая цена
    base_errors: int                # строки старой базы, которые бот и так не читал
    new_count: int


def base_hash(text: str) -> str:
    return hashlib.sha1((text or "").encode()).hexdigest()


def _attr(it: CatalogItem, name: str) -> str | None:
    return (it.attributes or {}).get(name)


def _change_id(kind: str, it: CatalogItem) -> str:
    return f"{kind}:{hashlib.sha1(repr(position_key(it)).encode()).hexdigest()[:16]}"


def _scope(it: CatalogItem) -> tuple:
    """Модель одной версии: пропавшими считаем только позиции из таких же, что есть во вставленном."""
    brand, category, model = identity(it)
    brand = brand_key(brand)
    return brand, category, words_without_years(model_key(model, brand)), _attr(it, "country"), _attr(it, "sim")


def _compatible(a: CatalogItem, b: CatalogItem) -> bool:
    return position_key(a)[3] == position_key(b)[3] and all(not _attr(a, k) or not _attr(b, k) or _attr(a, k) == _attr(b, k) for k in ("country", "sim"))


def _merged(old: CatalogItem, new: CatalogItem) -> CatalogItem:
    """Название остаётся прежним, цена и наличие — новые; страну и SIM дополняем, если появились."""
    attrs = dict(old.attributes or {})
    attrs.pop("few", None)
    for k in ("country", "sim", "few", "source_line"):
        if _attr(new, k):
            attrs[k] = _attr(new, k)
    return CatalogItem(name=old.name, category=old.category, price=new.price, stock=new.stock,
                       attributes=attrs, key=old.key)


def _match(current: Sequence[CatalogItem], incoming: Sequence[CatalogItem]) -> tuple[list, list[CatalogItem], list[CatalogItem]]:
    """Пары «было → стало», новые и не встретившиеся позиции."""
    old_by_key = {position_key(it): it for it in current}
    pairs: list[tuple[CatalogItem, CatalogItem]] = []
    rest: list[CatalogItem] = []
    for new in incoming:
        old = old_by_key.pop(position_key(new), None)
        if old is not None:
            pairs.append((old, new))
        else:
            rest.append(new)
    # В другом сообщении могли не указать страну или SIM — сопоставляем, если вариант ровно один
    by_name: dict[tuple, list[CatalogItem]] = {}
    for it in old_by_key.values():
        by_name.setdefault(position_key(it)[0], []).append(it)
    added: list[CatalogItem] = []
    for new in rest:
        options = [o for o in by_name.get(position_key(new)[0], []) if _compatible(o, new)]
        if len(options) == 1:
            by_name[position_key(new)[0]].remove(options[0])
            pairs.append((options[0], new))
        else:
            added.append(new)
    left = [it for group in by_name.values() for it in group]
    return pairs, added, left


def _cheap_outlier(item: CatalogItem, items: Sequence[CatalogItem]) -> str | None:
    """Заметно дешевле такой же модели и объёма — так выглядят опечатки и закупочные цены."""
    family, storage = words_without_years(family_name(item)), price_storage_gb(item)
    others = [o.price for o in items if o is not item and price_storage_gb(o) == storage
              and words_without_years(family_name(o)) == family]
    if others and item.price < min(others) * 0.89:
        return f"заметно дешевле других вариантов (от {int(min(others)):,} ₽)".replace(",", " ")
    return None


def compare(base_text: str, new_text: str, mode: Mode = "models") -> Diff:
    current, base_errors, _ = parse_price_list_full(base_text)
    incoming, errors, duplicates = parse_price_list_full(new_text)
    if not incoming:
        return Diff([], len(current), errors, duplicates, len(base_errors), 0)
    pairs, added, left = _match(current, incoming)

    changes: list[Change] = []
    unchanged = 0
    scope = set()
    for old, new in pairs:
        scope.add(_scope(old))
        merged = _merged(old, new)
        if (merged.price, merged.stock, _attr(merged, "few")) == (old.price, old.stock, _attr(old, "few")):
            unchanged += 1
            continue
        warning = None
        if old.price and abs(merged.price - old.price) / old.price > JUMP:
            warning = "резкое изменение цены"
        changes.append(Change(_change_id("changed", old), "changed", old, merged, warning))
    for new in added:
        scope.add(_scope(new))
        changes.append(Change(_change_id("added", new), "added", None, new, _cheap_outlier(new, incoming)))
    for old in left:
        if mode == "full" or (mode == "models" and _scope(old) in scope):
            changes.append(Change(_change_id("removed", old), "removed", old, None))
        else:
            unchanged += 1
    order = {"changed": 0, "added": 1, "removed": 2}
    changes.sort(key=lambda c: (order[c.kind], c.warning is None, _sort_key(c.item)))
    return Diff(changes, unchanged, errors, duplicates, len(base_errors), len(incoming))


def _sort_key(it: CatalogItem) -> tuple:
    return (family_name(it).lower(), price_storage_gb(it), _attr(it, "color") or "",
            _attr(it, "country") or "", _attr(it, "sim") or "")


def dump_price_list(items: Sequence[CatalogItem]) -> str:
    """Прайс в виде, который читается обратно без потерь: по строке на позицию.
    @|цена|название|объём|цвет|цвет по-русски|страна|SIM|мало|в наличии"""
    lines = ["# Прайс обновляется кнопкой «Обновить цены». Строка: @|цена|название|объём|цвет|цвет по-русски|страна|SIM|мало|наличие"]
    for it in sorted(items, key=_sort_key):
        cells = [str(int(round(it.price))), it.name,
                 *(_attr(it, k) or "" for k in ("storage", "color", "color_ru", "country", "sim", "few")),
                 "" if it.stock > 0 else "нет"]
        extra = {k: v for k, v in it.attributes.items() if k.startswith("catalog_") or k == "source_line"}
        lines.append("@|" + "|".join(c.replace("|", "/") for c in cells)
                     + "|" + json.dumps(extra, ensure_ascii=False))
    return "\n".join(lines)


def apply_changes(base_text: str, diff: Diff, skip: set[str]) -> tuple[str, int]:
    """Новый текст прайса и сколько изменений применено."""
    current, _, _ = parse_price_list_full(base_text)
    items = {position_key(it): it for it in current}
    applied = [c for c in diff.changes if c.id not in skip]
    for c in applied:
        if c.old is not None:
            items.pop(position_key(c.old), None)
    for c in applied:
        if c.new is not None:
            items[position_key(c.new)] = c.new
    return dump_price_list(list(items.values())), len(applied)
