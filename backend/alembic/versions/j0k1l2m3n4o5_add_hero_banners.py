"""add hero_banners table (landing hero slider) + seed defaults

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-07-06 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'j0k1l2m3n4o5'
down_revision: Union[str, None] = 'i9j0k1l2m3n4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'hero_banners',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('badge', sa.String(200), nullable=True),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('highlight', sa.String(255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('image', sa.String(500), nullable=True),
        sa.Column('cta_label', sa.String(120), nullable=True),
        sa.Column('cta_link', sa.String(500), nullable=True),
        sa.Column('secondary_label', sa.String(120), nullable=True),
        sa.Column('secondary_link', sa.String(500), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # Сид: 3 текущих баннера лендинга — чтобы после деплоя главная не была пустой.
    banners = sa.table(
        'hero_banners',
        sa.column('badge', sa.String),
        sa.column('title', sa.String),
        sa.column('highlight', sa.String),
        sa.column('description', sa.Text),
        sa.column('image', sa.String),
        sa.column('cta_label', sa.String),
        sa.column('cta_link', sa.String),
        sa.column('secondary_label', sa.String),
        sa.column('secondary_link', sa.String),
        sa.column('sort_order', sa.Integer),
    )
    op.bulk_insert(banners, [
        {
            'badge': 'Новая коллекция 2026', 'title': 'Умная техника', 'highlight': 'будущего',
            'description': 'Смартфоны, ноутбуки и аксессуары от ведущих брендов с официальной гарантией.',
            'image': '/iphone-17-pro.png',
            'cta_label': 'Смотреть каталог', 'cta_link': '/catalog',
            'secondary_label': 'Написать менеджеру', 'secondary_link': 'https://t.me/takesmart_manager',
            'sort_order': 0,
        },
        {
            'badge': 'Trade-in', 'title': 'Обменяй старое', 'highlight': 'на новое',
            'description': 'Сдайте свой гаджет и получите скидку на новую технику. Оценка за пару минут.',
            'image': '/watch-ultra-2.png',
            'cta_label': 'Узнать про Trade-in', 'cta_link': '/trade-in',
            'secondary_label': 'В каталог', 'secondary_link': '/catalog',
            'sort_order': 1,
        },
        {
            'badge': 'Доставка по Москве', 'title': 'Привезём', 'highlight': 'за 30 минут',
            'description': 'Быстрая доставка и удобные способы оплаты — наличными, картой или в рассрочку.',
            'image': '/iphone-15-blue.png',
            'cta_label': 'Доставка и оплата', 'cta_link': '/delivery',
            'secondary_label': 'В каталог', 'secondary_link': '/catalog',
            'sort_order': 2,
        },
    ])


def downgrade() -> None:
    op.drop_table('hero_banners')
