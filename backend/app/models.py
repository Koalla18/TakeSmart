from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, JSON, Boolean, Float, ForeignKey, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Category(Base):
    __tablename__ = 'categories'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)  # emoji icon
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    products: Mapped[list["Product"]] = relationship("Product", back_populates="category")


class Product(Base):
    __tablename__ = 'products'
    __table_args__ = (
        Index('ix_products_variant_group', 'variant_group_id'),
        Index('ix_products_is_used', 'is_used'),
        Index('ix_products_is_active', 'is_active'),
        Index('ix_products_category_active', 'category_id', 'is_active'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(300), unique=True, nullable=False, index=True)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    category: Mapped["Category | None"] = relationship("Category", back_populates="products")
    
    price: Mapped[int] = mapped_column(Integer, nullable=False)  # in rubles
    old_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    badge: Mapped[str | None] = mapped_column(String(20), nullable=True)  # hit, new, sale
    in_stock: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)  # for used/б/у products (indexed via __table_args__)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)  # for landing page hero
    
    # Variant support - products with same variant_group_id are variants of each other
    variant_group_id: Mapped[str | None] = mapped_column(String(50), nullable=True)  # indexed via __table_args__
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)  # белый, голубой, etc.
    color_code: Mapped[str | None] = mapped_column(String(10), nullable=True)  # #FFFFFF, #87CEEB, etc.
    storage: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 256 ГБ, 512 ГБ, etc.
    
    image: Mapped[str | None] = mapped_column(String(500), nullable=True)  # URL or emoji
    images: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # array of image URLs
    
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    specs: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # [{label, value}]
    
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # indexed via __table_args__
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Order(Base):
    __tablename__ = 'orders'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(200), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    # Cart items as JSON: [{product_id, name, price, quantity, image}]
    items: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    total_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    # Payment & Delivery
    payment_method: Mapped[str | None] = mapped_column(String(50), nullable=True)  # cash, card, online
    delivery_method: Mapped[str | None] = mapped_column(String(50), nullable=True)  # pickup, courier, post
    delivery_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    # Status: new, processing, ready, completed, cancelled
    status: Mapped[str] = mapped_column(String(20), default='new', nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
