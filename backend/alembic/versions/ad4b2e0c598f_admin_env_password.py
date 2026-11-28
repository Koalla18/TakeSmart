"""Track changes to the deployment password of the configured admin."""
from alembic import op
import sqlalchemy as sa

revision = "ad4b2e0c598f"
down_revision = "e8241fac3b06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("admins", sa.Column("env_password_hash", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("admins", "env_password_hash")
