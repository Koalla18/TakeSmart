"""add product condition column

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-02-28 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "condition",
            sa.String(20),
            nullable=False,
            server_default="new",
            comment="Состояние товара: new — новый, used — б/у",
        ),
    )
    op.create_index("ix_products_condition", "products", ["condition"])


def downgrade() -> None:
    op.drop_index("ix_products_condition", table_name="products")
    op.drop_column("products", "condition")
