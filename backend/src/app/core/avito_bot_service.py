"""
Авито-бот: приём сообщений, решение, отправка, действия сотрудников.

Поток: webhook Авито → handle_webhook сохраняет сообщение и ставит ответ в очередь
(schedule_reply) → через паузу «как у человека» бот решает (avito_bot_engine) и
либо отправляет ответ, либо кладёт черновик сотруднику, либо зовёт человека (push
в PWA «Заказы»). Если покупатель пишет несколько сообщений подряд, отвечаем один
раз на все — последняя задача по диалогу отменяет предыдущие.

Очередь живёт в памяти процесса (как и коды в «Приложениях на iPhone»): при
перезапуске недоотправленные ответы теряются, сообщения покупателей — нет.
"""
from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.core import avito_client, llm_client
from src.app.core.avito_bot_engine import (
    ChatContext, PromptConfig, build_messages, build_system_prompt, catalog_tokens, human_delay,
    match_rule, parse_llm_answer, rule_covers, starts_with_refusal,
)
from src.app.core.config import settings
from src.app.core.logger import get_logger
from src.app.core.push_service import send_push_to_all
from src.app.database.models.avito_bot import AvitoBotRule, AvitoChat, AvitoMessage
from src.app.database.models.product import Product
from src.app.database.models.site_setting import SiteSetting
from src.app.database.session import AsyncSessionFactory
from src.app.schemas.avito_bot import AvitoBotConfig

logger = get_logger(__name__)

CONFIG_KEY = "avito_bot_config"
DEBOUNCE_SECONDS = 3          # ждём, не допишет ли покупатель ещё
SIMULATED_MAX_DELAY = 2       # тренировочные диалоги — без долгих пауз
HISTORY_LIMIT = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Настройки ────────────────────────────────────────────────────────────────

async def load_config(session: AsyncSession) -> AvitoBotConfig:
    row = await session.get(SiteSetting, CONFIG_KEY)
    raw = row.value if row is not None and isinstance(row.value, dict) else {}
    try:
        cfg = AvitoBotConfig(**raw)
    except Exception:  # noqa: BLE001 — битые настройки не должны ронять бота
        logger.warning("avito_bot_config_invalid")
        cfg = AvitoBotConfig()
    if not cfg.webhook_secret:
        cfg.webhook_secret = secrets.token_urlsafe(24)
        await save_config(session, cfg)
    return cfg


async def save_config(session: AsyncSession, cfg: AvitoBotConfig) -> None:
    value = cfg.model_dump(mode="json")
    row = await session.get(SiteSetting, CONFIG_KEY)
    if row is None:
        session.add(SiteSetting(key=CONFIG_KEY, value=value))
    else:
        row.value = value
    await session.flush()


def webhook_url(cfg: AvitoBotConfig) -> str:
    return f"{settings.PUBLIC_SITE_URL.rstrip('/')}/api/avito-bot/webhook/{cfg.webhook_secret}"


def llm_settings(cfg: AvitoBotConfig) -> llm_client.LlmSettings:
    return llm_client.LlmSettings(
        provider=cfg.llm_provider, base_url=cfg.llm_base_url, model=cfg.llm_model,
        api_key=cfg.llm_api_key, folder_id=cfg.llm_folder_id, temperature=cfg.llm_temperature,
    )


def avito_creds(cfg: AvitoBotConfig) -> avito_client.AvitoCreds:
    return avito_client.AvitoCreds(cfg.avito_client_id, cfg.avito_client_secret, cfg.avito_user_id)


async def active_rules(session: AsyncSession) -> list[AvitoBotRule]:
    res = await session.execute(select(AvitoBotRule).order_by(AvitoBotRule.sort, AvitoBotRule.created_at))
    return list(res.scalars().all())


# ── Каталог ──────────────────────────────────────────────────────────────────

def _rub(value: Decimal | None) -> str:
    return f"{int(value or 0):,}".replace(",", " ") + " ₽"


