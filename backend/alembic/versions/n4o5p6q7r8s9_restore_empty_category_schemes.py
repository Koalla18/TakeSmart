"""restore legacy fields for empty category schemas

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-08-03 19:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "n4o5p6q7r8s9"
down_revision: Union[str, None] = "m3n4o5p6q7r8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Restore old visible group fields for both NULL and [] configurations."""
    op.get_bind().exec_driver_sql(
        """
        UPDATE categories
        SET product_fields = CASE
            WHEN slug = 'smartphones' THEN '[
              {"key":"color","label":"Цвета","field_type":"text","placeholder":"Белый","hint":"Каждый цвет = отдельная карточка товара","is_variant":true},
              {"key":"storage","label":"Память","field_type":"text","placeholder":"256 ГБ","hint":"Объём встроенной памяти","is_variant":true},
              {"key":"ram","label":"ОЗУ","field_type":"text","placeholder":"12 ГБ","hint":"Объём оперативной памяти","is_variant":true},
              {"key":"sim","label":"Связь (SIM)","field_type":"text","placeholder":"SIM + eSIM","hint":"Тип SIM-карт","is_variant":true}
            ]'::jsonb
            WHEN slug IN ('laptops', 'monobloki') THEN '[
              {"key":"color","label":"Цвет","field_type":"text","placeholder":"Серебристый","hint":"Каждый цвет = отдельная карточка","is_variant":true},
              {"key":"processor","label":"Процессор","field_type":"text","placeholder":"M4 Pro","hint":"Модель чипа","is_variant":true},
              {"key":"ram","label":"ОЗУ","field_type":"text","placeholder":"16 ГБ","hint":"Объём оперативной памяти","is_variant":true},
              {"key":"storage","label":"Память SSD","field_type":"text","placeholder":"512 ГБ","hint":"Объём накопителя","is_variant":true}
            ]'::jsonb
            WHEN slug = 'tablets' THEN '[
              {"key":"color","label":"Цвета","field_type":"text","placeholder":"Space Gray","is_variant":true},
              {"key":"ram","label":"ОЗУ","field_type":"text","placeholder":"8 ГБ","hint":"Объём оперативной памяти","is_variant":true},
              {"key":"storage","label":"Память","field_type":"text","placeholder":"256 ГБ","hint":"Объём встроенной памяти","is_variant":true},
              {"key":"connectivity","label":"Связь","field_type":"text","placeholder":"WiFi + Cellular","hint":"Тип связи","is_variant":true}
            ]'::jsonb
            WHEN slug = 'watches' THEN '[
              {"key":"color","label":"Цвета","field_type":"text","placeholder":"Титан","is_variant":true},
              {"key":"strap_type","label":"Тип ремешка","field_type":"text","placeholder":"Sport Band","is_variant":true},
              {"key":"strap_size","label":"Размер ремешка","field_type":"text","placeholder":"S/M","is_variant":true},
              {"key":"case_size","label":"Размер циферблата","field_type":"text","placeholder":"42 мм","is_variant":true}
            ]'::jsonb
            WHEN slug = 'umnye-ochki' THEN '[
              {"key":"frame","label":"Оправа","field_type":"text","placeholder":"Матовая чёрная","hint":"Цвет и тип оправы","is_variant":true},
              {"key":"lenses","label":"Линзы","field_type":"text","placeholder":"Прозрачные","hint":"Тип линз","is_variant":true},
              {"key":"size","label":"Размер","field_type":"text","placeholder":"S, M, L","hint":"Размер оправы","is_variant":true}
            ]'::jsonb
            WHEN slug = 'headphones' THEN '[
              {"key":"color","label":"Цвета","field_type":"text","placeholder":"Чёрный","is_variant":true}
            ]'::jsonb
            WHEN slug = 'tv' THEN '[
              {"key":"color","label":"Цвета","field_type":"text","placeholder":"Чёрный","is_variant":true},
              {"key":"diagonal","label":"Диагональ","field_type":"text","placeholder":"55 дюймов","is_variant":true}
            ]'::jsonb
            WHEN slug = 'gaming' THEN '[
              {"key":"color","label":"Цвета","field_type":"text","placeholder":"Чёрный","is_variant":true},
              {"key":"bundle","label":"Комплектация","field_type":"text","placeholder":"Digital","is_variant":true},
              {"key":"storage","label":"Память","field_type":"text","placeholder":"512 ГБ","hint":"Объём встроенного накопителя","is_variant":true}
            ]'::jsonb
            WHEN slug = 'accessories' THEN '[
              {"key":"color","label":"Цвета","field_type":"text","placeholder":"Чёрный","is_variant":true},
              {"key":"size","label":"Размер / тип","field_type":"text","placeholder":"M","is_variant":true}
            ]'::jsonb
            ELSE '[
              {"key":"color","label":"Цвета","field_type":"text","placeholder":"Чёрный","hint":"Каждый цвет = отдельная карточка товара","is_variant":true},
              {"key":"storage","label":"Параметр 1","field_type":"text","placeholder":"256 ГБ","is_variant":true},
              {"key":"connectivity","label":"Параметр 2","field_type":"text","placeholder":"SIM + eSIM","is_variant":true}
            ]'::jsonb
        END
        WHERE product_fields IS NULL OR product_fields = '[]'::jsonb
        """
    )


def downgrade() -> None:
    # Do not erase restored settings or subsequent manager edits.
    pass
