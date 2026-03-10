"""add quick_filters JSONB to categories

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-03-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'h8i9j0k1l2m3'
down_revision: Union[str, None] = 'g7h8i9j0k1l2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'categories',
        sa.Column('quick_filters', postgresql.JSONB(), nullable=True,
                   comment='Массив тегов [{label, query}] для быстрых фильтров в каталоге'),
    )


def downgrade() -> None:
    op.drop_column('categories', 'quick_filters')
