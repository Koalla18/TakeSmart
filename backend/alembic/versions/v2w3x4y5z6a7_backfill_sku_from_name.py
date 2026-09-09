"""Код модели из хвоста названия — в поле sku.

Владелец пишет код модели в конце названия: «… серебристый (Silver) (MDE54)».
Так делали руками до мастера групп, и у 70+ товаров код есть только в тексте,
а поле sku пустое — панель «Цены» и поиск по коду его не видят.

Правило (то же, что в панели «Цены» на фронте, lib/modelCode.ts):
  последняя скобочная группа названия из латиницы/цифр/дефиса/слэша,
  3–12 символов, минимум одна цифра и хотя бы одна буква или дефис.
  Так «(MDE54)» и «(492747-01)» — код, а «(2024)» (год) и «(Silver)» (цвет) — нет.

Заполняем только пустые sku и только однозначные коды: поле уникальное,
поэтому код, который стоит у двух товаров или уже занят, пропускаем —
такие строки владелец разбирает руками (панель покажет код из названия).
Data-миграция: downgrade ничего не делает.
"""
from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op

revision = "v2w3x4y5z6a7"
down_revision = "u1v2w3x4y5z6"
branch_labels = None
depends_on = None

CODE_TAIL = re.compile(r"\s*\(([A-Z0-9][A-Z0-9/-]{2,11})\)\s*$")


def code_from_name(name: str | None) -> str | None:
    if not name:
        return None
    m = CODE_TAIL.search(name.rstrip())
    if not m:
        return None
    code = m.group(1)
    if not re.search(r"\d", code) or not re.search(r"[A-Z-]", code):
        return None
    return code


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, name, sku FROM products")).fetchall()
    taken = {(r.sku or "").strip().upper() for r in rows if (r.sku or "").strip()}
    candidates: dict[str, list] = {}
    for r in rows:
        if (r.sku or "").strip():
            continue
        code = code_from_name(r.name)
        if code:
            candidates.setdefault(code, []).append(r.id)
    updated = 0
    skipped: list[str] = []
    for code, ids in candidates.items():
        if len(ids) != 1 or code in taken:
            skipped.append(code)  # неоднозначно — оставляем владельцу
            continue
        bind.execute(
            sa.text("UPDATE products SET sku = :sku WHERE id = :id AND (sku IS NULL OR sku = '')"),
            {"sku": code, "id": ids[0]},
        )
        taken.add(code)
        updated += 1
    print(f"[backfill_sku_from_name] заполнено кодов: {updated}; пропущено неоднозначных: {len(skipped)} {skipped[:10]}")


def downgrade() -> None:
    pass
