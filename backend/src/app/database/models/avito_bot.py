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
from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy import text as sql_text  # в AvitoMessage колонка text перекрывает функцию
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
    # Очередь: когда бот должен подумать над ответом. Новое сообщение покупателя сдвигает срок —
    # так несколько сообщений подряд получают один ответ. Обработчик живёт в avito_bot_worker.
    reply_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    human_question: Mapped[str | None] = mapped_column(String(500), nullable=True,
                                                       comment="На что бот не смог ответить — для раздела «Обучение»")
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    order_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True,
                                                              comment="Когда бот напомнил о себе (одно напоминание на диалог)")
    opted_out: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"),
                                            comment="Покупатель попросил не писать — в рассылки не попадает")
    last_broadcast_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
                                        comment="sent | scheduled | draft | discarded | failed")
    source: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="rule | llm | staff | avito")
    rule_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("avito_bot_rules.id", ondelete="SET NULL"), nullable=True)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    send_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True,
                                                     comment="Для scheduled: когда отправить")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    order_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True,
                                                                 comment="Бронь, которую бот оформит, когда сообщение уйдёт")
    quoted_subject: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AvitoBotExample(Base):
    """Как сотрудник ответил вместо бота (правка черновика или свой ответ). Похожие примеры
    подмешиваются модели — бот учится на правках без переобучения."""
    __tablename__ = "avito_bot_examples"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    bot_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    item_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    chat_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("avito_chats.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AvitoItemLink(Base):
    """Объявление Авито → карточка каталога для оформления брони."""
    __tablename__ = "avito_item_links"

    item_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    item_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AvitoBotEvent(Base):
    """Журнал событий бота для аналитики: позвал человека, оформил бронь, напомнил и т.п."""
    __tablename__ = "avito_bot_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("avito_chats.id", ondelete="CASCADE"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True,
                                      comment="handoff | order | reminder | reminder_skip | send_failed | poll_caught")
    detail: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


class AvitoBotLlmUsage(Base):
    """Расход модели по дням (московским): вызовы, ошибки, токены — для стоимости в аналитике."""
    __tablename__ = "avito_bot_llm_usage"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    calls: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    errors: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    prompt_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=sql_text("0"))
    completion_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=sql_text("0"))


class AvitoBroadcast(Base):
    """Рассылка по выбранным диалогам Авито. Уходит медленно, по одному сообщению раз в
    broadcast_interval_seconds — чтобы Авито не счёл это спамом."""
    __tablename__ = "avito_broadcasts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False, comment="Шаблон: {name}, {item}")
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="draft", index=True,
                                        comment="draft | sending | paused | done | cancelled")
    total: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    sent: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    failed: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    skipped: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sql_text("0"))
    next_send_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AvitoBroadcastRecipient(Base):
    __tablename__ = "avito_broadcast_recipients"
    __table_args__ = (UniqueConstraint("broadcast_id", "chat_id", name="uq_avito_broadcast_chat"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    broadcast_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("avito_broadcasts.id", ondelete="CASCADE"), nullable=False, index=True)
    chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("avito_chats.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="pending", comment="pending | sent | failed | skipped")
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
