"""Авито-бот: рассылки и отписка

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("avito_chats", sa.Column("opted_out", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("avito_chats", sa.Column("last_broadcast_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "avito_broadcasts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="draft"),
        sa.Column("total", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("sent", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("failed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("skipped", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("next_send_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_avito_broadcasts_status", "avito_broadcasts", ["status"])
    op.create_table(
        "avito_broadcast_recipients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("broadcast_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("avito_broadcasts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("avito_chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("broadcast_id", "chat_id", name="uq_avito_broadcast_chat"),
    )
    op.create_index("ix_avito_broadcast_recipients_broadcast_id", "avito_broadcast_recipients", ["broadcast_id"])
    op.create_index("ix_avito_broadcast_recipients_chat_id", "avito_broadcast_recipients", ["chat_id"])


def downgrade() -> None:
    op.drop_table("avito_broadcast_recipients")
    op.drop_index("ix_avito_broadcasts_status", table_name="avito_broadcasts")
    op.drop_table("avito_broadcasts")
    op.drop_column("avito_chats", "last_broadcast_at")
    op.drop_column("avito_chats", "opted_out")
