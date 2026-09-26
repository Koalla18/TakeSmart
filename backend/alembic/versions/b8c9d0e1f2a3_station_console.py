"""Помощник iPhone: список покупок и очередь команд через сервер

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("install_stations", sa.Column("purchases", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("install_stations", sa.Column("purchases_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("install_stations", "purchases_version")
    op.drop_column("install_stations", "purchases")