async def catalog_lines(session: AsyncSession, *texts: str | None, limit: int = 6) -> list[str]:
    """Товары каталога, похожие на объявление и вопрос: цена и наличие — живые."""
    tokens = catalog_tokens(*texts)
    if not tokens:
        return []
    conds = [Product.name.ilike(f"%{t}%") for t in tokens]
    res = await session.execute(
        select(Product).where(Product.is_active.is_(True), or_(*conds)).limit(300)
    )
    scored: list[tuple[int, Product]] = []
    for p in res.scalars().all():
        name = p.name.lower().replace("ё", "е")
        score = sum(1 for t in tokens if t in name)
        scored.append((score, p))
    if not scored:
        return []
    best = max(s for s, _ in scored)
    need = max(1, best - 1) if best >= 2 else 1
    picked = sorted((x for x in scored if x[0] >= need), key=lambda x: (-x[0], x[1].stock_quantity <= 0, x[1].price))[:limit]
    lines = []
    for _, p in picked:
        price = p.discount_price or p.price
        if p.is_preorder:
            stock = "предзаказ" + (f" ({p.preorder_note})" if p.preorder_note else "")
        elif p.stock_quantity > 0:
            stock = f"в наличии {p.stock_quantity} шт."
        else:
            stock = "нет в наличии"
        old = f" (без скидки {_rub(p.price)})" if p.discount_price and p.discount_price < p.price else ""
        cond = ", б/у" if p.condition == "used" else ""
        lines.append(f"• {p.name}{cond} — {_rub(price)}{old}, {stock}")
    return lines


# ── Решение ──────────────────────────────────────────────────────────────────

@dataclass
class Decision:
    action: str                     # reply | handoff | silent
    text: str | None = None
    source: str | None = None       # rule | llm
    rule: AvitoBotRule | None = None
    reason: str | None = None
    delay_seconds: int = 0
    catalog: list[str] = field(default_factory=list)


async def decide(session: AsyncSession, cfg: AvitoBotConfig, ctx: ChatContext, pending_text: str,
                 rule_hits: dict[str, Any], now: datetime | None = None) -> Decision:
    now = now or _now()
    rules = await active_rules(session)
    llm = llm_settings(cfg)
    match = match_rule(rules, pending_text, rule_hits, now)

    if match and match.rule.verbatim and not (llm.ready and (starts_with_refusal(pending_text) or not rule_covers(pending_text))):
        return Decision("reply", match.rule.answer.strip(), "rule", match.rule, delay_seconds=match.rule.delay_seconds)

    if not llm.ready:
        if match:  # правило «своими словами», но модели нет — отдаём текст правила
            return Decision("reply", match.rule.answer.strip(), "rule", match.rule, delay_seconds=match.rule.delay_seconds)
        return Decision("handoff", cfg.handoff_message or None, reason="Нет подходящего автоответа, а модель не подключена")

    lines = await catalog_lines(session, ctx.item_title, pending_text) if cfg.use_catalog else []
    system = build_system_prompt(
        PromptConfig(cfg.persona_name, cfg.style, cfg.knowledge, cfg.handoff_topics),
        rules, ctx, lines, now, hint=match.rule.answer if match else None,
    )
    try:
        raw = await llm_client.complete(llm, build_messages(system, ctx, HISTORY_LIMIT))
    except llm_client.LlmError as exc:
        logger.warning("avito_bot_llm_failed", error=str(exc))
        return Decision("handoff", cfg.handoff_message or None, reason=f"Модель не ответила: {exc}"[:200], catalog=lines)

    verdict = parse_llm_answer(raw)
    delay = human_delay(cfg.reply_delay_min, cfg.reply_delay_max)
    rule = match.rule if match else None
    if verdict.handoff:
        return Decision("handoff", verdict.reply or cfg.handoff_message or None, "llm", rule,
                        reason=verdict.reason or "Модель просит сотрудника", delay_seconds=delay, catalog=lines)
    if not verdict.reply:
        return Decision("silent", reason="Модель решила, что отвечать не нужно", catalog=lines)
    return Decision("reply", verdict.reply, "llm", rule, delay_seconds=delay, catalog=lines)


