"""restore quick catalog models for empty categories

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-08-03 19:30:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "o5p6q7r8s9t0"
down_revision: Union[str, None] = "n4o5p6q7r8s9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Restore the former model buttons without replacing manager edits.

    An empty JSON array was written by the first admin implementation for
    categories that had never had quick filters. Treat those values exactly as
    missing settings; non-empty lists are left untouched.
    """
    op.get_bind().exec_driver_sql(
        """
        UPDATE categories
        SET quick_filters = CASE
            WHEN slug = 'smartphones' THEN '[
              {"label":"iPhone 17 Pro Max","query":"iPhone 17 Pro Max","brand":"apple"},
              {"label":"iPhone 17 Pro","query":"iPhone 17 Pro","brand":"apple"},
              {"label":"iPhone 17","query":"iPhone 17","brand":"apple"},
              {"label":"iPhone Air","query":"iPhone Air","brand":"apple"},
              {"label":"iPhone 16 Pro Max","query":"iPhone 16 Pro Max","brand":"apple"},
              {"label":"iPhone 16 Pro","query":"iPhone 16 Pro","brand":"apple"},
              {"label":"iPhone 16","query":"iPhone 16","brand":"apple"},
              {"label":"iPhone 15","query":"iPhone 15","brand":"apple"},
              {"label":"iPhone 14","query":"iPhone 14","brand":"apple"},
              {"label":"iPhone 13","query":"iPhone 13","brand":"apple"},
              {"label":"Galaxy S26 Ultra","query":"Galaxy S26 Ultra","brand":"samsung"},
              {"label":"Galaxy S26+","query":"Galaxy S26 Plus","brand":"samsung"},
              {"label":"Galaxy S26","query":"Galaxy S26","brand":"samsung"},
              {"label":"Galaxy S25 Ultra","query":"Galaxy S25 Ultra","brand":"samsung"},
              {"label":"Galaxy S25+","query":"Galaxy S25 Plus","brand":"samsung"},
              {"label":"Galaxy S25","query":"Galaxy S25","brand":"samsung"},
              {"label":"Galaxy S24 Ultra","query":"Galaxy S24 Ultra","brand":"samsung"},
              {"label":"Galaxy S24","query":"Galaxy S24","brand":"samsung"},
              {"label":"Galaxy S23","query":"Galaxy S23","brand":"samsung"},
              {"label":"Galaxy Z Fold","query":"Z Fold","brand":"samsung"},
              {"label":"Galaxy Z Flip","query":"Z Flip","brand":"samsung"},
              {"label":"Xiaomi 15","query":"Xiaomi 15","brand":"xiaomi"},
              {"label":"Xiaomi 14","query":"Xiaomi 14","brand":"xiaomi"},
              {"label":"Xiaomi 13","query":"Xiaomi 13","brand":"xiaomi"}
            ]'::jsonb
            WHEN slug = 'laptops' THEN '[
              {"label":"MacBook NEO","query":"MacBook Neo","brand":"apple"},
              {"label":"MacBook Air 13\\\"","query":"MacBook Air 13","brand":"apple"},
              {"label":"MacBook Air 15\\\"","query":"MacBook Air 15","brand":"apple"},
              {"label":"MacBook Pro 14\\\"","query":"MacBook Pro 14","brand":"apple"},
              {"label":"MacBook Pro 16\\\"","query":"MacBook Pro 16","brand":"apple"},
              {"label":"iMac","query":"iMac","brand":"apple"},
              {"label":"Mac mini","query":"Mac mini","brand":"apple"},
              {"label":"Surface Laptop","query":"Surface Laptop","brand":"microsoft"},
              {"label":"ZenBook","query":"ZenBook","brand":"asus"},
              {"label":"ROG","query":"ROG","brand":"asus"},
              {"label":"ThinkPad","query":"ThinkPad","brand":"lenovo"},
              {"label":"Legion","query":"Legion","brand":"lenovo"}
            ]'::jsonb
            WHEN slug = 'monobloki' THEN '[
              {"label":"iMac 24\\\"","query":"iMac 24","brand":"apple"},
              {"label":"iMac","query":"iMac","brand":"apple"},
              {"label":"HP All-in-One","query":"HP All-in-One","brand":"hp"},
              {"label":"Lenovo IdeaCentre","query":"IdeaCentre","brand":"lenovo"}
            ]'::jsonb
            WHEN slug = 'tablets' THEN '[
              {"label":"iPad 11\\\" (2025)","query":"iPad 11","brand":"apple"},
              {"label":"iPad 10.9\\\"","query":"iPad 10","brand":"apple"},
              {"label":"iPad Air M3","query":"iPad Air","brand":"apple"},
              {"label":"iPad Pro M5","query":"iPad Pro","brand":"apple"},
              {"label":"iPad mini","query":"iPad mini","brand":"apple"},
              {"label":"Galaxy Tab S10","query":"Tab S10","brand":"samsung"},
              {"label":"Galaxy Tab S9","query":"Tab S9","brand":"samsung"},
              {"label":"Xiaomi Pad","query":"Xiaomi Pad","brand":"xiaomi"}
            ]'::jsonb
            WHEN slug = 'watches' THEN '[
              {"label":"Apple Watch Ultra 2","query":"Watch Ultra 2","brand":"apple"},
              {"label":"Apple Watch Series 10","query":"Watch Series 10","brand":"apple"},
              {"label":"Apple Watch Series 9","query":"Watch Series 9","brand":"apple"},
              {"label":"Apple Watch SE","query":"Watch SE","brand":"apple"},
              {"label":"Galaxy Watch 7","query":"Watch 7","brand":"samsung"},
              {"label":"Galaxy Watch Ultra","query":"Watch Ultra","brand":"samsung"}
            ]'::jsonb
            WHEN slug = 'umnye-ochki' THEN '[
              {"label":"Ray-Ban Meta Wayfarer","query":"Ray-Ban Meta","brand":"meta"},
              {"label":"Ray-Ban Meta Skyler","query":"Meta Skyler","brand":"meta"},
              {"label":"Oakley Meta","query":"Oakley Meta","brand":"meta"}
            ]'::jsonb
            WHEN slug = 'headphones' THEN '[
              {"label":"AirPods Pro 3","query":"AirPods Pro 3","brand":"apple"},
              {"label":"AirPods Pro 2","query":"AirPods Pro 2","brand":"apple"},
              {"label":"AirPods 4","query":"AirPods 4","brand":"apple"},
              {"label":"AirPods 3","query":"AirPods 3","brand":"apple"},
              {"label":"AirPods Max","query":"AirPods Max","brand":"apple"},
              {"label":"Marshall Major V","query":"Marshall Major","brand":"marshall"},
              {"label":"Marshall Motif","query":"Marshall Motif","brand":"marshall"},
              {"label":"Galaxy Buds","query":"Galaxy Buds","brand":"samsung"}
            ]'::jsonb
            WHEN slug = 'krasota-i-ukhod' THEN '[
              {"label":"Стайлеры Airwrap","query":"Airwrap","brand":"dyson"},
              {"label":"Выпрямители Airstrait","query":"Airstrait","brand":"dyson"},
              {"label":"Выпрямители Corrale","query":"Corrale","brand":"dyson"},
              {"label":"Фены Supersonic","query":"Supersonic","brand":"dyson"},
              {"label":"Фены Nural","query":"Nural","brand":"dyson"},
              {"label":"Машинки для стрижки","query":"стрижк"},
              {"label":"Электробритвы","query":"бритв"}
            ]'::jsonb
            WHEN slug = 'dlia-doma' THEN '[
              {"label":"Пылесосы Dyson","query":"пылесос","brand":"dyson"},
              {"label":"Роботы-пылесосы","query":"робот"},
              {"label":"Очистители воздуха","query":"очистител"},
              {"label":"Увлажнители","query":"увлажнител"},
              {"label":"Умный дом Яндекс","query":"яндекс","brand":"яндекс"}
            ]'::jsonb
            WHEN slug = 'accessories' THEN '[
              {"label":"Чехлы Pitaka","query":"Pitaka"},
              {"label":"Чехлы Apple","query":"чехол","brand":"apple"},
              {"label":"Ремешки","query":"ремешок"},
              {"label":"Apple Pencil","query":"Apple Pencil","brand":"apple"},
              {"label":"Зарядки","query":"зарядк"},
              {"label":"Кабели","query":"кабел"},
              {"label":"Защитные стекла","query":"стекл"}
            ]'::jsonb
            WHEN slug = 'gaming' THEN '[
              {"label":"PlayStation 5","query":"PlayStation 5","brand":"sony"},
              {"label":"Xbox Series X","query":"Xbox Series","brand":"microsoft"},
              {"label":"Nintendo Switch","query":"Switch","brand":"nintendo"},
              {"label":"Steam Deck","query":"Steam Deck"},
              {"label":"VR Гарнитуры","query":"VR"},
              {"label":"Геймпады","query":"геймпад"}
            ]'::jsonb
            WHEN slug = 'tv' THEN '[
              {"label":"Телевизоры Samsung","query":"телевизор","brand":"samsung"},
              {"label":"Телевизоры LG","query":"телевизор","brand":"lg"},
              {"label":"Телевизоры Xiaomi","query":"телевизор","brand":"xiaomi"},
              {"label":"Apple TV","query":"Apple TV","brand":"apple"},
              {"label":"Саундбары","query":"саундбар"},
              {"label":"Умные колонки","query":"колонк"}
            ]'::jsonb
            ELSE '[]'::jsonb
        END
        WHERE quick_filters IS NULL OR quick_filters = '[]'::jsonb
        """
    )


def downgrade() -> None:
    # The restored values are editable manager data; never erase them on rollback.
    pass
