"""Record checkout methods, payment surcharge and selected variants."""
from alembic import op
import sqlalchemy as sa

revision = "548bd9d3c2a1"
down_revision = "f23c9b1d471e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("payment_method", sa.String(16), nullable=True))
    op.add_column("orders", sa.Column("delivery_method", sa.String(16), nullable=True))
    op.add_column("orders", sa.Column("payment_surcharge", sa.Numeric(12, 2), server_default="0", nullable=False))
    op.add_column("order_items", sa.Column("variant_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_order_items_variant", "order_items", "product_variants", ["variant_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_order_items_variant", "order_items", type_="foreignkey")
    op.drop_column("order_items", "variant_id")
    op.drop_column("orders", "payment_surcharge")
    op.drop_column("orders", "delivery_method")
    op.drop_column("orders", "payment_method")
