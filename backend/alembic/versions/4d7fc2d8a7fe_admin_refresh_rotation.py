"""Remember consumed admin refresh tokens until their expiry."""
from alembic import op
import sqlalchemy as sa

revision = "4d7fc2d8a7fe"
down_revision = "548bd9d3c2a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("admin_refresh_consumed", sa.Column("digest", sa.String(64), primary_key=True),
                    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_admin_refresh_consumed_expires_at", "admin_refresh_consumed", ["expires_at"])


def downgrade() -> None:
    op.drop_table("admin_refresh_consumed")
