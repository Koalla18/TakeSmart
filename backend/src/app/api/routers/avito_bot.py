"""
Авито-бот: /avito-bot/*

  /avito-bot/settings, /status, /connect   — настройки, ключи, подключение Авито (webhook)
  /avito-bot/rules, /rules/import          — автоответы
  /avito-bot/chats, /chats/{id}/…          — диалоги, черновики, «взять диалог»
  /avito-bot/messages/{id}/approve|discard — черновики
  /avito-bot/test, /simulate               — тестовый чат без Авито
  /avito-bot/webhook/{secret}              — сюда Авито шлёт новые сообщения (публично, по секрету в адресе)
"""
from __future__ import annotations

import hmac
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import delete, func, or_, select

from src.app.api.admin.endpoints import get_current_admin
from src.app.core import avito_bot_service as bot
from src.app.core import avito_bot_analytics, avito_catalog, avito_client, avito_price_update, llm_client
from src.app.core.avito_bot_engine import ChatContext, parse_price_list, position_key, render_template
from src.app.core.logger import get_logger
from src.app.database.models.admin import Admin
from src.app.database.models.avito_bot import (
    AvitoBotExample, AvitoBotRule, AvitoBroadcast, AvitoBroadcastRecipient, AvitoChat, AvitoItemLink, AvitoMessage,
)
from src.app.database.models.product import Product
from src.app.database.session import AsyncSessionFactory
from src.app.schemas.avito_bot import (
    PRICE_LIMIT,
    SECRET_FIELDS, ApproveIn, AudienceChatOut, AudienceOut, AvitoAnalyticsOut, AvitoBotConfigIn, BroadcastCreate,
    BroadcastDetailOut, BroadcastOut, BroadcastPreviewIn, BroadcastRecipientOut, OptOutIn, AvitoBotConfigOut, ChatDetailOut, ChatOut, ChatsOut, ConnectOut,
    DecisionOut, ExampleOut, ExamplePatch, HealthOut, LearningOut, LinkedProductOut, LinkIn, MessageOut, RuleIn,
    RuleOut, RulePatch, RulesImportIn, RulesImportOut, SendIn, SimulateIn, StatusOut, TestIn, TestMessage, UnansweredOut,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/avito-bot", tags=["Авито-бот"])
ADMIN = [Depends(get_current_admin)]


def _config_out(cfg) -> AvitoBotConfigOut:
    data = cfg.model_dump()
    for f in SECRET_FIELDS:
        data.pop(f, None)
    data["allowed_listing_ids"] = [str(item_id) for item_id in cfg.allowed_listing_ids]
    return AvitoBotConfigOut(
        **{k: v for k, v in data.items() if k in AvitoBotConfigOut.model_fields},
        price_list_can_undo=bool(cfg.price_list_prev),
        llm_api_key_set=bool(cfg.llm_api_key),
        avito_client_secret_set=bool(cfg.avito_client_secret),
        webhook_url=bot.webhook_url(cfg) if cfg.avito_connected_at else None,
    )


def _remember_price_list(cfg) -> None:
    """Перед изменением прайса сохраняем прежний — его можно вернуть кнопкой."""
    cfg.price_list_prev = cfg.price_list
    cfg.price_list_updated_at = datetime.now(timezone.utc)


# ── Настройки ────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=AvitoBotConfigOut, dependencies=ADMIN)
async def get_settings() -> AvitoBotConfigOut:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        await session.commit()
    return _config_out(cfg)


@router.put("/settings", response_model=AvitoBotConfigOut, dependencies=ADMIN)
async def put_settings(body: AvitoBotConfigIn) -> AvitoBotConfigOut:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session, lock=True)
        data = body.model_dump(exclude_unset=True)
        if data.get("price_list") is not None and data["price_list"] != cfg.price_list:
            _, errors = avito_catalog.prepare(data["price_list"])
            if errors:
                raise HTTPException(status_code=422, detail=errors[0])
            _remember_price_list(cfg)
        for key in ("listing_scope", "allowed_listing_ids", "collect_messages_seconds"):
            if key in data and data[key] is None:
                raise HTTPException(status_code=422, detail=f"Поле {key} обязательно при изменении")
        if "allowed_listing_ids" in data:
            ids = data["allowed_listing_ids"]
            if any(not 0 < item_id < 2**63 for item_id in ids):
                raise HTTPException(status_code=422, detail="Некорректный ID объявления")
            data["allowed_listing_ids"] = list(dict.fromkeys(ids))
        avito_account_changed = (
            data.get("avito_client_id", cfg.avito_client_id) != cfg.avito_client_id
            or bool(data.get("avito_client_secret"))
        )
        for key, value in data.items():
            if key in SECRET_FIELDS:
                if value == "":
                    continue          # пустое поле — «не менять»
                value = value or ""   # null — стереть
            setattr(cfg, key, value)
        if cfg.reply_delay_min > cfg.reply_delay_max:
            cfg.reply_delay_max = cfg.reply_delay_min
        if avito_account_changed:
            cfg.avito_user_id = None
            cfg.avito_connected_at = None
        await bot.save_config(session, cfg)
        await session.commit()
    logger.info("avito_bot_settings_saved", fields=sorted(k for k in data if k not in SECRET_FIELDS))
    return _config_out(cfg)


