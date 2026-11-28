"""Rebuild the current Avito catalog and retain quoted subjects on sent messages."""
from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "e8241fac3b06"
down_revision = "f7a1d9c2e305"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("avito_messages", sa.Column("quoted_subject", JSONB, nullable=True))
    if context.is_offline_mode():
        return
    from src.app.core.avito_catalog import prepare, publish
    from src.app.database.models.site_setting import SiteSetting

    connection = op.get_bind()
    config = connection.execute(sa.select(SiteSetting.value).where(
        SiteSetting.key == "avito_bot_config"
    )).scalar_one_or_none()
    price_list = config.get("price_list") if isinstance(config, dict) else None
    if price_list:
        _, errors = prepare(price_list)
        if errors:
            raise RuntimeError(f"Текущий прайс Авито нельзя перенести автоматически: {errors[0]}")
        publish(connection, price_list)


def downgrade() -> None:
    op.drop_column("avito_messages", "quoted_subject")
