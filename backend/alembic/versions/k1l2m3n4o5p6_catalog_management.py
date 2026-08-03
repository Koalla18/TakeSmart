"""catalog management: brands, category axes and trade-in offers

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-08-03 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "k1l2m3n4o5p6"
down_revision: Union[str, None] = "j0k1l2m3n4o5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column(
            "product_fields",
            postgresql.JSONB(),
            nullable=True,
            comment="Схема полей товара [{key, label, field_type, options, is_variant}]",
        ),
    )

    op.create_table(
        "brands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("logo_url", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_brands_name", "brands", ["name"])
    op.create_index("ix_brands_slug", "brands", ["slug"])

    # Existing product brands become editable entries immediately after deploy.
    # The hash suffix guarantees uniqueness even if old data differs only by case.
    op.execute(
        """
        INSERT INTO brands (id, name, slug, is_active, created_at, updated_at)
        SELECT
            md5(trim(brand))::uuid,
            trim(brand),
            COALESCE(NULLIF(regexp_replace(lower(trim(brand)), '[^a-z0-9]+', '-', 'g'), ''), 'brand')
              || '-' || substr(md5(trim(brand)), 1, 8),
            true,
            now(),
            now()
        FROM products
        WHERE brand IS NOT NULL AND trim(brand) <> ''
        GROUP BY trim(brand)
        ON CONFLICT (name) DO NOTHING
        """
    )

    op.create_table(
        "trade_in_offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("device_type", sa.String(length=100), nullable=False),
        sa.Column("device_label", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("min_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("max_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("min_price <= max_price", name="ck_trade_in_offer_price_range"),
    )
    op.create_index("ix_trade_in_offers_device_type", "trade_in_offers", ["device_type"])

    # Переносим текущий фронтендовый прайс-лист в БД, чтобы менеджеры получили
    # редактируемый список сразу после миграции, а не с пустой админкой.
    op.execute(
        """
        INSERT INTO trade_in_offers (id, device_type, device_label, name, min_price, max_price, sort_order, is_active, created_at, updated_at)
        SELECT
            md5(device_type || ':' || name)::uuid,
            device_type, device_label, name, min_price, max_price, sort_order, true, now(), now()
        FROM (
            VALUES
              ('iphone', 'iPhone', 'iPhone 16 Pro Max', 55000, 85000, 0),
              ('iphone', 'iPhone', 'iPhone 16 Pro', 50000, 75000, 1),
              ('iphone', 'iPhone', 'iPhone 16', 40000, 60000, 2),
              ('iphone', 'iPhone', 'iPhone 15 Pro Max', 45000, 70000, 3),
              ('iphone', 'iPhone', 'iPhone 15 Pro', 40000, 60000, 4),
              ('iphone', 'iPhone', 'iPhone 15', 30000, 48000, 5),
              ('iphone', 'iPhone', 'iPhone 14 Pro Max', 35000, 55000, 6),
              ('iphone', 'iPhone', 'iPhone 14 Pro', 30000, 50000, 7),
              ('iphone', 'iPhone', 'iPhone 14', 22000, 38000, 8),
              ('iphone', 'iPhone', 'iPhone 13 Pro Max', 28000, 45000, 9),
              ('iphone', 'iPhone', 'iPhone 13 Pro', 25000, 40000, 10),
              ('iphone', 'iPhone', 'iPhone 13', 18000, 30000, 11),
              ('iphone', 'iPhone', 'iPhone 12 Pro Max', 20000, 32000, 12),
              ('iphone', 'iPhone', 'iPhone 12 Pro', 17000, 28000, 13),
              ('iphone', 'iPhone', 'iPhone 12', 13000, 22000, 14),
              ('iphone', 'iPhone', 'iPhone 11 Pro Max', 14000, 24000, 15),
              ('iphone', 'iPhone', 'iPhone 11 Pro', 12000, 20000, 16),
              ('iphone', 'iPhone', 'iPhone 11', 8000, 16000, 17),
              ('iphone', 'iPhone', 'iPhone SE (2/3)', 5000, 12000, 18),
              ('samsung', 'Samsung', 'Galaxy S25 Ultra', 50000, 78000, 0),
              ('samsung', 'Samsung', 'Galaxy S25+', 38000, 58000, 1),
              ('samsung', 'Samsung', 'Galaxy S25', 30000, 48000, 2),
              ('samsung', 'Samsung', 'Galaxy S24 Ultra', 42000, 65000, 3),
              ('samsung', 'Samsung', 'Galaxy S24+', 30000, 48000, 4),
              ('samsung', 'Samsung', 'Galaxy S24', 22000, 38000, 5),
              ('samsung', 'Samsung', 'Galaxy S23 Ultra', 32000, 52000, 6),
              ('samsung', 'Samsung', 'Galaxy S23', 18000, 30000, 7),
              ('samsung', 'Samsung', 'Galaxy Z Fold 5', 45000, 70000, 8),
              ('samsung', 'Samsung', 'Galaxy Z Flip 5', 22000, 38000, 9),
              ('macbook', 'MacBook', 'MacBook Pro 16" (M3/M4)', 80000, 140000, 0),
              ('macbook', 'MacBook', 'MacBook Pro 14" (M3/M4)', 60000, 110000, 1),
              ('macbook', 'MacBook', 'MacBook Air 15" (M3)', 45000, 75000, 2),
              ('macbook', 'MacBook', 'MacBook Air 13" (M3)', 35000, 60000, 3),
              ('macbook', 'MacBook', 'MacBook Pro 14" (M2)', 50000, 85000, 4),
              ('macbook', 'MacBook', 'MacBook Air (M2)', 28000, 48000, 5),
              ('macbook', 'MacBook', 'MacBook Air (M1)', 18000, 35000, 6),
              ('ipad', 'iPad', 'iPad Pro 13" (M4)', 50000, 80000, 0),
              ('ipad', 'iPad', 'iPad Pro 11" (M4)', 38000, 62000, 1),
              ('ipad', 'iPad', 'iPad Air (M2)', 25000, 42000, 2),
              ('ipad', 'iPad', 'iPad mini 7', 22000, 35000, 3),
              ('ipad', 'iPad', 'iPad (10-го поколения)', 15000, 25000, 4),
              ('ipad', 'iPad', 'iPad Pro (M1/M2)', 25000, 50000, 5),
              ('ipad', 'iPad', 'iPad Air (M1)', 18000, 30000, 6),
              ('xiaomi', 'Xiaomi', 'Xiaomi 14 Ultra', 30000, 50000, 0),
              ('xiaomi', 'Xiaomi', 'Xiaomi 14 Pro', 25000, 42000, 1),
              ('xiaomi', 'Xiaomi', 'Xiaomi 14', 18000, 32000, 2),
              ('xiaomi', 'Xiaomi', 'Xiaomi 13 Pro', 18000, 30000, 3),
              ('xiaomi', 'Xiaomi', 'Xiaomi 13', 12000, 22000, 4),
              ('xiaomi', 'Xiaomi', 'Redmi Note 13 Pro+', 8000, 16000, 5),
              ('xiaomi', 'Xiaomi', 'POCO F6 Pro', 12000, 22000, 6),
              ('watch', 'Часы', 'Apple Watch Ultra 2', 30000, 50000, 0),
              ('watch', 'Часы', 'Apple Watch Series 9', 15000, 28000, 1),
              ('watch', 'Часы', 'Apple Watch SE (2023)', 8000, 16000, 2),
              ('watch', 'Часы', 'Samsung Galaxy Watch 6', 8000, 16000, 3),
              ('other', 'Другое', 'AirPods Pro 2', 5000, 12000, 0),
              ('other', 'Другое', 'AirPods Max', 15000, 30000, 1),
              ('other', 'Другое', 'Sony PlayStation 5', 18000, 32000, 2),
              ('other', 'Другое', 'Nintendo Switch OLED', 10000, 18000, 3)
        ) AS seed(device_type, device_label, name, min_price, max_price, sort_order)
        ON CONFLICT (id) DO NOTHING
        """
    )

    # Поля намеренно не заполняются шаблонами: состав характеристик и вариантов
    # владелец каталога задаёт отдельно для каждой категории через админку.


def downgrade() -> None:
    op.drop_index("ix_trade_in_offers_device_type", table_name="trade_in_offers")
    op.drop_table("trade_in_offers")
    op.drop_index("ix_brands_slug", table_name="brands")
    op.drop_index("ix_brands_name", table_name="brands")
    op.drop_table("brands")
    op.drop_column("categories", "product_fields")
