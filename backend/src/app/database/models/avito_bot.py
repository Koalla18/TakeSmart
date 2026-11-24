"""
Авито-бот: отвечает покупателям в мессенджере Авито.

  AvitoBotRule — автоответ «ключевые слова → текст» с расписанием, задержкой и
                 лимитом срабатываний на диалог. Тексты правил — ещё и база
                 знаний для модели: она отвечает по ним, а не придумывает.
  AvitoChat    — диалог Авито: объявление, покупатель, кто сейчас ведёт (бот или
                 сотрудник), нужен ли человек.
  AvitoMessage — сообщение диалога: входящее от покупателя, ответ бота (в том
                 числе черновик, который сотрудник ещё не отправил) или сотрудника.

Настройки бота (режим, имя менеджера, модель, ключи) — один JSON в site_settings
под ключом avito_bot_config.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.app.database.session import Base


class AvitoBotRule(Base):
    __tablename__ = "avito_bot_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    keywords: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"),
                                                comment="Слова и фразы, на которые срабатывает правило")
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    verbatim: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"),
                                           comment="true — отправить текст как есть; false — модель отвечает своими словами по этому тексту")
    time_from: Mapped[str] = mapped_column(String(5), nullable=False, server_default="00:00", comment="Московское время, ЧЧ:ММ")
    time_to: Mapped[str] = mapped_column(String(5), nullable=False, server_default="23:59")
    days: Mapped[list[int]] = mapped_column(JSONB, nullable=False, server_default=text("'[0,1,2,3,4,5,6]'::jsonb"),
                                            comment="Дни недели: 0 — понедельник … 6 — воскресенье")
    delay_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("2"))
    max_per_chat: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"),
                                              comment="Сколько раз за диалог срабатывает; 0 — без ограничения")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    sort: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    hits: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AvitoChat(Base):
    __tablename__ = "avito_chats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    avito_chat_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    is_simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"),
                                               comment="Тренировочный диалог из админки: в Авито ничего не уходит")
    client_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    client_avito_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    item_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    item_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    item_price: Mapped[str | None] = mapped_column(String(60), nullable=True)
    item_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mode: Mapped[str] = mapped_column(String(8), nullable=False, server_default="bot",
                                      comment="bot — отвечает бот; human — диалог ведёт сотрудник, бот молчит")
    needs_human: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), index=True)
    human_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rule_hits: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"),
                                                      comment="id правила → сколько раз сработало в этом диалоге")
    last_message_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AvitoMessage(Base):
    __tablename__ = "avito_messages"
    __table_args__ = (Index("ix_avito_messages_chat_created", "chat_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("avito_chats.id", ondelete="CASCADE"), nullable=False)
    avito_message_id: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    author: Mapped[str] = mapped_column(String(8), nullable=False, comment="client | bot | staff")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="sent", index=True,
                                        comment="sent | draft | discarded | failed")
    source: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="rule | llm | staff | avito")
    rule_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("avito_bot_rules.id", ondelete="SET NULL"), nullable=True)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
