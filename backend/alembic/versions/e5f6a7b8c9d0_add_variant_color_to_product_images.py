"""add variant_color to product_images

Revision ID: e5f6a7b8c9d0
Revises: b7c3e9f1a2d5
Create Date: 2026-02-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str = "b7c3e9f1a2d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "product_images",
        sa.Column("variant_color", sa.String(80), nullable=True),
    )
    op.create_index(
        "ix_product_images_variant_color",
        "product_images",
        ["product_id", "variant_color"],
    )


def downgrade() -> None:
    op.drop_index("ix_product_images_variant_color", table_name="product_images")
    op.drop_column("product_images", "variant_color")
