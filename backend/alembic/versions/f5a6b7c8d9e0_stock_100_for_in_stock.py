"""Остаток 100 шт активным товарам в наличии (разовая правка данных)

Товарам, которые активны, не на предзаказе и у которых остаток больше нуля, ставится
остаток 100 — чтобы ходовые позиции не уходили в «нет в наличии» после нескольких заказов.
Товары с нулевым остатком не трогаются.

Прежние остатки сохраняются в таблицу products_stock_backup_20261124 — откат миграции
(alembic downgrade) возвращает их как было.

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BACKUP = "products_stock_backup_20261124"
NEW_STOCK = 100


def upgrade() -> None:
    op.create_table(
        BACKUP,
        sa.Column("product_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("stock_quantity", sa.Integer(), nullable=False),
        sa.Column("backed_up_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute(
        f"INSERT INTO {BACKUP} (product_id, stock_quantity) "
        "SELECT id, stock_quantity FROM products "
        "WHERE is_active AND NOT is_preorder AND stock_quantity > 0"
    )
    op.execute(
        f"UPDATE products SET stock_quantity = {NEW_STOCK} "
        f"WHERE id IN (SELECT product_id FROM {BACKUP})"
    )


def downgrade() -> None:
    op.execute(
        f"UPDATE products p SET stock_quantity = b.stock_quantity FROM {BACKUP} b WHERE p.id = b.product_id"
    )
    op.drop_table(BACKUP)
