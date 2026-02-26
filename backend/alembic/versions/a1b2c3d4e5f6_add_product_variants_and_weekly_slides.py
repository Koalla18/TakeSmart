"""add_product_variants_and_weekly_slides

Revision ID: a1b2c3d4e5f6
Revises: d4f8a2e1b3c9
Create Date: 2026-02-26 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "d4f8a2e1b3c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── product_variants ─────────────────────────────────────────────────────
    op.create_table(
        "product_variants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("sku", sa.String(100), nullable=True, unique=True),
        sa.Column("price", sa.Numeric(12, 2), nullable=True),
        sa.Column("discount_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("stock_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("color", sa.String(80), nullable=True),
        sa.Column("storage", sa.String(80), nullable=True),
        sa.Column("size", sa.String(80), nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_product_variants_product_id", "product_variants", ["product_id"])

    # ── weekly_slides ─────────────────────────────────────────────────────────
    op.create_table(
        "weekly_slides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("badge", sa.String(200), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("price", sa.String(100), nullable=True),
        sa.Column("image", sa.String(500), nullable=True),
        sa.Column("color", sa.String(300), nullable=True),
        sa.Column("tags", postgresql.JSONB, nullable=True),
        sa.Column("link_url", sa.String(500), nullable=True),
        sa.Column("is_new", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_weekly_slides_is_active", "weekly_slides", ["is_active"])
    op.create_index("ix_weekly_slides_sort_order", "weekly_slides", ["sort_order"])


def downgrade() -> None:
    op.drop_table("product_variants")
    op.drop_table("weekly_slides")
