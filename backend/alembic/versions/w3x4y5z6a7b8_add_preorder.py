"""add preorder fields to products and orders

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-09-15 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "w3x4y5z6a7b8"
down_revision: Union[str, None] = "v2w3x4y5z6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "is_preorder",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="Товар доступен по предзаказу (до поступления на склад)",
        ),
    )
    op.add_column(
        "products",
        sa.Column(
            "preorder_note",
            sa.String(length=200),
            nullable=True,
            comment="Подпись для витрины: «Старт продаж 26 сентября», «Ожидается в октябре»",
        ),
    )
    op.add_column(
        "products",
        sa.Column(
            "preorder_expected_at",
            sa.Date(),
            nullable=True,
            comment="Ожидаемая дата поступления (для подписи и сортировки предзаказов)",
        ),
    )
    op.create_index("ix_products_is_preorder", "products", ["is_preorder"])

    op.add_column(
        "orders",
        sa.Column(
            "is_preorder",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="Заказ содержит товары по предзаказу",
        ),
    )


def downgrade() -> None:
    op.drop_column("orders", "is_preorder")
    op.drop_index("ix_products_is_preorder", table_name="products")
    op.drop_column("products", "preorder_expected_at")
    op.drop_column("products", "preorder_note")
    op.drop_column("products", "is_preorder")