async def chat_context(session: AsyncSession, chat: AvitoChat) -> tuple[ChatContext, str]:
    """История диалога и текст сообщений покупателя, на которые ещё нет ответа."""
    res = await session.execute(
        select(AvitoMessage)
        .where(AvitoMessage.chat_id == chat.id, AvitoMessage.status == "sent")
        .order_by(AvitoMessage.created_at.desc())
        .limit(HISTORY_LIMIT)
    )
    msgs = list(reversed(res.scalars().all()))
    pending: list[str] = []
    for m in msgs:
        if m.author == "client":
            pending.append(m.text)
        else:
            pending = []
    ctx = ChatContext(chat.item_title, chat.item_price, chat.client_name, [(m.author, m.text) for m in msgs])
    return ctx, "\n".join(pending)


# ── Очередь ответов ──────────────────────────────────────────────────────────

_GENERATION: dict[UUID, int] = {}
_TASKS: set[asyncio.Task] = set()


def schedule_reply(chat_id: UUID) -> None:
    gen = _GENERATION.get(chat_id, 0) + 1
    _GENERATION[chat_id] = gen
    task = asyncio.create_task(_reply_later(chat_id, gen))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


def _stale(chat_id: UUID, gen: int) -> bool:
    return _GENERATION.get(chat_id) != gen


async def _reply_later(chat_id: UUID, gen: int) -> None:
    try:
        async with AsyncSessionFactory() as session:
            chat = await session.get(AvitoChat, chat_id)
            if chat is None:
                return
        await asyncio.sleep(1 if chat.is_simulated else DEBOUNCE_SECONDS)
        if _stale(chat_id, gen):
            return
        async with AsyncSessionFactory() as session:
            cfg = await load_config(session)
            chat = await session.get(AvitoChat, chat_id)
            # Позвали человека — бот в этом диалоге молчит, пока сотрудник не вернёт его
            if chat is None or chat.mode != "bot" or chat.needs_human or (not cfg.enabled and not chat.is_simulated):
                await session.commit()
                return
            ctx, pending = await chat_context(session, chat)
            if not pending.strip():
                return
            decision = await decide(session, cfg, ctx, pending, dict(chat.rule_hits or {}))
            await session.commit()

        delay = min(decision.delay_seconds, SIMULATED_MAX_DELAY) if chat.is_simulated else decision.delay_seconds
        await asyncio.sleep(max(0, delay - (1 if chat.is_simulated else DEBOUNCE_SECONDS)))
        if _stale(chat_id, gen):
            return
        await apply_decision(chat_id, decision)
    except Exception as exc:  # noqa: BLE001
        logger.exception("avito_bot_reply_failed", chat_id=str(chat_id), error=str(exc))


async def apply_decision(chat_id: UUID, decision: Decision) -> None:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        chat = await session.get(AvitoChat, chat_id)
        if chat is None or chat.mode != "bot":
            return
        # Старые черновики больше не к месту — покупатель уже написал новое
        await session.execute(
            update(AvitoMessage).where(AvitoMessage.chat_id == chat.id, AvitoMessage.status == "draft")
            .values(status="discarded")
        )
        push: tuple[str, str] | None = None

        if decision.action == "handoff":
            chat.needs_human = True
            chat.human_reason = (decision.reason or "Нужен сотрудник")[:200]
            push = ("Авито: нужен менеджер", f"{chat.client_name or 'Покупатель'} · {chat.item_title or ''} · {chat.human_reason}")

        if decision.text and decision.action in ("reply", "handoff"):
            if decision.rule is not None:
                hits = dict(chat.rule_hits or {})
                hits[str(decision.rule.id)] = int(hits.get(str(decision.rule.id), 0)) + 1
                chat.rule_hits = hits
                await session.execute(update(AvitoBotRule).where(AvitoBotRule.id == decision.rule.id)
                                      .values(hits=AvitoBotRule.hits + 1))
            msg = AvitoMessage(chat_id=chat.id, author="bot", text=decision.text, source=decision.source,
                               rule_id=decision.rule.id if decision.rule else None)
            if cfg.mode == "draft" and not chat.is_simulated:
                msg.status = "draft"
                if push is None:
                    push = ("Авито: ответ ждёт проверки", f"{chat.client_name or 'Покупатель'}: {decision.text[:120]}")
            else:
                await _deliver(cfg, chat, msg)
            session.add(msg)
            if msg.status == "sent":
                _touch(chat, msg.text)

        await session.commit()

    if push:
        await send_push_to_all(push[0], push[1], url=f"/admin?tab=avito&chat={chat_id}", tag=f"avito-{chat_id}")


