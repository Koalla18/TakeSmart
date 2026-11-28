"""Прайс Авито в PostgreSQL. Каждая загрузка хранит снимок цен и наличия."""
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, ForeignKey, Identity, Index, Integer,
    Numeric, String, Table, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB

from src.app.database.session import Base

metadata = Base.metadata

brands = Table("avito_catalog_brands", metadata,
    Column("key", String(120), primary_key=True),
    Column("name", String(120), nullable=False),
)
categories = Table("avito_catalog_categories", metadata,
    Column("key", String(120), primary_key=True),
    Column("name", String(120), nullable=False),
)
models = Table("avito_catalog_models", metadata,
    Column("id", BigInteger, Identity(), primary_key=True),
    Column("brand_key", ForeignKey(brands.c.key), nullable=False),
    Column("category_key", ForeignKey(categories.c.key), nullable=False),
    Column("key", String(300), nullable=False),
    Column("name", String(300), nullable=False),
    UniqueConstraint("brand_key", "category_key", "key"),
)
Index("ix_avito_catalog_models_key", models.c.key)
imports = Table("avito_catalog_imports", metadata,
    Column("id", BigInteger, Identity(), primary_key=True),
    Column("source_hash", String(64), nullable=False),
    Column("source", Text, nullable=False),
    Column("errors", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)
Index("ix_avito_catalog_imports_hash", imports.c.source_hash, imports.c.id)
variants = Table("avito_catalog_variants", metadata,
    Column("import_id", ForeignKey(imports.c.id, ondelete="CASCADE"), primary_key=True),
    Column("key", String(64), primary_key=True),
    Column("model_id", ForeignKey(models.c.id), nullable=False),
    Column("name", String(350), nullable=False),
    Column("attributes", JSONB, nullable=False),
    Column("price", Numeric(12, 2), nullable=False),
    Column("available", Boolean, nullable=False),
    Column("source_line", Text, nullable=False),
    Column("source_number", Integer, nullable=True),
)
Index("ix_avito_catalog_variants_model", variants.c.import_id, variants.c.model_id)
