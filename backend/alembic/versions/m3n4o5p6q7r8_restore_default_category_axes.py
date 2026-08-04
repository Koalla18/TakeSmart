"""restore default axes for every remaining category

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-08-03 18:45:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "m3n4o5p6q7r8"
down_revision: Union[str, None] = "l2m3n4o5p6q7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Give every untouched category its former default group axes.

    The old group creator always showed these three fields for categories with
    no special scheme. Apply them only to NULL values so an admin's saved
    configuration, including an intentional empty list, is never overwritten.
    """
    op.get_bind().exec_driver_sql(
        """
        UPDATE categories
        SET product_fields = '[
          {"key":"color","label":"Цвета","field_type":"text","placeholder":"Чёрный","hint":"Каждый цвет = отдельная карточка товара","is_variant":true},
          {"key":"storage","label":"Параметр 1","field_type":"text","placeholder":"256 ГБ","is_variant":true},
          {"key":"connectivity","label":"Параметр 2","field_type":"text","placeholder":"SIM + eSIM","is_variant":true}
        ]'::jsonb
        WHERE product_fields IS NULL
        """
    )


def downgrade() -> None:
    # This migration restores legacy data defaults. Do not erase manager edits.
    pass
