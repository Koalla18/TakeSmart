"""Убрать внешние скобки у названий вариантов, созданных мастером групп.

Предыдущая миграция (r8s9t0u1v2w3) сняла метки полей и оставила формат
    «Смартфон Samsung Galaxy S26 FE (Синий (Blueberry), 256Гб, 2Sim+eSim)».
Решение владельца: обрамляющие скобки тоже убрать —
    «Смартфон Samsung Galaxy S26 FE Синий (Blueberry), 256Гб, 2Sim+eSim».
Скобки ВНУТРИ значений («(Blueberry)») остаются: они часть самого значения.

Критерий (проверен на всех 1000 боевых товарах — переименовываются ровно 13):
  1. имя заканчивается балансным скобочным блоком;
  2. в блоке минимум ДВА значения через запятую — одиночная скобка в конце
     имени это обычно часть обычного названия («… V15 Detect Gold (Золотой)»),
     а не мастер, такие не трогаем;
  3. товар состоит в группе — мастерские варианты всегда сгруппированы;
  4. КАЖДОЕ значение из блока совпадает со значением атрибута этого же товара
     (color или attributes) — это и отличает мастерский хвост от случайного.

Slug не меняется — ссылки остаются живыми.
Data-миграция: downgrade ничего не делает.
"""
from __future__ import annotations

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "s9t0u1v2w3x4"
down_revision = "r8s9t0u1v2w3"
branch_labels = None
depends_on = None


def _find_tail(name: str) -> tuple[str, str] | None:
    """Последний балансный скобочный блок, стоящий в самом конце имени."""
    n = name.rstrip()
    if not n.endswith(")"):
        return None
    depth = 0
    for i in range(len(n) - 1, -1, -1):
        ch = n[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                return n[:i], n[i + 1 : -1]
    return None


def _split_top(inner: str) -> list[str]:
    """Разбить по запятым верхнего уровня (вложенные скобки не режем)."""
    parts, depth, cur = [], 0, ""
    for ch in inner:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def _norm(value: object) -> str:
    return re.sub(r"\s+", " ", str(value)).strip().lower()


def _unwrap(name: str, color: object, attributes: object, in_group: bool) -> str | None:
    if not in_group:
        return None
    tail = _find_tail(name or "")
    if not tail:
        return None
    base, inner = tail
    segments = _split_top(inner)
    if len(segments) < 2:
        return None
    if isinstance(attributes, str):
        try:
            attributes = json.loads(attributes)
        except ValueError:
            attributes = None
    known = set()
    if isinstance(attributes, dict):
        known = {_norm(v) for v in attributes.values() if v not in (None, "")}
    if color:
        known.add(_norm(color))
    if not known:
        return None
    if not all(_norm(seg) in known for seg in segments):
        return None
    new = re.sub(r"\s{2,}", " ", base.rstrip()) + " " + ", ".join(segments)
    new = re.sub(r"\s{2,}", " ", new).strip()
    return new if new != name else None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, name, color, attributes, group_id FROM products")
    ).fetchall()
    for pid, name, color, attributes, group_id in rows:
        new_name = _unwrap(name, color, attributes, group_id is not None)
        if new_name:
            conn.execute(
                sa.text("UPDATE products SET name = :name WHERE id = :id"),
                {"name": new_name, "id": pid},
            )


def downgrade() -> None:
    # Data-миграция: прежние названия не восстанавливаются.
    pass