async def _deliver(cfg: AvitoBotConfig, chat: AvitoChat, msg: AvitoMessage) -> None:
    """Отправить сообщение в Авито; тренировочные диалоги — только в базу."""
    msg.sent_at = _now()
    if chat.is_simulated:
        msg.status = "sent"
        return
    try:
        resp = await avito_client.send_text(avito_creds(cfg), chat.avito_chat_id, msg.text)
        msg.avito_message_id = str(resp.get("id")) if resp.get("id") else None
        msg.status = "sent"
    except avito_client.AvitoError as exc:
        msg.status = "failed"
        msg.error = str(exc)[:300]
        chat.needs_human = True
        chat.human_reason = "Не удалось отправить ответ в Авито"


def _touch(chat: AvitoChat, text: str) -> None:
    chat.last_message_text = text[:300]
    chat.last_message_at = _now()


# ── Входящие ─────────────────────────────────────────────────────────────────

async def handle_webhook(payload: dict[str, Any]) -> None:
    value = ((payload or {}).get("payload") or {}).get("value") or {}
    if ((payload or {}).get("payload") or {}).get("type") not in (None, "message") or not value.get("chat_id"):
        return
    msg_type = value.get("type") or "text"
    if msg_type == "system":
        return
    content = value.get("content") or {}
    text = (content.get("text") or "").strip()
    if msg_type != "text" or not text:
        text = {"image": "[фото]", "voice": "[голосовое сообщение]", "link": content.get("link", {}).get("url", "[ссылка]"),
                "item": "[объявление]", "location": "[геолокация]"}.get(msg_type, f"[{msg_type}]")
    await handle_incoming(
        avito_chat_id=str(value["chat_id"]),
        avito_message_id=str(value.get("id") or "") or None,
        author_id=value.get("author_id"),
        text=text,
    )


async def handle_incoming(avito_chat_id: str, avito_message_id: str | None, author_id: int | None, text: str) -> None:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        if avito_message_id:
            exists = await session.execute(select(AvitoMessage.id).where(AvitoMessage.avito_message_id == avito_message_id))
            if exists.first():
                return
        chat = (await session.execute(select(AvitoChat).where(AvitoChat.avito_chat_id == avito_chat_id))).scalar_one_or_none()
        if chat is None:
            chat = AvitoChat(id=uuid4(), avito_chat_id=avito_chat_id)
            try:
                meta = avito_client.chat_meta(await avito_client.get_chat(avito_creds(cfg), avito_chat_id), cfg.avito_user_id)
                for k, v in meta.items():
                    setattr(chat, k, v)
            except avito_client.AvitoError as exc:
                logger.warning("avito_chat_meta_failed", chat=avito_chat_id, error=str(exc))
            session.add(chat)
            await session.flush()

        own = cfg.avito_user_id is not None and author_id == cfg.avito_user_id
        if own:
            # Эхо нашего же ответа (id ещё не успели записать) — просто привязываем id
            echo = (await session.execute(
                select(AvitoMessage).where(
                    AvitoMessage.chat_id == chat.id, AvitoMessage.author.in_(("bot", "staff")),
                    AvitoMessage.status == "sent", AvitoMessage.avito_message_id.is_(None), AvitoMessage.text == text,
                ).order_by(AvitoMessage.created_at.desc()).limit(1)
            )).scalar_one_or_none()
            if echo is not None:
                echo.avito_message_id = avito_message_id
                await session.commit()
                return
            # Сотрудник ответил прямо из приложения Авито — диалог ведёт человек
            session.add(AvitoMessage(chat_id=chat.id, avito_message_id=avito_message_id, author="staff",
                                     text=text, source="avito", sent_at=_now()))
            chat.mode = "human"
            chat.needs_human = False
            _touch(chat, text)
            await session.commit()
            return

        session.add(AvitoMessage(chat_id=chat.id, avito_message_id=avito_message_id, author="client", text=text, sent_at=_now()))
        _touch(chat, text)
        chat_id, should_reply = chat.id, chat.mode == "bot" and not chat.needs_human and cfg.enabled
        await session.commit()

    if should_reply:
        schedule_reply(chat_id)


