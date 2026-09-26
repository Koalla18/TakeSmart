"""installs: без заявок и каталога — только станции и история установок

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1
Create Date: 2026-09-26 22:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "z6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_install_jobs_request_id", table_name="install_jobs")
    op.drop_constraint("install_jobs_request_id_fkey", "install_jobs", type_="foreignkey")
    op.drop_column("install_jobs", "request_id")
    op.add_column("install_jobs", sa.Column("note", sa.String(300), nullable=True))
    op.drop_table("install_requests")
    op.drop_table("iphone_apps")


def downgrade() -> None:
    op.create_table(
        "iphone_apps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("bundle_id", sa.String(200), nullable=False, unique=True),
        sa.Column("app_store_id", sa.BigInteger(), nullable=True),
        sa.Column("category", sa.String(40), nullable=False, server_default="other"),
        sa.Column("price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("description", sa.String(300), nullable=True),
        sa.Column("icon_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "install_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("request_number", sa.String(16), nullable=False, unique=True),
        sa.Column("customer_name", sa.String(120), nullable=False),
        sa.Column("customer_phone", sa.String(32), nullable=False),
        sa.Column("device_model", sa.String(80), nullable=True),
        sa.Column("ios_version", sa.String(24), nullable=True),
        sa.Column("apps", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("comment", sa.String(500), nullable=True),
        sa.Column("source", sa.String(16), nullable=False, server_default="site"),
        sa.Column("status", sa.String(16), nullable=False, server_default="new"),
        sa.Column("staff_note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.drop_column("install_jobs", "note")
    op.add_column("install_jobs", sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=True))
