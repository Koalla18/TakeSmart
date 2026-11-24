"""Авито-бот: автоответы, диалоги и сообщения

Revision ID: a0b1c2d3e4f5
Revises: f2a3b4c5d6e7
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "avito_bot_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("keywords", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("verbatim", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("time_from", sa.String(5), nullable=False, server_default="00:00"),
        sa.Column("time_to", sa.String(5), nullable=False, server_default="23:59"),
        sa.Column("days", postgresql.JSONB(), nullable=False, server_default=sa.text("'[0,1,2,3,4,5,6]'::jsonb")),
        sa.Column("delay_seconds", sa.Integer(), nullable=False, server_default=sa.text("2")),
        sa.Column("max_per_chat", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("hits", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "avito_chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("avito_chat_id", sa.String(120), nullable=False, unique=True),
        sa.Column("is_simulated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("client_name", sa.String(120), nullable=True),
        sa.Column("client_avito_id", sa.BigInteger(), nullable=True),
        sa.Column("item_id", sa.BigInteger(), nullable=True),
        sa.Column("item_title", sa.String(300), nullable=True),
        sa.Column("item_price", sa.String(60), nullable=True),
        sa.Column("item_url", sa.String(500), nullable=True),
        sa.Column("mode", sa.String(8), nullable=False, server_default="bot"),
        sa.Column("needs_human", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("human_reason", sa.String(200), nullable=True),
        sa.Column("rule_hits", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("last_message_text", sa.String(300), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_avito_chats_avito_chat_id", "avito_chats", ["avito_chat_id"])
    op.create_index("ix_avito_chats_needs_human", "avito_chats", ["needs_human"])
    op.create_index("ix_avito_chats_last_message_at", "avito_chats", ["last_message_at"])
    op.create_table(
        "avito_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("avito_chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("avito_message_id", sa.String(120), nullable=True, unique=True),
        sa.Column("author", sa.String(8), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="sent"),
        sa.Column("source", sa.String(10), nullable=True),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("avito_bot_rules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_avito_messages_chat_created", "avito_messages", ["chat_id", "created_at"])
    op.create_index("ix_avito_messages_status", "avito_messages", ["status"])


def downgrade() -> None:
    op.drop_table("avito_messages")
    op.drop_table("avito_chats")
    op.drop_table("avito_bot_rules")