@router.get("/listings", dependencies=ADMIN, summary="Активные объявления подключённого аккаунта")
async def list_listings(page: int = Query(1, ge=1), source: str = Query("avito", pattern="^(avito|chats)$")) -> dict:
    per_page = 50
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        if source == "chats":
            statement = select(AvitoChat.item_id, AvitoChat.item_title, AvitoChat.item_url).where(
                AvitoChat.item_id.is_not(None), AvitoChat.is_simulated.is_(False)
            ).distinct(AvitoChat.item_id).order_by(AvitoChat.item_id, AvitoChat.last_message_at.desc().nulls_last())
            rows = (await session.execute(statement.offset((page - 1) * per_page).limit(per_page))).all()
            resources = [{"id": row.item_id, "title": row.item_title, "url": row.item_url} for row in rows]
        else:
            try:
                resources = await avito_client.list_items(bot.avito_creds(cfg), page, per_page)
            except avito_client.AvitoError as exc:
                raise HTTPException(status_code=502, detail="Авито не вернул список объявлений. Проверьте доступ API или выберите «Из диалогов».") from exc
    items = [{"id": str(item["id"]), "title": item.get("title") or f"Объявление {item['id']}",
              "url": item.get("url"), "status": item.get("status")} for item in resources
             if str(item.get("id", "")).isdigit()]
    return {"items": items, "next_page": page + 1 if len(resources) == per_page else None}


@router.get("/status", response_model=StatusOut, dependencies=ADMIN)
async def get_status() -> StatusOut:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        health = await bot.load_health(session)
        replies, sends = await bot.queue_sizes(session)
        await session.commit()
    known = {k: v for k, v in health.items() if k in HealthOut.model_fields}
    return StatusOut(
        enabled=cfg.enabled, mode=cfg.mode, llm_ready=bot.llm_settings(cfg).ready,
        avito_ready=bot.avito_creds(cfg).ready, avito_connected=bool(cfg.avito_connected_at),
        webhook_url=bot.webhook_url(cfg) if cfg.avito_connected_at else None,
        health=HealthOut(**known, queue_replies=replies, queue_sends=sends),
    )


@router.post("/connect", response_model=ConnectOut, dependencies=ADMIN,
             summary="Проверить ключи Авито и подписаться на новые сообщения")
async def connect() -> ConnectOut:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        await session.commit()
    creds = bot.avito_creds(cfg)
    url = bot.webhook_url(cfg)
    try:
        me = await avito_client.get_self(creds)
        user_id = int(me["id"])
        creds.user_id = user_id
        await avito_client.subscribe_webhook(creds, url)
    except (avito_client.AvitoError, KeyError, ValueError, TypeError) as exc:
        return ConnectOut(ok=False, user_id=cfg.avito_user_id, webhook_url=url, detail=str(exc)[:300])
    async with AsyncSessionFactory() as session:
        current = await bot.load_config(session, lock=True)
        if (current.avito_client_id, current.avito_client_secret, current.webhook_secret) != (
            cfg.avito_client_id, cfg.avito_client_secret, cfg.webhook_secret
        ):
            return ConnectOut(ok=False, user_id=current.avito_user_id, webhook_url=bot.webhook_url(current),
                              detail="Настройки Авито изменились во время подключения. Повторите подключение.")
        current.avito_user_id = user_id
        current.avito_connected_at = datetime.now(timezone.utc)
        await bot.save_config(session, current)
        await session.commit()
    logger.info("avito_bot_connected", user_id=user_id)
    return ConnectOut(ok=True, user_id=user_id, webhook_url=url, detail="Авито подключён: новые сообщения будут приходить боту")


@router.post("/llm-check", response_model=DecisionOut, dependencies=ADMIN, summary="Проверить, что модель отвечает")
async def llm_check() -> DecisionOut:
    """Прямой вопрос модели, мимо автоответов: иначе на проверку мог ответить автоответ."""
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        await session.commit()
    if not bot.llm_settings(cfg).ready:
        return DecisionOut(action="handoff", text=None, source=None, rule_id=None, delay_seconds=0,
                           reason="Модель не настроена: проверьте ключ и обязательные поля")
    try:
        text_ = await bot.llm_call(cfg, [
            {"role": "system", "content": "Ты помощник магазина. Ответь одним коротким предложением по-русски."},
            {"role": "user", "content": "Поздоровайся с покупателем и спроси, чем помочь."},
        ])
    except llm_client.LlmError as exc:
        return DecisionOut(action="handoff", text=None, source=None, rule_id=None, delay_seconds=0, reason=str(exc)[:300])
    return DecisionOut(action="reply", text=text_.strip()[:500], source="llm", rule_id=None, reason=None, delay_seconds=0)


