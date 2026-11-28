"""Разобранные позиции прайса Авито, справочники и история загрузок."""

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "f7a1d9c2e305"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("brands", "categories"):
        op.create_table(f"avito_catalog_{name}",
            sa.Column("key", sa.String(120), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
        )
    op.create_table("avito_catalog_models",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("brand_key", sa.String(120), sa.ForeignKey("avito_catalog_brands.key"), nullable=False),
        sa.Column("category_key", sa.String(120), sa.ForeignKey("avito_catalog_categories.key"), nullable=False),
        sa.Column("key", sa.String(300), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.UniqueConstraint("brand_key", "category_key", "key"),
    )
    op.create_index("ix_avito_catalog_models_key", "avito_catalog_models", ["key"])
    op.create_table("avito_catalog_imports",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("source", sa.Text, nullable=False),
        sa.Column("errors", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_avito_catalog_imports_hash", "avito_catalog_imports", ["source_hash", "id"])
    op.create_table("avito_catalog_variants",
        sa.Column("import_id", sa.BigInteger, sa.ForeignKey("avito_catalog_imports.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("model_id", sa.BigInteger, sa.ForeignKey("avito_catalog_models.id"), nullable=False),
        sa.Column("name", sa.String(350), nullable=False),
        sa.Column("attributes", JSONB, nullable=False),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("available", sa.Boolean, nullable=False),
        sa.Column("source_line", sa.Text, nullable=False),
        sa.Column("source_number", sa.Integer, nullable=True),
    )
    op.create_index("ix_avito_catalog_variants_model", "avito_catalog_variants", ["import_id", "model_id"])

    if not context.is_offline_mode():
        from src.app.core.avito_catalog import publish
        from src.app.database.models.site_setting import SiteSetting

        connection = op.get_bind()
        value = connection.execute(sa.select(SiteSetting.value).where(
            SiteSetting.key == "avito_bot_config"
        )).scalar_one_or_none()
        if isinstance(value, dict) and isinstance(value.get("price_list"), str):
            publish(connection, value["price_list"])


def downgrade() -> None:
    for name in ("variants", "imports", "models", "categories", "brands"):
        op.drop_table(f"avito_catalog_{name}")
