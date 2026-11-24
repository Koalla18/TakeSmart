"""Заказы: источник (заявки из чата Авито)

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("source", sa.String(16), nullable=True,
                                      comment="Источник: null — сайт, avito — чат Авито"))


def downgrade() -> None:
    op.drop_column("orders", "source")
