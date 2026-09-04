"""add page_visits table

Сырые события посещаемости витрины: их пишет публичная ручка
POST /api/v1/track/visit, а читает админская аналитика
GET /api/v1/admin/analytics (визиты, конверсия, топ страниц).

Индексы: по created_at (все выборки идут по периоду) и составной
(created_at, visitor_id) — под подсчёт уникальных посетителей.

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-09-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 't0u1v2w3x4y5'
down_revision: Union[str, None] = 's9t0u1v2w3x4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'page_visits',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('path', sa.String(length=500), nullable=False),
        sa.Column('referrer', sa.String(length=500), nullable=True),
        sa.Column('visitor_id', sa.String(length=64), nullable=True),
        sa.Column('session_id', sa.String(length=64), nullable=True),
        sa.Column('user_agent', sa.String(length=300), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index('ix_page_visits_visitor_id', 'page_visits', ['visitor_id'])
    op.create_index('ix_page_visits_session_id', 'page_visits', ['session_id'])
    op.create_index('ix_page_visits_created_at', 'page_visits', ['created_at'])
    op.create_index(
        'ix_page_visits_created_at_visitor', 'page_visits', ['created_at', 'visitor_id']
    )


def downgrade() -> None:
    op.drop_index('ix_page_visits_created_at_visitor', table_name='page_visits')
    op.drop_index('ix_page_visits_created_at', table_name='page_visits')
    op.drop_index('ix_page_visits_session_id', table_name='page_visits')
    op.drop_index('ix_page_visits_visitor_id', table_name='page_visits')
    op.drop_table('page_visits')
