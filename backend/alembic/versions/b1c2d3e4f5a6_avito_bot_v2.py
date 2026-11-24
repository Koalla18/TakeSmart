"""Авито-бот v2: очередь ответов в базе, повторы отправки, бронь из чата, обучение, привязка объявлений

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("avito_chats", sa.Column("reply_due_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("avito_chats", sa.Column("human_question", sa.String(500), nullable=True))
    op.add_column("avito_chats", sa.Column("order_id", postgresql.UUID(as_uuid=True),
                                           sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True))
    op.add_column("avito_chats", sa.Column("order_number", sa.String(32), nullable=True))
    op.create_index("ix_avito_chats_reply_due_at", "avito_chats", ["reply_due_at"])

    op.add_column("avito_messages", sa.Column("send_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("avito_messages", sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("avito_messages", sa.Column("order_payload", postgresql.JSONB(), nullable=True))
    op.create_index("ix_avito_messages_send_at", "avito_messages", ["send_at"])

    op.create_table(
        "avito_bot_examples",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("bot_answer", sa.Text(), nullable=True),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("item_title", sa.String(300), nullable=True),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("avito_chats.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "avito_item_links",
        sa.Column("item_id", sa.BigInteger(), primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_title", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("avito_item_links")
    op.drop_table("avito_bot_examples")
    op.drop_index("ix_avito_messages_send_at", table_name="avito_messages")
    op.drop_column("avito_messages", "order_payload")
    op.drop_column("avito_messages", "attempts")
    op.drop_column("avito_messages", "send_at")
    op.drop_index("ix_avito_chats_reply_due_at", table_name="avito_chats")
    op.drop_column("avito_chats", "order_number")
    op.drop_column("avito_chats", "order_id")
    op.drop_column("avito_chats", "human_question")
    op.drop_column("avito_chats", "reply_due_at")
