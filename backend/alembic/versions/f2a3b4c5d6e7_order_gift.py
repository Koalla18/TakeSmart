"""Подарок к заказу: что магазин дарит к позиции (GTA VI к PlayStation 5)

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "order_items",
        sa.Column("gift", sa.String(120), nullable=True, comment="Подарок к этой позиции на момент заказа"),
    )
    op.add_column(
        "orders",
        sa.Column("gift", sa.String(120), nullable=True, comment="В заказе есть позиции с подарком — что именно дарим"),
    )


def downgrade() -> None:
    op.drop_column("orders", "gift")
    op.drop_column("order_items", "gift")
