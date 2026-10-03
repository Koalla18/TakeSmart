"""
Услуга «Приложения на iPhone», модель «аккаунт салона».

Приложения, которых нет в App Store, берутся из истории покупок Apple ID салона.
Покупатель (или сотрудник на его телефоне) на время установки входит в этот
аккаунт только в разделе «Контент и покупки», скачивает выбранное и возвращает
свой аккаунт. iCloud покупателя не трогается.

  InstallAccount — Apple ID салона. Пароль на сервере НЕ хранится: его знает и вводит сотрудник.
  InstallApp     — каталог: что есть в истории покупок аккаунта и что из этого показывать.
  InstallOrder   — заказ на установку и персональная страница покупателя /i/<token>.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.app.database.session import Base


class InstallAccount(Base):
    """Apple ID салона, в истории покупок которого лежат приложения каталога."""
    __tablename__ = "install_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    label: Mapped[str] = mapped_column(String(80), nullable=False, comment="Как аккаунт называется у сотрудников")
    apple_id: Mapped[str] = mapped_column(String(160), nullable=False)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class InstallApp(Base):
    """Приложение в каталоге «Приложения на iPhone».

    account_id — Apple ID салона, в истории покупок которого это приложение лежит.
    Он может быть пустым: тогда это запись ОБЩЕГО ПУЛА (справочный каталог — какие
    приложения салон предлагает). Пул наполняется вручную и начальным набором; при
    чтении истории покупок салонного Apple ID совпадающие записи к нему привязываются.
    """
    __tablename__ = "install_apps"
    __table_args__ = (UniqueConstraint("account_id", "bundle_id", name="uq_install_apps_account_bundle"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("install_accounts.id", ondelete="CASCADE"),
                                                         nullable=True, index=True,
                                                         comment="Apple ID салона с этим приложением; пусто — запись общего пула")
    store_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="App Store ID (trackId)")
    bundle_id: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False, comment="Название как в истории покупок")
    title: Mapped[str | None] = mapped_column(String(120), nullable=True, comment="Название для каталога, если нужно своё")
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    genre: Mapped[str | None] = mapped_column(String(80), nullable=True)
    category: Mapped[str | None] = mapped_column(String(40), nullable=True, comment="Группа в каталоге: Банки, Маркетплейсы…")
    is_bank: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    source: Mapped[str] = mapped_column(String(10), nullable=False, server_default="import", comment="seed | import | manual")
    in_store: Mapped[bool | None] = mapped_column(Boolean, nullable=True, comment="Есть ли сейчас в российском App Store")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), comment="Показывать в каталоге")
    sort: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InstallOrder(Base):
    """Заказ на установку. По token открывается персональная страница покупателя."""
    __tablename__ = "install_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    number: Mapped[int] = mapped_column(Integer, server_default=text("nextval('install_order_number_seq')"),
                                        unique=True, nullable=False)
    token: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("install_accounts.id", ondelete="SET NULL"),
                                                         nullable=True, index=True)
    account_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="ready", index=True,
                                        comment="new | ready | active | done | expired | cancelled")
    mode: Mapped[str] = mapped_column(String(8), nullable=False, server_default="staff",
                                      comment="staff — ставит сотрудник в салоне; self — покупатель сам, код выдаёт страница заказа")
    source: Mapped[str] = mapped_column(String(8), nullable=False, server_default="admin", comment="admin | site | own (свой iPhone)")
    apps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"),
                                                       comment="key, app_id, bundle_id, store_id, name, icon_url, version, status")
    price: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), comment="Сумма заказа, ₽")
    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Код подтверждения покупателю. В базе только отметки времени: сам код живёт
    # в памяти процесса полторы минуты и в базу не пишется.
    code_requests: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    code_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    code_delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    events: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback: Mapped[str | None] = mapped_column(String(500), nullable=True)