# ── Правила ──────────────────────────────────────────────────────────────────

@router.get("/rules", response_model=list[RuleOut], dependencies=ADMIN)
async def list_rules() -> list[RuleOut]:
    async with AsyncSessionFactory() as session:
        return [RuleOut.model_validate(r) for r in await bot.active_rules(session)]


@router.post("/rules", response_model=RuleOut, status_code=status.HTTP_201_CREATED, dependencies=ADMIN)
async def create_rule(body: RuleIn) -> RuleOut:
    async with AsyncSessionFactory() as session:
        rule = AvitoBotRule(**body.model_dump())
        session.add(rule)
        await session.commit()
        await session.refresh(rule)
        return RuleOut.model_validate(rule)


@router.patch("/rules/{rule_id}", response_model=RuleOut, dependencies=ADMIN)
async def patch_rule(rule_id: UUID, body: RulePatch) -> RuleOut:
    async with AsyncSessionFactory() as session:
        rule = await session.get(AvitoBotRule, rule_id)
        if rule is None:
            raise HTTPException(status_code=404, detail="Правило не найдено")
        current = RuleIn.model_validate(rule, from_attributes=True).model_dump()
        current.update(body.model_dump(exclude_unset=True))
        merged = RuleIn(**current)  # та же проверка, что и при создании
        for k, v in merged.model_dump().items():
            setattr(rule, k, v)
        await session.commit()
        await session.refresh(rule)
        return RuleOut.model_validate(rule)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def delete_rule(rule_id: UUID) -> Response:
    async with AsyncSessionFactory() as session:
        res = await session.execute(delete(AvitoBotRule).where(AvitoBotRule.id == rule_id))
        if not res.rowcount:
            raise HTTPException(status_code=404, detail="Правило не найдено")
        await session.commit()
    return Response(status_code=204)


_KEYS_PREFIX = re.compile(r"^(ключи|ключевые слова|слова|триггеры?)\s*:\s*", re.IGNORECASE)


def parse_rules_text(text: str) -> tuple[list[RuleIn], list[str]]:
    """Импорт автоответов текстом. Поддерживаются:
      • строка «ключи | ответ» (или через табуляцию / «;» — как из таблицы);
      • блоки через пустую строку: первая строка — ключи через запятую, дальше — ответ.
    """
    rules: list[RuleIn] = []
    errors: list[str] = []
    blocks = [b.strip("\n") for b in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if b.strip()]
    for n, block in enumerate(blocks, 1):
        lines = block.split("\n")
        pairs: list[tuple[str, str]] = []
        sep = next((s for s in ("\t", " | ", "|", ";") if s in lines[0]), None)
        if sep and all(sep in ln for ln in lines):
            for ln in lines:
                keys, answer = ln.split(sep, 1)
                pairs.append((keys, answer))
        elif len(lines) >= 2:
            pairs.append((lines[0], "\n".join(lines[1:])))
        else:
            errors.append(f"Блок {n}: нужен ответ после строки с ключами")
            continue
        for keys, answer in pairs:
            keys = _KEYS_PREFIX.sub("", keys.strip())
            answer = re.sub(r"^(ответ)\s*:\s*", "", answer.strip(), flags=re.IGNORECASE).strip().strip('"')
            try:
                rules.append(RuleIn(keywords=[k for k in re.split(r"[,/]", keys)], answer=answer))
            except ValueError as exc:
                errors.append(f"Блок {n}: {str(exc).splitlines()[-1][:120]}")
    return rules, errors


@router.post("/rules/import", response_model=RulesImportOut, dependencies=ADMIN)
async def import_rules(body: RulesImportIn) -> RulesImportOut:
    parsed, errors = parse_rules_text(body.text)
    created = skipped = 0
    async with AsyncSessionFactory() as session:
        if body.replace:
            await session.execute(delete(AvitoBotRule))
            existing: set[str] = set()
        else:
            existing = {",".join(sorted(k.lower() for k in r.keywords)) for r in await bot.active_rules(session)}
        base_sort = len(existing)
        for i, rule in enumerate(parsed):
            key = ",".join(sorted(k.lower() for k in rule.keywords))
            if key in existing:
                skipped += 1
                continue
            existing.add(key)
            session.add(AvitoBotRule(**{**rule.model_dump(), "sort": base_sort + i}))
            created += 1
        await session.commit()
    return RulesImportOut(created=created, skipped=skipped, errors=errors[:20])


