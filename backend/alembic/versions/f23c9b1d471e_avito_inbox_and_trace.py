"""Persist incoming Avito events and the source of outgoing quotes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "f23c9b1d471e"
down_revision = "ad4b2e0c598f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "avito_webhook_events",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("chat_id", sa.String(120), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_avito_webhook_events_due_at", "avito_webhook_events", ["due_at"])
    op.create_index("ix_avito_webhook_events_chat_created", "avito_webhook_events", ["chat_id", "created_at", "key"])
    op.add_column("avito_messages", sa.Column("decision_trace", JSONB, nullable=True))
    op.add_column("avito_messages", sa.Column("send_started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("avito_messages", "send_started_at")
    op.drop_column("avito_messages", "decision_trace")
    op.drop_table("avito_webhook_events")
