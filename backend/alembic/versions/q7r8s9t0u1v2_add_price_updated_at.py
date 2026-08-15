"""add price_updated_at to products

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-08-15 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "q7r8s9t0u1v2"
down_revision: Union[str, None] = "p6q7r8s9t0u1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "price_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Когда сотрудник последний раз подтверждал/менял цену",
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "price_updated_at")