# ── Диалоги ──────────────────────────────────────────────────────────────────

@router.get("/chats", response_model=ChatsOut, dependencies=ADMIN)
async def list_chats(filter: str = Query("all", pattern="^(all|human|draft|test)$"), limit: int = Query(100, ge=1, le=300)) -> ChatsOut:
    async with AsyncSessionFactory() as session:
        drafts = await bot.draft_chat_ids(session)
        q = select(AvitoChat).order_by(AvitoChat.last_message_at.desc().nullslast()).limit(limit)
        if filter == "human":
            q = q.where(AvitoChat.needs_human.is_(True))
        elif filter == "draft":
            q = q.where(AvitoChat.id.in_(drafts or {UUID(int=0)}))
        elif filter == "test":
            q = q.where(AvitoChat.is_simulated.is_(True))
        chats = (await session.execute(q)).scalars().all()
        total, human, n_drafts = await bot.chat_counts(session)
    out = []
    for c in chats:
        item = ChatOut.model_validate(c)
        item.has_draft = c.id in drafts
        out.append(item)
    return ChatsOut(chats=out, total=total, needs_human=human, drafts=n_drafts)


@router.get("/chats/{chat_id}", response_model=ChatDetailOut, dependencies=ADMIN)
async def get_chat(chat_id: UUID) -> ChatDetailOut:
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id)
        if chat is None:
            raise HTTPException(status_code=404, detail="Диалог не найден")
        msgs = (await session.execute(
            select(AvitoMessage).where(AvitoMessage.chat_id == chat_id, AvitoMessage.status != "discarded")
            .order_by(AvitoMessage.created_at)
        )).scalars().all()
        linked = await bot.linked_product(session, chat.item_id)
        detail = ChatDetailOut(**ChatOut.model_validate(chat).model_dump(), messages=[MessageOut.model_validate(m) for m in msgs],
                               linked_product=_product_out(linked) if linked else None)
        detail.has_draft = any(m.status == "draft" for m in msgs)
        info = await bot._order_info(session, chat)
        detail.order_status = info[1] if info else None
        return detail


def _product_out(p: Product) -> LinkedProductOut:
    return LinkedProductOut(id=p.id, name=p.name, price=float(p.discount_price or p.price),
                            stock_quantity=p.stock_quantity, is_preorder=p.is_preorder)


async def _act(coro) -> None:
    try:
        await coro
    except bot.ActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/chats/{chat_id}/send", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN,
             summary="Ответить от себя (бот в этом диалоге замолкает)")
async def chat_send(chat_id: UUID, body: SendIn) -> Response:
    await _act(bot.staff_send(chat_id, body.text.strip()))
    return Response(status_code=204)


@router.post("/chats/{chat_id}/take", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def chat_take(chat_id: UUID) -> Response:
    await _act(bot.set_mode(chat_id, "human"))
    return Response(status_code=204)


@router.post("/chats/{chat_id}/release", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN,
             summary="Вернуть диалог боту")
async def chat_release(chat_id: UUID) -> Response:
    await _act(bot.set_mode(chat_id, "bot"))
    return Response(status_code=204)


@router.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN,
               summary="Удалить тренировочный диалог")
async def chat_delete(chat_id: UUID) -> Response:
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id)
        if chat is None or not chat.is_simulated:
            raise HTTPException(status_code=409, detail="Удалять можно только тренировочные диалоги")
        await session.delete(chat)
        await session.commit()
    return Response(status_code=204)


