"""iPhone app installs: catalog, stations, requests, jobs

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-09-26 21:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "z6a7b8c9d0e1"
down_revision: Union[str, None] = "y5z6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "iphone_apps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("bundle_id", sa.String(200), nullable=False),
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
    op.create_index("ix_iphone_apps_bundle_id", "iphone_apps", ["bundle_id"], unique=True)

    op.create_table(
        "install_stations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("version", sa.String(32), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_install_stations_token_hash", "install_stations", ["token_hash"], unique=True)

    op.create_table(
        "install_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("request_number", sa.String(16), nullable=False),
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
    op.create_index("ix_install_requests_request_number", "install_requests", ["request_number"], unique=True)
    op.create_index("ix_install_requests_status", "install_requests", ["status"])
    op.create_index("ix_install_requests_created_at", "install_requests", ["created_at"])

    op.create_table(
        "install_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("request_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("install_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("station_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("install_stations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("apps", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("device_udid", sa.String(64), nullable=True),
        sa.Column("device_model", sa.String(80), nullable=True),
        sa.Column("ios_version", sa.String(24), nullable=True),
        sa.Column("log", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_install_jobs_request_id", "install_jobs", ["request_id"])
    op.create_index("ix_install_jobs_station_id", "install_jobs", ["station_id"])
    op.create_index("ix_install_jobs_status", "install_jobs", ["status"])


def downgrade() -> None:
    op.drop_table("install_jobs")
    op.drop_table("install_requests")
    op.drop_table("install_stations")
    op.drop_table("iphone_apps")
