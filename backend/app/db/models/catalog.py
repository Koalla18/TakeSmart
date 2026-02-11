from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, Computed, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.db.base import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))

    parent = relationship("Category", remote_side=[id])
    products = relationship("Product", back_populates="category")


class Brand(Base):
    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)

    products = relationship("Product", back_populates="brand")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="RUB", nullable=False)
    stock: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))

    name_embedding: Mapped[list[float] | None] = mapped_column(Vector(settings.product_embedding_dim))
    tsv: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(
            """
            setweight(to_tsvector('russian', coalesce(name, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
            setweight(to_tsvector('russian', coalesce(description, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B')
            """,
            persisted=True,
        ),
        nullable=False,
    )

    __table_args__ = (Index("ix_products_tsv", "tsv", postgresql_using="gin"),)

    brand = relationship("Brand", back_populates="products")
    category = relationship("Category", back_populates="products")
    images = relationship("ProductImage", back_populates="product", cascade="all, delete-orphan")
    specs = relationship("ProductSpec", back_populates="product", cascade="all, delete-orphan")


class ProductImage(Base):
    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    product = relationship("Product", back_populates="images")


class ProductSpec(Base):
    __tablename__ = "product_specs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[str] = mapped_column(String(500), nullable=False)

    product = relationship("Product", back_populates="specs")
