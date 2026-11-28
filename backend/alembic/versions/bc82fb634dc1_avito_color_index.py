"""Reindex the active Avito price list with its original finish names."""
from alembic import context, op
from sqlalchemy import select

revision = "bc82fb634dc1"
down_revision = "4d7fc2d8a7fe"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if context.is_offline_mode():
        return
    from src.app.core.avito_catalog import imports, prepare, price_hash, publish, variants
    from src.app.database.models.site_setting import SiteSetting

    conn = op.get_bind()
    config = conn.scalar(select(SiteSetting.value).where(SiteSetting.key == "avito_bot_config").with_for_update())
    raw = config.get("price_list") if isinstance(config, dict) else None
    if not raw:
        return
    active = conn.scalar(select(imports.c.id).where(imports.c.source_hash == price_hash(raw))
                         .order_by(imports.c.id.desc()).limit(1))
    previous = set(conn.execute(select(variants.c.key, variants.c.price, variants.c.available)
                                .where(variants.c.import_id == active)))
    rows, errors = prepare(raw)
    rebuilt = {(row["key"], row["price"], row["available"]) for row in rows}
    if previous == rebuilt:
        return
    if errors:
        raise ValueError(f"Ошибка при переиндексации прайса Авито: {errors[0]}")
    publish(conn, raw)


def downgrade() -> None:
    # Source data and all previous imports are retained. No schema changes.
    pass
