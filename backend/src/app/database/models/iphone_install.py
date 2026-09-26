"""
Услуга «Установка приложений на iPhone».

Как устроено: покупатель оставляет заявку (на сайте или у прилавка), сотрудник
в админке отправляет её на «станцию» — Mac в павильоне, к которому подключён
iPhone покупателя. Станция скачивает приложение из истории покупок Apple ID
покупателя (ipatool) и ставит по кабелю (libimobiledevice). Пароль и код Apple ID
вводятся только на станции и на сервер НЕ попадают — здесь хранится лишь факт
установки, модель и версия iOS.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.app.database.session import Base


class IphoneApp(Base):
    """Каталог приложений, которые магазин ставит на iPhone."""
    __tablename__ = "iphone_apps"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    bundle_id: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True,
                                           comment="Bundle ID приложения, по нему ipatool скачивает файл")
    app_store_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="Числовой id в App Store")
    category: Mapped[str] = mapped_column(String(40), nullable=False, server_default="other",
                                          comment="bank | messenger | social | service | other")
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default="0",
                                           comment="Цена установки одного приложения")
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now(), nullable=False)


class InstallStation(Base):
    """Mac в павильоне с запущенной программой-станцией. Ходит к нам по своему токену."""
    __tablename__ = "install_stations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True,
                                            comment="sha256 токена станции; сам токен показывается один раз")
    version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"),
                                                  comment="Что станция сообщила последним пульсом: устройство, вход Apple ID")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InstallRequest(Base):
    """Заявка покупателя: кто, какой телефон, какие приложения."""
    __tablename__ = "install_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_number: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    customer_name: Mapped[str] = mapped_column(String(120), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(32), nullable=False)
    device_model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ios_version: Mapped[str | None] = mapped_column(String(24), nullable=True)
    apps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"),
                                                       comment="Снимок выбранных приложений: app_id, name, bundle_id, price")
    comment: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, server_default="site", comment="site | counter")
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="new", index=True,
                                        comment="new | in_progress | done | cancelled")
    staff_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now(), nullable=False)


class InstallJob(Base):
    """Задание станции: поставить набор приложений на подключённый iPhone по конкретной заявке."""
    __tablename__ = "install_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),
                                                  ForeignKey("install_requests.id", ondelete="CASCADE"),
                                                  nullable=False, index=True)
    station_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True),
                                                         ForeignKey("install_stations.id", ondelete="SET NULL"),
                                                         nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="queued", index=True,
                                        comment="queued | running | done | failed | cancelled")
    apps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"),
                                                       comment="bundle_id, name, price, status, version, error")
    device_udid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    device_model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ios_version: Mapped[str | None] = mapped_column(String(24), nullable=True)
    log: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
