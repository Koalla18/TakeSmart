"""Комментарии сотрудников к заказам: лента вместо одной заметки администратора

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "order_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_name", sa.String(60), nullable=False, comment="Как подписался сотрудник"),
        sa.Column("admin_username", sa.String(150), nullable=True, comment="Учётка админки, с которой написан комментарий"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_order_comments_order_id_created_at",
        "order_comments",
        ["order_id", "created_at"],
    )

    # Старая «Заметка администратора» (одно поле на заказ) становится первым
    # комментарием ленты. Само поле не трогаем — данные не теряются ни при каком исходе.
    bind = op.get_bind()
    notes = bind.execute(
        sa.text(
            "SELECT id, btrim(admin_note) AS note, updated_at FROM orders "
            "WHERE btrim(coalesce(admin_note, '')) <> ''"
        )
    ).fetchall()
    if notes:
        comments = sa.table(
            "order_comments",
            sa.column("id", postgresql.UUID(as_uuid=True)),
            sa.column("order_id", postgresql.UUID(as_uuid=True)),
            sa.column("author_name", sa.String),
            sa.column("body", sa.Text),
            sa.column("created_at", sa.DateTime(timezone=True)),
        )
        op.bulk_insert(
            comments,
            [
                {
                    "id": uuid.uuid4(),
                    "order_id": row.id,
                    "author_name": "Заметка администратора",
                    "body": row.note,
                    "created_at": row.updated_at,
                }
                for row in notes
            ],
        )


def downgrade() -> None:
    op.drop_index("ix_order_comments_order_id_created_at", table_name="order_comments")
    op.drop_table("order_comments")
