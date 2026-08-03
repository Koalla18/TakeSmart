"""restore editable default product field templates

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-08-03 18:30:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "l2m3n4o5p6q7"
down_revision: Union[str, None] = "k1l2m3n4o5p6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Restore the legacy starting schemes without overwriting admin edits.

    NULL means the category has never been configured. An empty array is a
    deliberate admin choice to create products without extra fields, so it is
    intentionally left unchanged.
    """
    op.execute(
        """
        UPDATE categories
        SET product_fields = CASE
            WHEN slug = 'smartphones' THEN
                '[
                  {"key":"color","label":"Цвет","field_type":"text","placeholder":"Чёрный титан","is_variant":true},
                  {"key":"storage","label":"Память","field_type":"text","placeholder":"256 ГБ","is_variant":true},
                  {"key":"sim","label":"Связь (SIM)","field_type":"text","placeholder":"SIM + eSIM","is_variant":true},
                  {"key":"ram","label":"ОЗУ","field_type":"text","placeholder":"12 ГБ","is_variant":false}
                ]'::jsonb
            WHEN slug IN ('laptops', 'monobloki') THEN
                '[
                  {"key":"color","label":"Цвет","field_type":"text","placeholder":"Серебристый","is_variant":true},
                  {"key":"processor","label":"Процессор","field_type":"text","placeholder":"M4 Pro","is_variant":true},
                  {"key":"ram","label":"ОЗУ","field_type":"text","placeholder":"16 ГБ","is_variant":true},
                  {"key":"storage","label":"Память SSD","field_type":"text","placeholder":"512 ГБ","is_variant":true}
                ]'::jsonb
            WHEN slug = 'tablets' THEN
                '[
                  {"key":"color","label":"Цвет","field_type":"text","placeholder":"Space Gray","is_variant":true},
                  {"key":"storage","label":"Память","field_type":"text","placeholder":"256 ГБ","is_variant":true},
                  {"key":"connectivity","label":"Связь","field_type":"text","placeholder":"Wi‑Fi + Cellular","is_variant":true}
                ]'::jsonb
            WHEN slug = 'watches' THEN
                '[
                  {"key":"color","label":"Цвет корпуса","field_type":"text","placeholder":"Титан","is_variant":true},
                  {"key":"strap_type","label":"Тип ремешка","field_type":"text","placeholder":"Sport Band","is_variant":true},
                  {"key":"strap_size","label":"Размер ремешка","field_type":"text","placeholder":"S/M","is_variant":true},
                  {"key":"case_size","label":"Размер циферблата","field_type":"text","placeholder":"42 мм","is_variant":true}
                ]'::jsonb
            WHEN slug = 'umnye-ochki' THEN
                '[
                  {"key":"frame","label":"Оправа","field_type":"text","placeholder":"Матовая чёрная","is_variant":true},
                  {"key":"lenses","label":"Линзы","field_type":"text","placeholder":"Прозрачные","is_variant":true},
                  {"key":"size","label":"Размер","field_type":"select","options":["S","M","L"],"is_variant":true}
                ]'::jsonb
            WHEN slug = 'headphones' THEN
                '[
                  {"key":"color","label":"Цвет","field_type":"text","placeholder":"Чёрный","is_variant":true},
                  {"key":"noise_cancelling","label":"Шумоподавление","field_type":"boolean","is_variant":false},
                  {"key":"battery_hours","label":"Автономность, ч","field_type":"number","placeholder":"30","is_variant":false}
                ]'::jsonb
            WHEN slug = 'tv' THEN
                '[
                  {"key":"color","label":"Цвет","field_type":"text","placeholder":"Чёрный","is_variant":true},
                  {"key":"diagonal","label":"Диагональ","field_type":"text","placeholder":"55 дюймов","is_variant":true}
                ]'::jsonb
            WHEN slug = 'gaming' THEN
                '[
                  {"key":"color","label":"Цвет","field_type":"text","placeholder":"Чёрный","is_variant":true},
                  {"key":"bundle","label":"Комплектация","field_type":"text","placeholder":"Digital","is_variant":true},
                  {"key":"storage","label":"Память","field_type":"text","placeholder":"512 ГБ","is_variant":true}
                ]'::jsonb
            WHEN slug = 'accessories' THEN
                '[
                  {"key":"color","label":"Цвет","field_type":"text","placeholder":"Чёрный","is_variant":true},
                  {"key":"size","label":"Размер / тип","field_type":"text","placeholder":"M","is_variant":true}
                ]'::jsonb
            ELSE product_fields
        END
        WHERE product_fields IS NULL
        """
    )


def downgrade() -> None:
    # Defaults are data, not schema. Keep manager edits intact on downgrade.
    pass
