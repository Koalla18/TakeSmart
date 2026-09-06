"""Ноутбуки и моноблоки: порядок осей «процессор, ОЗУ, память, цвет».

Мастер групп собирает название из значений осей в порядке полей категории.
У ноутбуков поля стояли «цвет, процессор, ОЗУ, память», и новые MacBook
получались «… Pro 16 Серебристый (Silver), M5 Pro, 18C CPU, 20C GPU, 24ГБ, 1ТБ».
Решение владельца: конфигурация сначала, цвет и код модели — в конце:
    «… Pro 16 M5 Pro, 18C CPU, 20C GPU, 24ГБ, 1ТБ, Серебристый (Silver) (MGE94)».

Что делает миграция:
  1. У категорий, чья схема РОВНО совпадает со старым порядком ключей
     [color, processor, ram, storage], переставляет поля в
     [processor, ram, storage, color]. Схемы, которые владелец менял сам,
     не трогаем — порядок иной, значит он осознанный.
  2. У товаров этих категорий, состоящих в группе, чьё название РОВНО равно
     «база + значения в старом порядке» (плюс необязательный хвост «(КОД)»),
     пересобирает хвост в новом порядке. Всё остальное не трогается.
Data-миграция: downgrade ничего не делает.
"""
from __future__ import annotations

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "u1v2w3x4y5z6"
down_revision = "t0u1v2w3x4y5"
branch_labels = None
depends_on = None

OLD_ORDER = ["color", "processor", "ram", "storage"]
NEW_ORDER = ["processor", "ram", "storage", "color"]
CODE_TAIL = re.compile(r"\s*\(([A-Z][A-Z0-9/-]{2,})\)$")


def _load(value: object) -> object:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def _value(attrs: dict, color: object, key: str) -> str:
    raw = attrs.get(key)
    if (raw is None or raw == "") and key == "color":
        raw = color
    return re.sub(r"\s+", " ", str(raw)).strip() if raw not in (None, "") else ""


def _rename(name: str, color: object, attributes: object) -> str | None:
    attrs = _load(attributes)
    if not isinstance(attrs, dict):
        return None
    values = {key: _value(attrs, color, key) for key in OLD_ORDER}
    if not all(values.values()):
        return None
    old_tail = ", ".join(values[key] for key in OLD_ORDER)
    body = name.rstrip()
    code = ""
    m = CODE_TAIL.search(body)
    if m:
        code = m.group(1)
        body = body[: m.start()].rstrip()
    if not body.endswith(old_tail):
        return None
    base = body[: -len(old_tail)].rstrip()
    if not base:
        return None
    new_tail = ", ".join(values[key] for key in NEW_ORDER)
    new_name = f"{base} {new_tail}"
    if code:
        new_name = f"{new_name} ({code})"
    new_name = re.sub(r"\s{2,}", " ", new_name).strip()
    return new_name if new_name != name else None


def upgrade() -> None:
    conn = op.get_bind()
    categories = conn.execute(sa.text("SELECT id, product_fields FROM categories")).fetchall()
    reordered: list = []
    for cid, fields in categories:
        parsed = _load(fields)
        if not isinstance(parsed, list):
            continue
        keys = [f.get("key") for f in parsed if isinstance(f, dict)]
        if keys != OLD_ORDER:
            continue
        by_key = {f["key"]: f for f in parsed}
        new_fields = [by_key[key] for key in NEW_ORDER]
        conn.execute(
            sa.text("UPDATE categories SET product_fields = CAST(:fields AS jsonb) WHERE id = :id"),
            {"fields": json.dumps(new_fields, ensure_ascii=False), "id": cid},
        )
        reordered.append(cid)

    if not reordered:
        return
    rows = conn.execute(
        sa.text(
            "SELECT id, name, color, attributes FROM products "
            "WHERE group_id IS NOT NULL AND category_id = ANY(:ids)"
        ),
        {"ids": reordered},
    ).fetchall()
    for pid, name, color, attributes in rows:
        new_name = _rename(name or "", color, attributes)
        if new_name:
            conn.execute(
                sa.text("UPDATE products SET name = :name WHERE id = :id"),
                {"name": new_name, "id": pid},
            )


def downgrade() -> None:
    # Data-миграция: прежний порядок полей и названий не восстанавливается.
    pass