async def simulate(text: str, chat_id: UUID | None, client_name: str, item_title: str | None, item_price: str | None) -> UUID:
    """Тренировочный диалог в админке: всё как в жизни, но в Авито ничего не уходит."""
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id) if chat_id else None
        if chat is None or not chat.is_simulated:
            chat = AvitoChat(id=uuid4(), avito_chat_id=f"sim-{uuid4().hex[:12]}", is_simulated=True,
                             client_name=client_name, item_title=item_title, item_price=item_price)
            session.add(chat)
            await session.flush()
        session.add(AvitoMessage(chat_id=chat.id, author="client", text=text, sent_at=_now()))
        _touch(chat, text)
        cid = chat.id
        await session.commit()
    schedule_reply(cid)
    return cid


# ── Действия сотрудника ──────────────────────────────────────────────────────

class ActionError(Exception):
    pass


async def staff_send(chat_id: UUID, text: str) -> None:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        chat = await session.get(AvitoChat, chat_id)
        if chat is None:
            raise ActionError("Диалог не найден")
        await session.execute(update(AvitoMessage).where(AvitoMessage.chat_id == chat.id, AvitoMessage.status == "draft")
                              .values(status="discarded"))
        msg = AvitoMessage(chat_id=chat.id, author="staff", text=text, source="staff")
        await _deliver(cfg, chat, msg)
        session.add(msg)
        if msg.status != "sent":
            await session.commit()
            raise ActionError(msg.error or "Не удалось отправить")
        chat.mode = "human"
        chat.needs_human = False
        chat.human_reason = None
        _touch(chat, text)
        await session.commit()


async def approve_draft(message_id: UUID, text: str | None) -> None:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        msg = await session.get(AvitoMessage, message_id)
        if msg is None or msg.status != "draft":
            raise ActionError("Черновик уже отправлен или устарел")
        chat = await session.get(AvitoChat, msg.chat_id)
        if text and text.strip() != msg.text:
            msg.text = text.strip()
            msg.source = "staff"
        await _deliver(cfg, chat, msg)
        if msg.status != "sent":
            error = msg.error or "Не удалось отправить"
            msg.status = "draft"  # остаётся черновиком — можно отправить ещё раз
            msg.sent_at = None
            await session.commit()
            raise ActionError(error)
        msg.error = None
        msg.created_at = _now()
        _touch(chat, msg.text)
        await session.commit()


async def discard_draft(message_id: UUID) -> None:
    async with AsyncSessionFactory() as session:
        msg = await session.get(AvitoMessage, message_id)
        if msg is None or msg.status != "draft":
            raise ActionError("Черновик уже отправлен или устарел")
        msg.status = "discarded"
        await session.commit()


async def set_mode(chat_id: UUID, mode: str) -> None:
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id)
        if chat is None:
            raise ActionError("Диалог не найден")
        chat.mode = mode
        chat.needs_human = False
        chat.human_reason = None
        await session.commit()


async def chat_counts(session: AsyncSession) -> tuple[int, int, int]:
    total = (await session.execute(select(func.count(AvitoChat.id)))).scalar_one()
    human = (await session.execute(select(func.count(AvitoChat.id)).where(AvitoChat.needs_human.is_(True)))).scalar_one()
    drafts = (await session.execute(select(func.count(func.distinct(AvitoMessage.chat_id))).where(AvitoMessage.status == "draft"))).scalar_one()
    return total, human, drafts


async def draft_chat_ids(session: AsyncSession) -> set[UUID]:
    res = await session.execute(select(AvitoMessage.chat_id).where(AvitoMessage.status == "draft").distinct())
    return set(res.scalars().all())


__all__ = [
    "CONFIG_KEY", "ActionError", "Decision", "active_rules", "approve_draft", "avito_creds", "chat_counts",
    "chat_context", "decide", "discard_draft", "draft_chat_ids", "handle_webhook", "llm_settings",
    "load_config", "save_config", "set_mode", "simulate", "staff_send", "webhook_url",
]
