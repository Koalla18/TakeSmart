from __future__ import annotations

import os
from datetime import datetime

from sqlalchemy import Boolean, Computed, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db.base import Base

# Detect if using PostgreSQL
_is_postgres = os.getenv("DATABASE_URL", "").startswith("postgres")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        Index("ix_products_variant_group", "variant_group_id"),
        Index("ix_products_is_used", "is_used"),
        Index("ix_products_is_active", "is_active"),
        Index("ix_products_category_active", "category_id", "is_active"),
        *(
            (Index("ix_products_tsv", "tsv", postgresql_using="gin"),)
            if _is_postgres
            else ()
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(300), unique=True, nullable=False, index=True)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    category: Mapped["Category | None"] = relationship("Category", back_populates="products")

    price: Mapped[int] = mapped_column(Integer, nullable=False)
    old_price: Mapped[int | None] = mapped_column(Integer, nullable=True)

    badge: Mapped[str | None] = mapped_column(String(20), nullable=True)
    in_stock: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)

    variant_group_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    storage: Mapped[str | None] = mapped_column(String(50), nullable=True)

    image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    images: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    specs: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Full-text search vector (PostgreSQL only)
    if _is_postgres:
        tsv: Mapped[str] = mapped_column(
            TSVECTOR,
            Computed(
                """
                setweight(to_tsvector('russian', coalesce(name, '')), 'A')
                || setweight(to_tsvector('english', coalesce(name, '')), 'A')
                || setweight(to_tsvector('russian', coalesce(description, '')), 'B')
                || setweight(to_tsvector('english', coalesce(description, '')), 'B')
                """,
                persisted=True,
            ),
            nullable=False,
        )

    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