@router.post("/messages/{message_id}/approve", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def message_approve(message_id: UUID, body: ApproveIn) -> Response:
    await _act(bot.approve_draft(message_id, body.text))
    return Response(status_code=204)


@router.post("/messages/{message_id}/discard", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def message_discard(message_id: UUID) -> Response:
    await _act(bot.discard_message(message_id))
    return Response(status_code=204)


# ── Тест ─────────────────────────────────────────────────────────────────────

# ── Рассылки ─────────────────────────────────────────────────────────────────

@router.get("/audience", response_model=AudienceOut, dependencies=ADMIN, summary="Кому можно отправить рассылку")
async def audience(
    days: int = Query(30, ge=1, le=365, description="Покупатель писал за последние N дней"),
    q: str | None = Query(None, max_length=100, description="Имя покупателя или объявление"),
    has_order: str = Query("any", pattern="^(any|yes|no)$"),
    skip_recent_days: int = Query(7, ge=0, le=90, description="Не слать тем, кто получал рассылку за N дней"),
    include_test: bool = False,
    limit: int = Query(1000, ge=1, le=5000),
) -> AudienceOut:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    conds = [AvitoChat.last_message_at >= since,
             AvitoChat.id.in_(select(AvitoMessage.chat_id).where(AvitoMessage.author == "client"))]
    if not include_test:
        conds.append(AvitoChat.is_simulated.is_(False))
    if q and q.strip():
        like = f"%{q.strip()}%"
        conds.append(or_(AvitoChat.client_name.ilike(like), AvitoChat.item_title.ilike(like)))
    if has_order == "yes":
        conds.append(AvitoChat.order_id.is_not(None))
    elif has_order == "no":
        conds.append(AvitoChat.order_id.is_(None))
    if skip_recent_days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=skip_recent_days)
        conds.append(or_(AvitoChat.last_broadcast_at.is_(None), AvitoChat.last_broadcast_at < cutoff))
    async with AsyncSessionFactory() as session:
        opted = (await session.execute(select(func.count(AvitoChat.id)).where(*conds, AvitoChat.opted_out.is_(True)))).scalar_one()
        base = select(AvitoChat).where(*conds, AvitoChat.opted_out.is_(False))
        total = (await session.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
        chats = (await session.execute(base.order_by(AvitoChat.last_message_at.desc()).limit(limit))).scalars().all()
    return AudienceOut(chats=[AudienceChatOut.model_validate(c) for c in chats], total=total, opted_out=opted)


async def _replied_chats(session, broadcast_id: UUID) -> set[UUID]:
    """Получатели, которые написали что-то после рассылки."""
    res = await session.execute(
        select(AvitoBroadcastRecipient.chat_id).where(
            AvitoBroadcastRecipient.broadcast_id == broadcast_id, AvitoBroadcastRecipient.status == "sent",
            select(AvitoMessage.id).where(
                AvitoMessage.chat_id == AvitoBroadcastRecipient.chat_id, AvitoMessage.author == "client",
                AvitoMessage.created_at > AvitoBroadcastRecipient.sent_at,
            ).exists(),
        )
    )
    return set(res.scalars().all())


@router.get("/broadcasts", response_model=list[BroadcastOut], dependencies=ADMIN)
async def list_broadcasts() -> list[BroadcastOut]:
    async with AsyncSessionFactory() as session:
        items = (await session.execute(select(AvitoBroadcast).order_by(AvitoBroadcast.created_at.desc()).limit(100))).scalars().all()
        out = []
        for b in items:
            o = BroadcastOut.model_validate(b)
            o.replied = len(await _replied_chats(session, b.id)) if b.sent else 0
            out.append(o)
    return out


@router.get("/broadcasts/{broadcast_id}", response_model=BroadcastDetailOut, dependencies=ADMIN)
async def get_broadcast(broadcast_id: UUID) -> BroadcastDetailOut:
    async with AsyncSessionFactory() as session:
        b = await session.get(AvitoBroadcast, broadcast_id)
        if b is None:
            raise HTTPException(status_code=404, detail="Рассылка не найдена")
        replied = await _replied_chats(session, b.id)
        rows = (await session.execute(
            select(AvitoBroadcastRecipient, AvitoChat.client_name, AvitoChat.item_title)
            .join(AvitoChat, AvitoChat.id == AvitoBroadcastRecipient.chat_id)
            .where(AvitoBroadcastRecipient.broadcast_id == b.id)
            .order_by(AvitoBroadcastRecipient.sent_at.desc().nullslast())
        )).all()
    detail = BroadcastDetailOut(**BroadcastOut.model_validate(b).model_dump(exclude={"replied"}), replied=len(replied), recipients=[
        BroadcastRecipientOut(chat_id=r.chat_id, client_name=name, item_title=item, status=r.status, error=r.error,
                              sent_at=r.sent_at, replied=r.chat_id in replied)
        for r, name, item in rows
    ])
    return detail


@router.post("/broadcasts", response_model=BroadcastOut, status_code=status.HTTP_201_CREATED)
async def create_broadcast(body: BroadcastCreate, admin: Admin = Depends(get_current_admin)) -> BroadcastOut:
    try:
        bid = await bot.create_broadcast(body.title, body.text, list(dict.fromkeys(body.chat_ids)), admin.username)
        if body.start:
            await bot.set_broadcast_status(bid, "start")
    except bot.ActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    async with AsyncSessionFactory() as session:
        return BroadcastOut.model_validate(await session.get(AvitoBroadcast, bid))


@router.post("/broadcasts/{broadcast_id}/{action}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def broadcast_action(broadcast_id: UUID, action: str) -> Response:
    if action not in ("start", "pause", "cancel"):
        raise HTTPException(status_code=404)
    await _act(bot.set_broadcast_status(broadcast_id, action))
    return Response(status_code=204)


@router.delete("/broadcasts/{broadcast_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def delete_broadcast(broadcast_id: UUID) -> Response:
    async with AsyncSessionFactory() as session:
        b = await session.get(AvitoBroadcast, broadcast_id)
        if b is None:
            raise HTTPException(status_code=404, detail="Рассылка не найдена")
        if b.status in ("sending", "paused"):
            raise HTTPException(status_code=409, detail="Сначала остановите рассылку")
        await session.delete(b)
        await session.commit()
    return Response(status_code=204)


@router.post("/broadcasts-preview", dependencies=ADMIN, summary="Как текст рассылки увидит конкретный покупатель")
async def broadcast_preview(body: BroadcastPreviewIn) -> dict:
    name = item = None
    if body.chat_id:
        async with AsyncSessionFactory() as session:
            chat = await session.get(AvitoChat, body.chat_id)
            if chat is not None:
                name, item = chat.client_name, chat.item_title
    return {"text": render_template(body.text, item, name)}


@router.post("/chats/{chat_id}/opt-out", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN,
             summary="Не присылать этому покупателю рассылки")
async def chat_opt_out(chat_id: UUID, body: OptOutIn) -> Response:
    await _act(bot.set_opt_out(chat_id, body.value))
    return Response(status_code=204)


# ── Аналитика ────────────────────────────────────────────────────────────────

@router.get("/analytics", response_model=AvitoAnalyticsOut, dependencies=ADMIN, summary="Аналитика бота за последние N дней")
async def analytics(days: int = Query(7, ge=1, le=90)) -> AvitoAnalyticsOut:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        out = await avito_bot_analytics.build(session, cfg, days)
        await session.commit()
    return out


# ── Обучение ─────────────────────────────────────────────────────────────────

@router.get("/learning", response_model=LearningOut, dependencies=ADMIN,
            summary="Как сотрудники поправили бота и на что он не смог ответить")
async def learning() -> LearningOut:
    async with AsyncSessionFactory() as session:
        examples = (await session.execute(
            select(AvitoBotExample).order_by(AvitoBotExample.created_at.desc()).limit(200)
        )).scalars().all()
        chats = (await session.execute(
            select(AvitoChat).where(AvitoChat.human_question.is_not(None), AvitoChat.is_simulated.is_(False))
            .order_by(AvitoChat.last_message_at.desc().nullslast()).limit(50)
        )).scalars().all()
    return LearningOut(
        examples=[ExampleOut.model_validate(e) for e in examples],
        unanswered=[UnansweredOut(chat_id=c.id, client_name=c.client_name, item_title=c.item_title,
                                  question=c.human_question or "", reason=c.human_reason, at=c.last_message_at) for c in chats],
    )


@router.patch("/examples/{example_id}", response_model=ExampleOut, dependencies=ADMIN)
async def patch_example(example_id: UUID, body: ExamplePatch) -> ExampleOut:
    async with AsyncSessionFactory() as session:
        ex = await session.get(AvitoBotExample, example_id)
        if ex is None:
            raise HTTPException(status_code=404, detail="Пример не найден")
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(ex, k, v)
        await session.commit()
        await session.refresh(ex)
        return ExampleOut.model_validate(ex)


@router.delete("/examples/{example_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def delete_example(example_id: UUID) -> Response:
    async with AsyncSessionFactory() as session:
        await session.execute(delete(AvitoBotExample).where(AvitoBotExample.id == example_id))
        await session.commit()
    return Response(status_code=204)


@router.post("/chats/{chat_id}/dismiss-question", status_code=status.HTTP_204_NO_CONTENT, response_class=Response,
             dependencies=ADMIN, summary="Убрать вопрос из «без ответа»")
async def dismiss_question(chat_id: UUID) -> Response:
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id)
        if chat is not None:
            chat.human_question = None
            await session.commit()
    return Response(status_code=204)


# ── Объявление → товар каталога ──────────────────────────────────────────────

@router.get("/products", response_model=list[LinkedProductOut], dependencies=ADMIN, summary="Поиск товара для привязки")
async def find_products(q: str = Query(..., min_length=2, max_length=200)) -> list[LinkedProductOut]:
    async with AsyncSessionFactory() as session:
        found = await bot.search_products(session, q, None, limit=12)
        if not found:  # короткий русский запрос — простым вхождением
            found = (await session.execute(
                select(Product).where(Product.is_active.is_(True), Product.name.ilike(f"%{q}%")).limit(12)
            )).scalars().all()
    return [_product_out(p) for p in found]


@router.put("/items/{item_id}/link", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def link_item(item_id: int, body: LinkIn) -> Response:
    async with AsyncSessionFactory() as session:
        if await session.get(Product, body.product_id) is None:
            raise HTTPException(status_code=404, detail="Товар не найден")
        title = (await session.execute(select(AvitoChat.item_title).where(AvitoChat.item_id == item_id).limit(1))).scalar()
        link = await session.get(AvitoItemLink, item_id)
        if link is None:
            session.add(AvitoItemLink(item_id=item_id, product_id=body.product_id, item_title=title))
        else:
            link.product_id = body.product_id
        await session.commit()
    return Response(status_code=204)


@router.delete("/items/{item_id}/link", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=ADMIN)
async def unlink_item(item_id: int) -> Response:
    async with AsyncSessionFactory() as session:
        await session.execute(delete(AvitoItemLink).where(AvitoItemLink.item_id == item_id))
        await session.commit()
    return Response(status_code=204)


@router.get("/test/listing", dependencies=ADMIN, summary="Какая розничная цена подставится в первое сообщение")
async def test_listing(title: str = Query("", max_length=300)) -> dict:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        price, source, matched = await bot.listing_price_info(session, cfg, title or None)
        await session.commit()
    return {"price": price, "source": source, "matched": matched}


@router.get("/test/listings", dependencies=ADMIN, summary="Подсказки названий объявлений для теста")
async def test_listings() -> list[str]:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        out = await bot.test_listing_suggestions(session, cfg)
        await session.commit()
    return out


@router.post("/test", response_model=DecisionOut, dependencies=ADMIN,
             summary="Тест диалога с актуальной ценой и приветствием — без сохранения")
async def test_chat(body: TestIn) -> DecisionOut:
    order_status = body.order_status
    if order_status == "pending" and bot.wants_cancel(body.text):
        order_status = "cancelled"
    if body.needs_human:
        return DecisionOut(
            action="silent", text=None, source=None, rule_id=None, delay_seconds=0,
            reason="Диалог передан менеджеру", order_status=order_status,
        )

    history = [(turn.author, turn.text) for turn in body.history if turn.text.strip()] + [("client", body.text)]
    ctx = ChatContext(body.item_title, body.item_price, None, history)
    pending: list[str] = []
    for author, message in history:
        if author == "client":
            pending.append(message)
        else:
            pending.clear()

    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        hits: dict[str, Any] = {}
        for turn in body.history:
            if turn.author == "bot" and turn.text.strip() and turn.rule_id:
                key = str(turn.rule_id)
                hits[key] = hits.get(key, 0) + 1
        item_id = body.item_id or await bot.test_item_id(session, body.item_title)
        if (body.item_id or body.item_title) and not bot.listing_allowed(cfg, item_id):
            return DecisionOut(action="silent", text=None, source=None, rule_id=None, delay_seconds=0,
                               reason="Объявление не выбрано для автоответов", order_status=order_status)
        order_info = ("ТЕСТ", order_status) if order_status else None
        decision, planned = await bot.plan_chat_reply(
            session, cfg, ctx, "\n".join(pending), hits, item_id=item_id, order_info=order_info,
        )
        await session.commit()

    messages: list[TestMessage] = []
    for plan in planned:
        rule_id = plan.decision.rule.id if plan.decision and plan.decision.rule else None
        messages.extend(TestMessage(text=part, rule_id=rule_id if i == 0 else None)
                        for i, part in enumerate(bot.planned_parts(cfg, plan)))
    first = next((plan.text for plan in planned if plan.whole), None)
    reply = next((plan.text for plan in planned if not plan.whole), None)
    if decision.cancel_order:
        order_status = "cancelled"
    elif decision.order and not order_status:
        order_status = "pending"
    return DecisionOut(first_message=first, action=decision.action, text=reply, source=decision.source,
        rule_id=decision.rule.id if decision.rule else None, reason=decision.reason,
        delay_seconds=decision.delay_seconds, catalog=decision.catalog, order=decision.order,
        examples_used=decision.examples_used, messages=messages, order_status=order_status, search=decision.search,
    )


class PriceListCheckIn(BaseModel):
    text: str = Field("", max_length=PRICE_LIMIT)


def _item_out(it) -> dict:
    a = it.attributes or {}
    brand, category, model = avito_catalog.identity(it)
    return {"name": it.name, "key": _row_key(it), "brand": brand, "category": category, "model": model,
            "attributes": avito_catalog.normalized_attrs(it), "price": it.price, "in_stock": it.stock > 0, "country": a.get("country"),
            "sim": a.get("sim"), "color_ru": a.get("color_ru"), "few": bool(a.get("few"))}


def _row_key(it) -> str:
    """Та же строка в списке базы на экране: название, страна, SIM."""
    return avito_catalog.price_hash(repr(position_key(it)))


@router.post("/price-list/check", dependencies=ADMIN, summary="Как бот прочитает прайс — без сохранения")
async def price_list_check(body: PriceListCheckIn) -> dict:
    items, _ = parse_price_list(body.text)
    _, catalog_errors = avito_catalog.prepare(body.text)
    return {"items": [_item_out(it) for it in items[:3000]], "count": len(items), "errors": catalog_errors[:50]}


class PriceUpdateIn(BaseModel):
    text: str = Field(..., max_length=PRICE_LIMIT, description="Новые цены: одно сообщение или весь прайс")
    mode: avito_price_update.Mode = "models"


class PriceApplyIn(PriceUpdateIn):
    base_hash: str = Field(..., max_length=64, description="Из предпросмотра: база не должна была измениться")
    skip: list[str] = Field(default_factory=list, max_length=5000, description="Снятые галочки")


@router.post("/price-list/preview", dependencies=ADMIN, summary="Что изменится, если применить новые цены")
async def price_list_preview(body: PriceUpdateIn) -> dict:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        await session.commit()
    diff = avito_price_update.compare(cfg.price_list, body.text, body.mode)
    _, catalog_errors = avito_catalog.prepare(body.text)
    return {
        "base_hash": avito_price_update.base_hash(cfg.price_list),
        "changes": [{"id": c.id, "kind": c.kind, "item": _item_out(c.item), "old_key": _row_key(c.old) if c.old else None,
                     "old_price": c.old.price if c.old else None, "warning": c.warning} for c in diff.changes],
        "unchanged": diff.unchanged, "new_count": diff.new_count, "base_errors": diff.base_errors,
        "errors": catalog_errors[:100], "duplicates": diff.duplicates[:100],
    }


@router.post("/price-list/apply", response_model=AvitoBotConfigOut, dependencies=ADMIN, summary="Применить изменения прайса")
async def price_list_apply(body: PriceApplyIn) -> AvitoBotConfigOut:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session, lock=True)
        if avito_price_update.base_hash(cfg.price_list) != body.base_hash:
            raise HTTPException(status_code=409, detail="Прайс уже изменили в другом окне — сравните ещё раз")
        _, errors = avito_catalog.prepare(body.text)
        if errors:
            raise HTTPException(status_code=422, detail=errors[0])
        diff = avito_price_update.compare(cfg.price_list, body.text, body.mode)
        text, applied = avito_price_update.apply_changes(cfg.price_list, diff, set(body.skip))
        if not applied:
            raise HTTPException(status_code=409, detail="Нечего применять")
        if len(text) > PRICE_LIMIT:
            raise HTTPException(status_code=422, detail="Прайс получается слишком большим")
        _remember_price_list(cfg)
        cfg.price_list = text
        await bot.save_config(session, cfg, price_source=body.text)
        await session.commit()
    logger.info("avito_bot_price_list_updated", mode=body.mode, applied=applied, skipped=len(body.skip))
    return _config_out(cfg)


@router.post("/price-list/undo", response_model=AvitoBotConfigOut, dependencies=ADMIN,
             summary="Вернуть прайс, который был до последнего изменения")
async def price_list_undo() -> AvitoBotConfigOut:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session, lock=True)
        if not cfg.price_list_prev:
            raise HTTPException(status_code=409, detail="Отменять нечего")
        cfg.price_list, cfg.price_list_prev = cfg.price_list_prev, ""
        cfg.price_list_updated_at = datetime.now(timezone.utc)
        await bot.save_config(session, cfg)
        await session.commit()
    logger.info("avito_bot_price_list_undone")
    return _config_out(cfg)


@router.post("/test-order", dependencies=ADMIN, summary="Создать тестовую заявку с Авито (видна в «Заказах» и PWA)")
async def test_order() -> dict:
    try:
        order = await bot.create_test_order()
    except bot.ActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"order_number": order.order_number}


@router.post("/simulate", response_model=ChatOut, dependencies=ADMIN,
             summary="Написать боту как покупатель (тренировочный диалог, в Авито ничего не уходит)")
async def simulate(body: SimulateIn) -> ChatOut:
    chat_id = await bot.simulate(body.text.strip(), body.chat_id, body.client_name, body.item_title, body.item_price)
    async with AsyncSessionFactory() as session:
        return ChatOut.model_validate(await session.get(AvitoChat, chat_id))


# ── Webhook ──────────────────────────────────────────────────────────────────

@router.post("/webhook/{secret}", include_in_schema=False)
async def webhook(secret: str, request: Request, background: BackgroundTasks) -> dict:
    async with AsyncSessionFactory() as session:
        cfg = await bot.load_config(session)
        await session.commit()
    if not cfg.webhook_secret or not hmac.compare_digest(secret, cfg.webhook_secret):
        raise HTTPException(status_code=404)
    try:
        payload = await request.json()
    except ValueError:
        return {"ok": True}
    # Авито ждёт быстрый 200 — разбор и ответ идут фоном
    background.add_task(bot.handle_webhook, payload)
    return {"ok": True}
