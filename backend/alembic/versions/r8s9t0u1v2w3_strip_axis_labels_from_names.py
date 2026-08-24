"""Убрать «Метка: » из хвостов названий товаров, созданных мастером групп.

Мастер групп исторически строил имена вида
    «Samsung Galaxy S26 (Цвет: Розовый (Pink Gold), Память: 256Гб, Связь (SIM): 2Sim+eSim)»
Решение владельца: в названии должны остаться только значения —
    «Samsung Galaxy S26 (Розовый (Pink Gold), 256Гб, 2Sim+eSim)».

Переписываются ТОЛЬКО имена, у которых последний скобочный блок целиком
состоит из пар «метка: значение» (метка без цифр) — обычные названия со
скобками («AirPods 4 (2024)», «(MUWA3)») не подходят под шаблон и не
трогаются. Slug не меняется — ссылки остаются живыми.

Заодно вычищаются пустые строки из attributes (strap_size: "" и т.п.) —
мусор старой версии мастера, мешавший витрине.

Data-миграция: downgrade ничего не делает (как и у restore-цепочки).
"""
from __future__ import annotations

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "r8s9t0u1v2w3"
down_revision = "q7r8s9t0u1v2"
branch_labels = None
depends_on = None

_SEG = re.compile(r"^([^:()]{1,40}(?:\([^)]*\))?[^:()]{0,40})\s*:\s*(.+)$")


def _find_tail(name: str) -> tuple[str, str] | None:
    """Последний балансный скобочный блок, стоящий в самом конце имени."""
    n = name.rstrip()
    if not n.endswith(")"):
        return None
    depth, start = 0, None
    for i in range(len(n) - 1, -1, -1):
        ch = n[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                start = i
                break
    if start is None:
        return None
    return n[:start], n[start + 1 : -1]


def _split_top(inner: str) -> list[str]:
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


def _strip_labels(name: str) -> str | None:
    tail = _find_tail(name)
    if not tail:
        return None
    base, inner = tail
    segs = _split_top(inner)
    if not segs:
        return None
    values = []
    for seg in segs:
        m = _SEG.match(seg)
        if not m:
            return None
        label = m.group(1).strip()
        if re.search(r"\d", label):
            # Метки полей категорий не содержат цифр — защита от случайных
            # совпадений вроде «(USB: 2 порта)».
            return None
        values.append(m.group(2).strip())
    new = re.sub(r"\s{2,}", " ", base.rstrip()) + " (" + ", ".join(values) + ")"
    return new if new != name else None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Имена: убрать «Метка: » из мастерских хвостов.
    rows = conn.execute(sa.text("SELECT id, name FROM products")).fetchall()
    renamed = 0
    for pid, name in rows:
        new_name = _strip_labels(name or "")
        if new_name:
            conn.execute(
                sa.text("UPDATE products SET name = :name WHERE id = :id"),
                {"name": new_name, "id": pid},
            )
            renamed += 1

    # 2. Attributes: выбросить пустые строки ("" — мусор старого мастера).
    rows = conn.execute(
        sa.text("SELECT id, attributes FROM products WHERE attributes IS NOT NULL")
    ).fetchall()
    cleaned = 0
    for pid, attrs in rows:
        if isinstance(attrs, str):
            try:
                attrs = json.loads(attrs)
            except ValueError:
                continue
        if not isinstance(attrs, dict):
            continue
        stripped = {k: v for k, v in attrs.items() if v not in ("", None)}
        if stripped != attrs:
            conn.execute(
                sa.text(
                    "UPDATE products SET attributes = CAST(:attrs AS jsonb) WHERE id = :id"
                ),
                {"attrs": json.dumps(stripped if stripped else None), "id": pid},
            )
            cleaned += 1


def downgrade() -> None:
    # Data-миграция: исходные имена не восстанавливаются.
    pass
