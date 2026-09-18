"""add preorder_featured flag to products

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-09-18 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "y5z6a7b8c9d0"
down_revision: Union[str, None] = "x4y5z6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "preorder_featured",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="Показывать в витрине предзаказа (блок на главной и в каталоге)",
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "preorder_featured")
