"""add_product_attributes_and_specs

Revision ID: b7c3e9f1a2d5
Revises: a1b2c3d4e5f6
Create Date: 2026-02-28 12:00:00.000000

Изменения:
  1. Добавлено JSONB-поле attributes в таблицу products
     + GIN-индекс для быстрого поиска по содержимому JSON
  2. Создана таблица product_specs — структурированные характеристики
     с группировкой (group_name) и сортировкой (sort_order)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b7c3e9f1a2d5"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Добавляем JSONB-поле attributes в products ────────────────────────
    op.add_column(
        "products",
        sa.Column(
            "attributes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Произвольные характеристики товара (ram_gb, storage_gb, os, ...)",
        ),
    )

    # GIN-индекс для оператора @> (содержит) — ускоряет фильтрацию по атрибутам
    op.create_index(
        "ix_products_attributes_gin",
        "products",
        ["attributes"],
        postgresql_using="gin",
    )

    # ── 2. Создаём таблицу product_specs ────────────────────────────────────
    op.create_table(
        "product_specs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "group_name",
            sa.String(100),
            nullable=False,
            server_default="Основные",
            comment="Группа характеристик (Дисплей, Камера, Производительность…)",
        ),
        sa.Column(
            "name",
            sa.String(150),
            nullable=False,
            comment="Название характеристики (Диагональ, ОЗУ, ЦП…)",
        ),
        sa.Column(
            "value",
            sa.String(500),
            nullable=False,
            comment="Значение характеристики",
        ),
        sa.Column(
            "unit",
            sa.String(50),
            nullable=True,
            comment="Единица измерения (дюйм, ГБ, МП, Гц…)",
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    # Индекс для быстрой выборки всех спецификаций конкретного товара
    op.create_index(
        "ix_product_specs_product_id",
        "product_specs",
        ["product_id"],
    )


def downgrade() -> None:
    # Удаляем в обратном порядке
    op.drop_index("ix_product_specs_product_id", table_name="product_specs")
    op.drop_table("product_specs")

    op.drop_index("ix_products_attributes_gin", table_name="products")
    op.drop_column("products", "attributes")

