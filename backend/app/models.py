from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, JSON, Boolean
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


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
