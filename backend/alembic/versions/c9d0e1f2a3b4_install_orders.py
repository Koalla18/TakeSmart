"""Приложения на iPhone: аккаунты салона, каталог и заказы со страницей покупателя

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS install_order_number_seq START WITH 1001")

    op.create_table(
        "install_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("label", sa.String(80), nullable=False, comment="Как аккаунт называется у сотрудников"),
        sa.Column("apple_id", sa.String(160), nullable=False),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "install_apps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("install_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("store_id", sa.BigInteger(), nullable=True, comment="App Store ID (trackId)"),
        sa.Column("bundle_id", sa.String(200), nullable=False),
        sa.Column("name", sa.String(200), nullable=False, comment="Название как в истории покупок"),
        sa.Column("title", sa.String(120), nullable=True, comment="Название для каталога, если нужно своё"),
        sa.Column("icon_url", sa.String(500), nullable=True),
        sa.Column("version", sa.String(40), nullable=True),
        sa.Column("genre", sa.String(80), nullable=True),
        sa.Column("in_store", sa.Boolean(), nullable=True, comment="Есть ли сейчас в российском App Store"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false"), comment="Показывать в каталоге"),
        sa.Column("sort", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("account_id", "bundle_id", name="uq_install_apps_account_bundle"),
    )
    op.create_index("ix_install_apps_account_id", "install_apps", ["account_id"])

    op.create_table(
        "install_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False, server_default=sa.text("nextval('install_order_number_seq')")),
        sa.Column("token", sa.String(40), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("install_accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("account_label", sa.String(80), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="ready",
                  comment="new | ready | active | done | expired | cancelled"),
        sa.Column("mode", sa.String(8), nullable=False, server_default="staff",
                  comment="staff — ставит сотрудник в салоне; self — покупатель сам, код выдаёт страница заказа"),
        sa.Column("source", sa.String(8), nullable=False, server_default="admin", comment="admin | site"),
        sa.Column("apps", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb"),
                  comment="key, app_id, bundle_id, store_id, name, icon_url, version, status"),
        sa.Column("price", sa.Integer(), nullable=False, server_default=sa.text("0"), comment="Сумма заказа, ₽"),
        sa.Column("customer_name", sa.String(120), nullable=True),
        sa.Column("customer_phone", sa.String(32), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("created_by", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("code_requests", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("code_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("code_delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("events", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("feedback", sa.String(500), nullable=True),
        sa.UniqueConstraint("number", name="uq_install_orders_number"),
    )
    op.create_index("ix_install_orders_token", "install_orders", ["token"], unique=True)
    op.create_index("ix_install_orders_account_id", "install_orders", ["account_id"])
    op.create_index("ix_install_orders_status", "install_orders", ["status"])
    op.create_index("ix_install_orders_created_at", "install_orders", ["created_at"])


def downgrade() -> None:
    op.drop_table("install_orders")
    op.drop_table("install_apps")
    op.drop_table("install_accounts")
    op.execute("DROP SEQUENCE IF EXISTS install_order_number_seq")
