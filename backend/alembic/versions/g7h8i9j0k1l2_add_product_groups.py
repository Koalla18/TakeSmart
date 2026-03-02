"""add product_groups table and group_id to products

Revision ID: g7h8i9j0k1l2
Revises: f6a7b8c9d0e1
Create Date: 2026-03-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'g7h8i9j0k1l2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Создаём таблицу product_groups
    op.create_table(
        'product_groups',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # Добавляем group_id FK в products
    op.add_column('products', sa.Column('group_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_products_group_id', 'products', ['group_id'])
    op.create_foreign_key(
        'fk_products_group_id',
        'products', 'product_groups',
        ['group_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_products_group_id', 'products', type_='foreignkey')
    op.drop_index('ix_products_group_id', table_name='products')
    op.drop_column('products', 'group_id')
    op.drop_table('product_groups')
