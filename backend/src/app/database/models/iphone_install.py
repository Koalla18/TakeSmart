"""
Услуга «Приложения на iPhone».

Как устроено: покупатель отдаёт iPhone, сотрудник подключает его кабелем к Mac
в павильоне («станция»), покупатель вводит на станции свой Apple ID, станция
показывает всё из истории покупок аккаунта и ставит выбранное оригинальным
файлом Apple (ipatool + libimobiledevice). Никаких заявок и каталога: всё
решается у прилавка, как у bmrng. Сюда станция шлёт только пульс и историю
установок — устройство, что и какой версии поставлено. Apple ID покупателя,
пароль и код на сервер не попадают.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func, text, Integer
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.app.database.session import Base


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
    # История покупок Apple ID, который сейчас введён на помощнике: обновляется только при смене
    purchases: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    purchases_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InstallJob(Base):
    """Одна сессия установки: iPhone покупателя и что на него поставили."""
    __tablename__ = "install_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    station_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True),
                                                         ForeignKey("install_stations.id", ondelete="SET NULL"),
                                                         nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="queued", index=True,
                                        comment="running | done | failed | cancelled")
    apps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"),
                                                       comment="bundle_id, name, status, version, error")
    device_udid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    device_model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ios_version: Mapped[str | None] = mapped_column(String(24), nullable=True)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True, comment="Пометка сотрудника, напр. телефон покупателя")
    log: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
