"""initial_schema

Revision ID: ce5d336d912d
Revises: 
Create Date: 2026-02-24 13:17:37.724261

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ce5d336d912d"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── categories ────────────────────────────────────────────────────────────
    op.create_table(
        "categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("slug", sa.String(120), nullable=False, unique=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_categories_name", "categories", ["name"])
    op.create_index("ix_categories_slug", "categories", ["slug"])

    # ── products ──────────────────────────────────────────────────────────────
    op.create_table(
        "products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(280), nullable=False, unique=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("short_description", sa.String(500), nullable=True),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("discount_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("stock_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("sku", sa.String(100), nullable=True, unique=True),
        sa.Column("brand", sa.String(100), nullable=True),
        sa.Column("model", sa.String(150), nullable=True),
        sa.Column("color", sa.String(50), nullable=True),
        sa.Column("warranty_months", sa.Integer, nullable=True),
        sa.Column("main_image_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("is_featured", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column(
            "category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_products_name", "products", ["name"])
    op.create_index("ix_products_slug", "products", ["slug"])
    op.create_index("ix_products_brand", "products", ["brand"])
    op.create_index("ix_products_category_id", "products", ["category_id"])

    # ── product_images ────────────────────────────────────────────────────────
    op.create_table(
        "product_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(50), nullable=False),
        sa.Column("file_size", sa.Integer, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_main", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_product_images_product_id", "product_images", ["product_id"])

    # ── orders ────────────────────────────────────────────────────────────────
    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_number", sa.String(32), nullable=False, unique=True),
        sa.Column("customer_name", sa.String(150), nullable=False),
        sa.Column("customer_email", sa.String(255), nullable=False),
        sa.Column("customer_phone", sa.String(30), nullable=True),
        sa.Column("shipping_address", sa.Text, nullable=False),
        sa.Column("shipping_city", sa.String(100), nullable=False),
        sa.Column("shipping_postal_code", sa.String(20), nullable=True),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("shipping_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("payment_status", sa.String(20), nullable=False, server_default="unpaid"),
        sa.Column("customer_note", sa.Text, nullable=True),
        sa.Column("admin_note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_orders_order_number", "orders", ["order_number"])
    op.create_index("ix_orders_customer_email", "orders", ["customer_email"])
    op.create_index("ix_orders_status", "orders", ["status"])

    # ── order_items ───────────────────────────────────────────────────────────
    op.create_table(
        "order_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("product_name", sa.String(255), nullable=False),
        sa.Column("product_sku", sa.String(100), nullable=True),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_price", sa.Numeric(12, 2), nullable=False),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_index("ix_order_items_product_id", "order_items", ["product_id"])


def downgrade() -> None:
    op.drop_table("order_items")
    op.drop_table("orders")
    op.drop_table("product_images")
    op.drop_table("products")
    op.drop_table("categories")
