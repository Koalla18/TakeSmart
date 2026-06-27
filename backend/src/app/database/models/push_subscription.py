from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func

from src.app.database.session import Base


class PushSubscription(Base):
    """Web Push подписка устройства (для PWA «Заказы»)."""

    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=True, index=True)
    endpoint = Column(Text, unique=True, nullable=False)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    user_agent = Column(String(300), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
