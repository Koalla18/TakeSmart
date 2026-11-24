"""Авито-бот: журнал событий, расход модели, напоминания

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("avito_chats", sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "avito_bot_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("avito_chats.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("detail", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_avito_bot_events_chat_id", "avito_bot_events", ["chat_id"])
    op.create_index("ix_avito_bot_events_kind", "avito_bot_events", ["kind"])
    op.create_index("ix_avito_bot_events_created_at", "avito_bot_events", ["created_at"])
    op.create_table(
        "avito_bot_llm_usage",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("calls", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("errors", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("prompt_tokens", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("completion_tokens", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
    )
    # Для аналитики: сообщения за период по автору и статусу
    op.create_index("ix_avito_messages_created_at", "avito_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_avito_messages_created_at", table_name="avito_messages")
    op.drop_table("avito_bot_llm_usage")
    op.drop_table("avito_bot_events")
    op.drop_column("avito_chats", "reminder_sent_at")
