from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Cart(Base):
    __tablename__ = "carts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="carts")
    items = relationship("CartItem", back_populates="cart", cascade="all, delete-orphan")


class CartItem(Base):
    __tablename__ = "cart_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cart_id: Mapped[int] = mapped_column(ForeignKey("carts.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    price_snapshot: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)

    cart = relationship("Cart", back_populates="items")
    product = relationship("Product")

