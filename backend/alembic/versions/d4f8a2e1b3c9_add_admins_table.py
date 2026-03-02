"""add_admins_table

Revision ID: d4f8a2e1b3c9
Revises: ce5d336d912d
Create Date: 2026-02-26 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4f8a2e1b3c9"
down_revision: Union[str, Sequence[str], None] = "ce5d336d912d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admins",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(100), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
    )
    op.create_index("ix_admins_id", "admins", ["id"])
    op.create_index("ix_admins_username", "admins", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_admins_username", table_name="admins")
    op.drop_index("ix_admins_id", table_name="admins")
    op.drop_table("admins")
