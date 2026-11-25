"""
Авито-бот: приём сообщений, решение, очередь отправки, бронь, действия сотрудников.

Поток (всё через базу — переживает перезапуск и несколько процессов):
  1. Вебхук или опрос Авито → handle_incoming сохраняет сообщение покупателя и ставит
     диалогу срок «подумать» (reply_due_at = сейчас + пара секунд). Ещё сообщение подряд —
     срок сдвигается, ответ будет один на все.
  2. Обработчик (avito_bot_worker) забирает диалоги со сроком → process_chat решает
     (avito_bot_engine) и кладёт ответ: черновик сотруднику или запланированное сообщение
     (status=scheduled, send_at — пауза «как у человека»); или зовёт человека (push).
  3. Обработчик отправляет запланированные сообщения; при ошибке повторяет, после
     SEND_RETRIES попыток зовёт человека. Если покупатель успел написать ещё —
     запланированный ответ отменяется и бот думает заново.
  4. Бронь: модель может приложить к ответу заказ — он создаётся в общей таблице заказов,
     когда сообщение реально ушло покупателю (в режиме черновиков — когда сотрудник
     нажал «Отправить»).
"""
from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.core import avito_client, llm_client
from src.app.core.avito_bot_engine import (
    MSK, ChatContext, PiiMasker, PromptConfig, build_messages, build_reminder_messages, build_system_prompt,
    human_delay, in_window, match_rule, parse_llm_answer, pick_examples, render_reminder,
    render_template, rule_covers, starts_with_refusal, wants_opt_out, is_first_reply, with_greeting,
    split_reply, typing_delay, classify_avito_message, normalize_phone, valid_email, valid_full_name,
    order_note_for_prompt, wants_cancel, CatalogItem, build_overview, catalog_vocab, query_segments, search_catalog,
    render_first_message, title_match, is_refusal, strip_greeting, sanitize_reply, parse_price_list, price_lines,
)
from src.app.core.config import settings
from src.app.core.logger import get_logger
from src.app.core.push_service import send_order_push, send_push_to_all
from src.app.database.models.avito_bot import AvitoBotEvent, AvitoBotExample, AvitoBroadcast, AvitoBroadcastRecipient, AvitoBotRule, AvitoChat, AvitoItemLink, AvitoMessage
from src.app.database.models.order import Order, OrderComment, OrderItem
from src.app.database.models.product import Product
from src.app.database.models.site_setting import SiteSetting
from src.app.database.repositories.site_setting_repository import SiteSettingRepository
from src.app.database.session import AsyncSessionFactory
from src.app.schemas.avito_bot import SECRET_FIELDS, AvitoBotConfig

logger = get_logger(__name__)

CONFIG_KEY = "avito_bot_config"
HEALTH_KEY = "avito_bot_health"
DEBOUNCE_SECONDS = 3          # ждём, не допишет ли покупатель ещё
SIM_DEBOUNCE_SECONDS = 1
SIMULATED_MAX_DELAY = 2       # тренировочные диалоги — без долгих пауз
HISTORY_LIMIT = 30
SEND_RETRIES = 3
LLM_ALERT_STREAK = 3
ALERT_EVERY = timedelta(hours=1)
POLL_WINDOW = timedelta(hours=1)   # опрос подбирает только свежие сообщения


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Шифрование секретов ──────────────────────────────────────────────────────

def _fernet() -> Fernet:
    key = hashlib.sha256(f"avito-bot:{settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(value: str) -> str:
    return "enc:" + _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt_secret(value: str) -> str:
    if not value or not value.startswith("enc:"):
        return value or ""   # старое значение открытым текстом — перешифруется при сохранении
    try:
        return _fernet().decrypt(value[4:].encode()).decode()
    except InvalidToken:
        logger.error("avito_bot_secret_undecryptable", hint="SECRET_KEY сменился — введите ключи заново")
        return ""


# ── Настройки ────────────────────────────────────────────────────────────────

async def load_config(session: AsyncSession) -> AvitoBotConfig:
    row = await session.get(SiteSetting, CONFIG_KEY)
    raw = dict(row.value) if row is not None and isinstance(row.value, dict) else {}
    for f in SECRET_FIELDS:
        raw[f] = decrypt_secret(str(raw.get(f) or ""))
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
    for f in SECRET_FIELDS:
        value[f] = encrypt_secret(value.get(f) or "")
    await SiteSettingRepository(session).set(CONFIG_KEY, value)


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


# ── Здоровье и тревоги ───────────────────────────────────────────────────────

async def load_health(session: AsyncSession) -> dict[str, Any]:
    row = await session.get(SiteSetting, HEALTH_KEY)
    return dict(row.value) if row is not None and isinstance(row.value, dict) else {}


async def update_health(**changes: Any) -> dict[str, Any]:
    """Пишет отметки здоровья отдельной транзакцией. Значение-функция получает старое значение."""
    async with AsyncSessionFactory() as session:
        health = await load_health(session)
        for k, v in changes.items():
            health[k] = v(health.get(k)) if callable(v) else v
        await SiteSettingRepository(session).set(HEALTH_KEY, health)
        await session.commit()
    return health


async def alert(kind: str, title: str, body: str) -> None:
    """Push сотрудникам, но не чаще раза в час на один вид проблемы."""
    now = _now()
    async with AsyncSessionFactory() as session:
        health = await load_health(session)
        alerts = dict(health.get("alerts") or {})
        last = alerts.get(kind)
        if last and now - datetime.fromisoformat(last) < ALERT_EVERY:
            return
        alerts[kind] = now.isoformat()
        health["alerts"] = alerts
        await SiteSettingRepository(session).set(HEALTH_KEY, health)
        await session.commit()
    logger.warning("avito_bot_alert", kind=kind, body=body)
    await send_push_to_all(title, body, url="/admin?tab=avito&view=settings", tag=f"avito-alert-{kind}")


async def record_llm_usage(result: llm_client.LlmResult | None) -> None:
    """Счётчик вызовов модели по московским дням: None — вызов с ошибкой."""
    day = _now().astimezone(MSK).date()
    async with AsyncSessionFactory() as session:
        await session.execute(text(
            "INSERT INTO avito_bot_llm_usage (day, calls, errors, prompt_tokens, completion_tokens) "
            "VALUES (:day, 1, :err, :pin, :pout) ON CONFLICT (day) DO UPDATE SET "
            "calls = avito_bot_llm_usage.calls + 1, errors = avito_bot_llm_usage.errors + :err, "
            "prompt_tokens = avito_bot_llm_usage.prompt_tokens + :pin, "
            "completion_tokens = avito_bot_llm_usage.completion_tokens + :pout"
        ), {"day": day, "err": 0 if result else 1,
            "pin": result.prompt_tokens if result else 0, "pout": result.completion_tokens if result else 0})
        await session.commit()


async def llm_call(cfg: AvitoBotConfig, messages: list[dict[str, str]]) -> str:
    """Вызов модели с учётом расхода и тревогой после нескольких ошибок подряд."""
    try:
        result = await llm_client.complete(llm_settings(cfg), messages)
    except llm_client.LlmError as exc:
        logger.warning("avito_bot_llm_failed", error=str(exc))
        await record_llm_usage(None)
        health = await update_health(llm_fail_streak=lambda v: int(v or 0) + 1, last_llm_error=str(exc)[:200])
        if health["llm_fail_streak"] >= LLM_ALERT_STREAK:
            await alert("llm", "Авито-бот: модель не отвечает", str(exc)[:150])
        raise
    await record_llm_usage(result)
    await update_health(llm_fail_streak=0)
    return result.text


def log_event(session: AsyncSession, chat_id: UUID | None, kind: str, detail: str | None = None) -> None:
    session.add(AvitoBotEvent(chat_id=chat_id, kind=kind, detail=(detail or None) and detail[:300]))


# ── Каталог ──────────────────────────────────────────────────────────────────

def _rub(value: Decimal | float | None) -> str:
    return f"{int(value or 0):,}".replace(",", " ") + " ₽"


def product_line(p: Product, linked: bool = False) -> str:
    price = p.discount_price or p.price
    if p.is_preorder:
        stock = "предзаказ" + (f" ({p.preorder_note})" if p.preorder_note else "")
    elif p.stock_quantity > 0:
        stock = f"в наличии {p.stock_quantity} шт."
    else:
        stock = "нет в наличии"
    old = f" (без скидки {_rub(p.price)})" if p.discount_price and p.discount_price < p.price else ""
    cond = ", б/у" if p.condition == "used" else ""
    mark = "(служебно: именно этот товар в объявлении покупателя) " if linked else ""
    return f"• {mark}{p.name}{cond} — {_rub(price)}{old}, {stock}"


async def linked_product(session: AsyncSession, item_id: int | None) -> Product | None:
    if not item_id:
        return None
    link = await session.get(AvitoItemLink, item_id)
    if link is None:
        return None
    product = await session.get(Product, link.product_id)
    return product if product is not None and product.is_active else None


CATALOG_TTL = 60          # секунд: каталог перечитывается не чаще раза в минуту
OVERVIEW_MAX_LINES = 250
_CATALOG: dict[str, Any] = {"at": 0.0}


async def catalog_snapshot(session: AsyncSession) -> dict[str, Any]:
    """Каталог сайта для бота: товары, словарь слов из названий и справочник для модели."""
    import time
    if time.monotonic() - _CATALOG["at"] < CATALOG_TTL:
        return _CATALOG
    from src.app.database.models.category import Category
    rows = (await session.execute(
        select(Product, Category.name).outerjoin(Category, Category.id == Product.category_id)
        .where(Product.is_active.is_(True))
    )).all()
    items: list[CatalogItem] = []
    by_key: dict[Any, Product] = {}
    for p, cat in rows:
        items.append(CatalogItem(
            name=p.name, category=cat or "Другое", price=float(p.discount_price or p.price),
            old_price=float(p.price) if p.discount_price and p.discount_price < p.price else None,
            stock=p.stock_quantity, preorder=p.is_preorder, preorder_note=p.preorder_note,
            used=p.condition == "used", attributes=p.attributes if isinstance(p.attributes, dict) else {}, key=p.id,
        ))
        by_key[p.id] = p
    _CATALOG.update(at=time.monotonic(), items=items, products=by_key, vocab=catalog_vocab(items),
                    overview=build_overview(items, OVERVIEW_MAX_LINES))
    return _CATALOG


async def search_products(session: AsyncSession, item_title: str | None, question: str | None = None,
                          limit: int = 12) -> list[Product]:
    """Товары по названию объявления и по каждому товару из вопроса отдельно."""
    snap = await catalog_snapshot(session)
    texts = ([item_title] if item_title else []) + query_segments(question or "")
    if item_title and question:
        # «16/128 белый» — уточнение к модели из объявления: ищем их вместе
        texts.append(f"{item_title} {question}")
    found = search_catalog(snap["items"], texts, snap["vocab"], limit=limit)
    return [snap["products"][it.key] for it in found if it.key in snap["products"]]


_PRICE_LIST: dict[str, Any] = {"text": None}


def price_snapshot(cfg: AvitoBotConfig) -> dict[str, Any]:
    """Прайс из настроек бота (вкладка «Прайс»): товары, словарь и справочник для модели."""
    if _PRICE_LIST["text"] != cfg.price_list:
        items, errors = parse_price_list(cfg.price_list)
        _PRICE_LIST.update(text=cfg.price_list, items=items, errors=errors, vocab=catalog_vocab(items),
                           overview=price_lines(items)[:600])
    return _PRICE_LIST


async def listing_price(session: AsyncSession, item_id: int | None, item_title: str | None,
                        cfg: AvitoBotConfig | None = None) -> str | None:
    """Розничная цена товара из объявления: привязанная карточка → прайс бота → каталог сайта
    (последние два — только при надёжном совпадении по названию)."""
    linked = await linked_product(session, item_id)
    if linked is not None:
        return _rub(linked.discount_price or linked.price)
    if cfg is not None and cfg.price_list.strip():
        prices = price_snapshot(cfg)
        hit = title_match(prices["items"], item_title, prices["vocab"])
        if hit:
            return _rub(hit.price)
    snap = await catalog_snapshot(session)
    it = title_match(snap["items"], item_title, snap["vocab"])
    return _rub(it.price) if it else None


async def first_message(session: AsyncSession, cfg: AvitoBotConfig, ctx: ChatContext,
                        item_id: int | None, greet: bool | None = None) -> tuple[str, bool] | None:
    """Шаблон первого сообщения (приветствие + розничная цена) и нашлась ли цена.
    None — шаблон выключен или сегодня с покупателем уже здоровались."""
    greet = is_first_reply(ctx) if greet is None else greet
    if not cfg.first_message.strip() or not greet:
        return None
    price = await listing_price(session, item_id, ctx.item_title, cfg) if ctx.item_title or item_id else None
    needs_price = "{price}" in cfg.first_message and bool(ctx.item_title or item_id)
    return render_first_message(cfg.first_message, cfg.persona_name, price), bool(price) or not needs_price


async def catalog_products(session: AsyncSession, item_id: int | None, item_title: str | None,
                           question: str | None, limit: int = 12) -> tuple[list[Product], Product | None]:
    """Товар, привязанный к объявлению (первым), и похожие из каталога."""
    linked = await linked_product(session, item_id)
    found = await search_products(session, item_title, question, limit)
    products = ([linked] if linked else []) + [p for p in found if not linked or p.id != linked.id]
    return products[:limit], linked


async def staff_examples(session: AsyncSession, limit: int = 300) -> list[tuple[str, str]]:
    res = await session.execute(
        select(AvitoBotExample.question, AvitoBotExample.answer)
        .where(AvitoBotExample.is_active.is_(True)).order_by(AvitoBotExample.created_at.desc()).limit(limit)
    )
    return [(q, a) for q, a in res.all()]


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
    order: dict[str, Any] | None = None
    examples_used: int = 0
    cancel_order: bool = False


def _order_payload(cfg: AvitoBotConfig, raw: dict[str, Any], products: list[Product],
                   masker: PiiMasker) -> tuple[dict | None, str | None, list[str]]:
    """Проверяет бронь от модели. Возвращает (payload, причина отказа, каких контактов не хватает)."""
    name = " ".join(masker.unmask(str(raw.get("name") or "")).split())[:120]
    phone = normalize_phone(masker.unmask(str(raw.get("phone") or "")))
    email = masker.unmask(str(raw.get("email") or "")).strip()[:255]
    missing = [label for label, ok in (("ФИО", valid_full_name(name)), ("номер телефона", phone is not None)) if not ok]
    if missing:
        return None, None, missing
    payload, problem = _order_item(cfg, raw, products, masker)
    if payload is not None:
        payload.update(name=name, phone=phone, email=email if valid_email(email) else "")
    return payload, problem, []


def _order_item(cfg: AvitoBotConfig, raw: dict[str, Any], products: list[Product], masker: PiiMasker) -> tuple[dict | None, str | None]:
    try:
        idx = int(raw.get("item")) - 1
    except (TypeError, ValueError):
        return None, "Модель пыталась оформить бронь, но не указала товар"
    if not 0 <= idx < len(products):
        return None, "Модель пыталась оформить бронь на товар не из списка"
    p = products[idx]
    if not p.is_preorder and p.stock_quantity <= 0:
        return None, f"Бронь не оформлена: «{p.name}» нет в наличии"
    method = "delivery" if str(raw.get("method")).lower() == "delivery" else "pickup"
    address = masker.unmask(str(raw.get("address") or "").strip())[:300]
    if method == "delivery" and len(address) < 5:
        return None, "Бронь с доставкой без адреса"
    return {
        "product_id": str(p.id),
        "product_name": p.name,
        "price": float(p.discount_price or p.price),
        "method": method,
        "address": address or cfg.pickup_address,
        "comment": masker.unmask(str(raw.get("comment") or "").strip())[:300],
    }, None


async def decide(session: AsyncSession, cfg: AvitoBotConfig, ctx: ChatContext, pending_text: str,
                 rule_hits: dict[str, Any], now: datetime | None = None, item_id: int | None = None,
                 order_info: tuple[str, str] | None = None, first_sent: bool = False,
                 first_price_known: bool = True, greet: bool | None = None) -> Decision:
    """order_info — (номер, статус) заявки этого диалога: модель знает о ней и может её отменить."""
    now = now or _now()
    rules = await active_rules(session)
    llm = llm_settings(cfg)
    match = match_rule(rules, pending_text, rule_hits, now)

    greet = is_first_reply(ctx) if greet is None else greet
    # Отказ — по последнему сообщению: «не интересует», а потом «где вы находитесь?» — это уже вопрос
    refusal = is_refusal(pending_text.strip().split("\n")[-1])
    if refusal:
        match = None  # «Спасибо, не интересует» — не повод для автоответа «Желаете оформить доставку?»
    if match and first_sent and "доплат" in match.rule.answer.lower():
        match = None  # автоответ повторил бы шаблон про trade-in и цену

    def rule_text(rule: AvitoBotRule) -> str:
        # Первый ответ дня — с приветствием, даже если это готовый автоответ; иначе приветствие вырезаем
        text_ = rule.answer.strip()
        if not greet or first_sent:
            return strip_greeting(text_) or text_
        # В человечном режиме приветствие уходит отдельным коротким сообщением
        return with_greeting(text_, cfg.greeting, cfg.persona_name, "\n\n" if cfg.human_mode else "\n")

    cancelling = bool(order_info) and wants_cancel(pending_text)
    if cancelling:
        match = None  # отмену не перебивает автоответ — отвечает модель (или короткое подтверждение)
        if not llm.ready:
            return Decision("reply", "Заявку отменила. Если передумаете — пишите, с радостью помогу.", "rule")
    if match and match.rule.verbatim and not (llm.ready and not rule_covers(pending_text)):
        return Decision("reply", rule_text(match.rule), "rule", match.rule, delay_seconds=match.rule.delay_seconds)

    if not llm.ready:
        if refusal:
            return Decision("silent", reason="Покупатель отказался")
        if first_sent and not first_price_known:
            return Decision("handoff", reason="Нет розничной цены для объявления — привяжите объявление к товару каталога")
        if first_sent:
            return Decision("silent", reason="Шаблон с ценой уже отправлен, модели нет")
        if match:  # правило «своими словами», но модели нет — отдаём текст правила
            return Decision("reply", rule_text(match.rule), "rule", match.rule, delay_seconds=match.rule.delay_seconds)
        return Decision("handoff", cfg.handoff_message or None, reason="Нет подходящего автоответа, а модель не подключена")

    products: list[Product] = []
    if cfg.use_catalog:
        products, linked = await catalog_products(session, item_id, ctx.item_title, pending_text)
        lines = [product_line(p, linked is not None and p.id == linked.id) for p in products]
    else:
        lines = []
    examples = pick_examples(pending_text, await staff_examples(session))

    # Модель не видит телефонов, карт и почты — только метки
    masker = PiiMasker()
    masked_ctx = ChatContext(ctx.item_title, ctx.item_price, ctx.client_name, [(a, masker.mask(t)) for a, t in ctx.history])
    system = build_system_prompt(
        PromptConfig(cfg.persona_name, cfg.style, cfg.knowledge, cfg.handoff_topics, cfg.greeting,
                     cfg.human_mode, cfg.allow_emoji),
        rules, masked_ctx, lines, now, hint=match.rule.answer if match else None,
        examples=[(masker.mask(q), a) for q, a in examples],
        orders_enabled=cfg.orders_enabled, pickup_address=cfg.pickup_address,
        order_note=order_note_for_prompt(*order_info) if order_info else None,
        catalog_overview=(await catalog_snapshot(session))["overview"] if cfg.use_catalog else (),
        first_sent=first_sent, first_price_known=first_price_known, greet=greet,
        price_overview=price_snapshot(cfg)["overview"] if cfg.price_list.strip() else (),
        trade_in=cfg.trade_in_prices,
    )
    try:
        raw = await llm_call(cfg, build_messages(system, masked_ctx, HISTORY_LIMIT))
    except llm_client.LlmError as exc:
        return Decision("handoff", cfg.handoff_message or None, reason=f"Модель не ответила: {exc}"[:200], catalog=lines)

    verdict = parse_llm_answer(raw)
    reply = masker.unmask(verdict.reply)
    if reply and (not greet or first_sent):
        reply = strip_greeting(reply)   # сегодня уже здоровались — второй раз не надо
    reply, replaced = sanitize_reply(reply)
    if replaced:
        logger.warning("avito_bot_reply_replaced", reason="off_topic_or_too_long")
        verdict.order = None
    first_part = (split_reply(reply) or [reply])[0] if cfg.human_mode else reply
    delay = (typing_delay(first_part, cfg.reply_delay_min, cfg.reply_delay_max) if cfg.human_mode
             else human_delay(cfg.reply_delay_min, cfg.reply_delay_max))
    rule = match.rule if match else None
    order, order_problem, missing = (None, None, [])
    if verdict.order and cfg.orders_enabled:
        order, order_problem, missing = _order_payload(cfg, verdict.order, products, masker)
    if missing:
        # Модель поспешила с заявкой: без ФИО и телефона не оформляем и не говорим «забронировала»
        has_email = bool(str(verdict.order.get("email") or "").strip())
        ask = ("Отлично, оформлю заявку! Напишите, пожалуйста, " + " и ".join(missing)
               + ("" if has_email else ". Почту — по желанию") + ".")
        return Decision("reply", ask, "llm", rule, delay_seconds=delay, catalog=lines, examples_used=len(examples))
    if verdict.handoff or order_problem:
        decision = Decision("handoff", reply or cfg.handoff_message or None, "llm", rule,
                            reason=order_problem or verdict.reason or "Модель просит сотрудника", delay_seconds=delay,
                            catalog=lines, examples_used=len(examples))
    elif not reply:
        decision = Decision("silent", reason="Модель решила, что отвечать не нужно", catalog=lines, examples_used=len(examples))
    else:
        decision = Decision("reply", reply, "llm", rule, delay_seconds=delay, catalog=lines, order=order,
                            examples_used=len(examples))
    decision.cancel_order = bool(verdict.cancel_order and order_info and order_info[1] in CANCELABLE)
    return decision


@dataclass
class ChatState:
    ctx: ChatContext
    pending: str
    last_client_id: UUID | None
    bot_draft: str | None


async def chat_state(session: AsyncSession, chat: AvitoChat) -> ChatState:
    """История диалога и сообщения покупателя, на которые ещё нет ответа."""
    res = await session.execute(
        select(AvitoMessage)
        .where(AvitoMessage.chat_id == chat.id, AvitoMessage.status.in_(("sent", "draft")))
        .order_by(AvitoMessage.created_at.desc())
        .limit(HISTORY_LIMIT)
    )
    msgs = list(reversed(res.scalars().all()))
    pending: list[str] = []
    last_client: UUID | None = None
    draft: str | None = None
    msgs = [m for m in msgs if m.author != "system"]  # системные сообщения Авито не часть разговора
    for m in msgs:
        if m.status == "draft":
            draft = m.text
            continue
        if m.author == "client":
            pending.append(m.text)
            last_client = m.id
        else:
            pending = []
    sent = [(m.author, m.text) for m in msgs if m.status == "sent"]
    return ChatState(ChatContext(chat.item_title, chat.item_price, chat.client_name, sent), "\n".join(pending), last_client, draft)


async def _cancel_pending_bot(session: AsyncSession, chat_id: UUID) -> None:
    """Неотправленные ответы бота больше не к месту — покупатель написал новое или ответил человек."""
    await session.execute(
        update(AvitoMessage).where(AvitoMessage.chat_id == chat_id, AvitoMessage.status.in_(("draft", "scheduled")))
        .values(status="discarded")
    )


# ── Обработка диалога (вызывает avito_bot_worker) ────────────────────────────

async def process_chat(chat_id: UUID) -> None:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        chat = await session.get(AvitoChat, chat_id)
        # Позвали человека — бот в этом диалоге молчит, пока сотрудник не вернёт его
        if chat is None or chat.mode != "bot" or chat.needs_human or (not cfg.enabled and not chat.is_simulated):
            await session.commit()
            return
        state = await chat_state(session, chat)
        if not state.pending.strip():
            await session.commit()
            return
        if cfg.human_mode and not chat.is_simulated and cfg.avito_connected_at:
            # Как человек: сначала «прочитано», потом печатает ответ
            await avito_client.mark_read(avito_creds(cfg), chat.avito_chat_id)
        order_info = await _order_info(session, chat)
        # Начало диалога: сначала шаблон магазина с розничной ценой, потом — ответ на сам вопрос
        greet = not await _greeted_recently(session, chat)
        first = await first_message(session, cfg, state.ctx, chat.item_id, greet=greet)
        opening, price_known = first if first else (None, True)
        ctx = state.ctx
        if opening:
            ctx = ChatContext(ctx.item_title, ctx.item_price, ctx.client_name, ctx.history + [("bot", opening)])
        decision = await decide(session, cfg, ctx, state.pending, dict(chat.rule_hits or {}), item_id=chat.item_id,
                                order_info=order_info, first_sent=bool(opening), first_price_known=price_known,
                                greet=greet)
        await session.commit()

    push: tuple[str, str] | None = None
    extra_pushes: list[tuple[str, str]] = []
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id, with_for_update=True)
        if chat is None or chat.mode != "bot" or chat.needs_human:
            return
        # Пока думали, покупатель дописал — новый срок уже стоит, ответим на всё сразу
        if (await chat_state(session, chat)).last_client_id != state.last_client_id:
            return
        await _cancel_pending_bot(session, chat.id)

        if decision.cancel_order:
            cancel_push = await cancel_chat_order(session, chat, state.pending)
            if cancel_push:
                extra_pushes.append(cancel_push)

        if decision.action == "handoff":
            chat.needs_human = True
            chat.human_reason = (decision.reason or "Нужен сотрудник")[:200]
            chat.human_question = state.pending[:500]
            if not chat.is_simulated:
                log_event(session, chat.id, "handoff", chat.human_reason)
            push = ("Авито: нужен менеджер", f"{chat.client_name or 'Покупатель'} · {chat.item_title or ''} · {chat.human_reason}")

        planned: list[tuple[str, str | None, Decision | None]] = []   # (текст, источник, решение)
        if opening:
            planned.append((opening, "rule", None))
        if decision.text and decision.action in ("reply", "handoff"):
            planned.append((decision.text, decision.source, decision))
        send_at = None
        base_time = _now()
        debounce = SIM_DEBOUNCE_SECONDS if chat.is_simulated else DEBOUNCE_SECONDS
        for n, (text_, source, dec) in enumerate(planned):
            rule_id = dec.rule.id if dec and dec.rule else None
            order = dec.order if dec else None
            item_base = base_time + timedelta(milliseconds=100 * n)   # порядок: шаблон раньше ответа
            if cfg.mode == "draft" and not chat.is_simulated:
                # Черновик — одним сообщением; ответ модели разделится на части при отправке
                session.add(AvitoMessage(chat_id=chat.id, author="bot", text=text_, source=source, rule_id=rule_id,
                                         order_payload=order, status="draft", created_at=item_base))
                if push is None:
                    title = "Авито: бронь ждёт подтверждения" if order else "Авито: ответ ждёт проверки"
                    push = (title, f"{chat.client_name or 'Покупатель'}: {text_[:120]}")
                continue
            # Пауза «печати»: первое сообщение — после паузы решения, следующее — после набора своего текста
            if send_at is None:
                own_delay = dec.delay_seconds if dec else typing_delay(text_, cfg.reply_delay_min, cfg.reply_delay_max)
                delay = min(own_delay, SIMULATED_MAX_DELAY) if chat.is_simulated else own_delay
                send_at = _now() + timedelta(seconds=max(0, delay - debounce))
            else:
                send_at += timedelta(seconds=_next_part_delay(cfg, text_, chat.is_simulated))
            parts = _parts(cfg, text_, source)
            for i, part in enumerate(parts):
                if i:
                    send_at += timedelta(seconds=_next_part_delay(cfg, part, chat.is_simulated))
                session.add(_part_message(chat.id, part, i, len(parts), source, rule_id, order,
                                          "scheduled", send_at, item_base))
        await session.commit()

    for title, body in extra_pushes:
        await send_push_to_all(title, body, url="/app", tag=f"avito-order-{chat_id}")
    if push:
        await send_push_to_all(push[0], push[1], url=f"/admin?tab=avito&chat={chat_id}", tag=f"avito-{chat_id}")


def _parts(cfg: AvitoBotConfig, text_: str, source: str | None = "llm") -> list[str]:
    """На короткие сообщения делим только ответы модели. Шаблон и скрипты магазина уходят
    целиком — как они написаны, с пустыми строками внутри."""
    return (split_reply(text_) or [text_]) if cfg.human_mode and source == "llm" else [text_]


def _next_part_delay(cfg: AvitoBotConfig, part: str, simulated: bool) -> int:
    """Пауза перед следующим сообщением: человек допечатывает его."""
    if simulated:
        return 1
    return typing_delay(part, 2, max(4, min(cfg.reply_delay_max, 25)))


def _part_message(chat_id: UUID, text_: str, index: int, total: int, source: str | None, rule_id: UUID | None,
                  order: dict | None, status: str, send_at: datetime | None,
                  base_time: datetime | None = None) -> AvitoMessage:
    """Правило засчитывается по первой части, бронь оформляется после последней.
    created_at растёт на миллисекунду с каждой частью — по нему соблюдается порядок отправки."""
    return AvitoMessage(chat_id=chat_id, author="bot", text=text_, source=source,
                        rule_id=rule_id if index == 0 else None,
                        order_payload=order if index == total - 1 else None,
                        status=status, send_at=send_at,
                        created_at=(base_time or _now()) + timedelta(milliseconds=index))


async def create_test_order() -> Order:
    """Тестовая заявка с Авито: появится в «Заказах» и PWA с пометкой «Заявка с Авито» и пушем,
    остаток не списывает. Создаёт тренировочный диалог, из которого «пришла» заявка."""
    async with AsyncSessionFactory() as session:
        product = (await session.execute(
            select(Product).where(Product.is_active.is_(True), Product.stock_quantity > 0)
            .order_by(Product.is_featured.desc(), Product.updated_at.desc()).limit(1)
        )).scalar_one_or_none()
        if product is None:
            raise ActionError("В каталоге нет активных товаров в наличии")
        chat = AvitoChat(id=uuid4(), avito_chat_id=f"sim-{uuid4().hex[:12]}", is_simulated=True,
                         client_name="Тестовый покупатель", item_title=product.name)
        session.add(chat)
        await session.flush()
        result = await create_chat_order(session, chat, {
            "product_id": str(product.id), "method": "pickup", "address": "",
            "name": "Тестов Тест Тестович", "phone": "+79990000000", "email": "", "comment": "Проверка пометки в PWA",
        })
        if isinstance(result, str):
            raise ActionError(f"Не получилось: {result}")
        chat.order_id, chat.order_number = result.id, result.order_number
        session.add(AvitoMessage(chat_id=chat.id, author="client", text="Беру, забронируйте. Тестов Тест Тестович, +79990000000",
                                 sent_at=_now()))
        _touch(chat, "Беру, забронируйте")
        await session.commit()
    await send_order_push(result)
    return result


# ── Отмена заявки ────────────────────────────────────────────────────────────

CANCELABLE = ("pending", "confirmed", "processing")
STATUS_RU = {"shipped": "отправлен", "delivered": "доставлен", "refunded": "оформлен возврат", "cancelled": "отменён"}


async def _order_info(session: AsyncSession, chat: AvitoChat) -> tuple[str, str] | None:
    if chat.order_id is None:
        return None
    order = await session.get(Order, chat.order_id)
    return (order.order_number, order.status) if order else None


async def _phrase_cancel(session: AsyncSession, chat: AvitoChat, text_: str) -> tuple[str, str] | None:
    return await cancel_chat_order(session, chat, text_) if chat.order_id and wants_cancel(text_) else None


async def cancel_chat_order(session: AsyncSession, chat: AvitoChat, customer_text: str) -> tuple[str, str] | None:
    """Покупатель отменил заявку в чате: заказ → «Отменён», остаток, который бот списал при брони,
    возвращается, в заказе — комментарий. Возвращает текст пуша менеджеру (None — отменять нечего).
    Отправленный или доставленный заказ не трогаем — зовём человека."""
    if chat.order_id is None:
        return None
    order = await session.get(Order, chat.order_id, with_for_update=True)
    if order is None or order.status == "cancelled":
        return None
    quote = " ".join(customer_text.split())[:200]
    who = order.customer_name or chat.client_name or "Покупатель"
    if order.status not in CANCELABLE:
        chat.needs_human = True
        state_ru = STATUS_RU.get(order.status, order.status)
        chat.human_reason = f"Просит отменить заказ {order.order_number}, а он уже {state_ru}"[:200]
        log_event(session, chat.id, "cancel_blocked", order.order_number)
        return ("Авито: просят отменить заказ", f"{order.order_number} · {who} · заказ уже {state_ru} — нужен менеджер")
    order.status = "cancelled"
    if not order.is_preorder and not chat.is_simulated:  # тестовые заявки остаток не списывали — и не возвращают
        items = (await session.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
        for item in items:
            if item.product_id is not None:
                await session.execute(update(Product).where(Product.id == item.product_id)
                                      .values(stock_quantity=Product.stock_quantity + item.quantity))
    session.add(OrderComment(order_id=order.id, author_name="Авито-бот",
                             body=f"Покупатель отменил заявку в чате Авито: «{quote}»"))
    if not chat.is_simulated:
        log_event(session, chat.id, "order_cancel", f"{order.order_number} · {quote[:100]}")
    logger.info("avito_order_cancelled", order=order.order_number, chat=str(chat.id))
    return ("Заявка с Авито отменена", f"{order.order_number} · {who} · «{quote[:80]}»")


# ── Отправка ─────────────────────────────────────────────────────────────────

def order_number() -> str:
    return f"TM-{uuid4().hex[:8].upper()}"


class _GiftUow:
    """gift_product_ids из раздела GTA VI ждёт UnitOfWork — ему нужен только site_settings."""
    def __init__(self, session: AsyncSession) -> None:
        self.site_settings = SiteSettingRepository(session)


async def create_chat_order(session: AsyncSession, chat: AvitoChat, payload: dict[str, Any]) -> Order | str:
    """Заказ из чата в общей таблице заказов — как с сайта: цена, остаток, подарок. Строка — ошибка."""
    from src.app.api.routers.gta6 import GIFT_NAME, gift_product_ids  # поздний импорт: роутеры тянут много

    product = await session.get(Product, UUID(payload["product_id"]), with_for_update=True)
    if product is None or not product.is_active:
        return "товар больше не продаётся"
    if not product.is_preorder and product.stock_quantity < 1 and not chat.is_simulated:
        return "товар закончился"
    price = product.discount_price or product.price
    gift = product.id in await gift_product_ids(_GiftUow(session))  # type: ignore[arg-type]
    pickup = payload.get("method") != "delivery"
    note = (["ТЕСТ — тренировочный диалог, остаток не списан, заказ можно удалить."] if chat.is_simulated else []) + [
            f"Заявка из Авито по объявлению «{chat.item_title or 'объявление'}»"
            + (f", покупатель в Авито: {chat.client_name}" if chat.client_name else "") + ".",
            "Самовывоз." if pickup else "Доставка.",
            payload.get("comment") or "",
            f"Переписка: {settings.PUBLIC_SITE_URL.rstrip('/')}/admin?tab=avito&chat={chat.id}"]
    order = Order(
        order_number=order_number(),
        source="avito",
        customer_name=payload.get("name") or chat.client_name or "Покупатель с Авито",
        customer_email=payload.get("email") or "",
        customer_phone=payload.get("phone") or None,
        shipping_address=("Самовывоз: " if pickup else "") + (payload.get("address") or ""),
        shipping_city="Москва",
        subtotal=price, discount_amount=Decimal("0"), shipping_cost=Decimal("0"), total_amount=price,
        is_preorder=product.is_preorder,
        gift=GIFT_NAME if gift else None,
        customer_note=" ".join(x for x in note if x).strip(),
    )
    session.add(order)
    await session.flush()
    session.add(OrderItem(order_id=order.id, product_id=product.id, product_name=product.name, product_sku=product.sku,
                          quantity=1, unit_price=price, total_price=price, gift=GIFT_NAME if gift else None))
    if not product.is_preorder and not chat.is_simulated:
        product.stock_quantity -= 1
    await session.flush()
    await session.refresh(order, attribute_names=["items", "comments"])
    return order


async def _send(cfg: AvitoBotConfig, chat: AvitoChat, msg: AvitoMessage, session: AsyncSession | None = None) -> str | None:
    """Отправить в Авито (тренировочные — только в базу). None — успех, иначе текст ошибки."""
    if chat.is_simulated:
        return None
    try:
        resp = await avito_client.send_text(avito_creds(cfg), chat.avito_chat_id, msg.text)
    except avito_client.AvitoError as exc:
        return str(exc)[:300]
    sent_id = str(resp.get("id")) if resp.get("id") else None
    # Сообщение уже ушло — запись в базу не должна упасть из-за id, иначе обработчик отправит его ещё раз.
    # id мог успеть записаться из эха вебхука в чужую строку — тогда просто не храним его здесь.
    if sent_id and session is not None:
        taken = await session.execute(select(AvitoMessage.id).where(AvitoMessage.avito_message_id == sent_id))
        if taken.first():
            sent_id = None
    msg.avito_message_id = sent_id
    return None


async def deliver_message(session: AsyncSession, cfg: AvitoBotConfig, chat: AvitoChat, msg: AvitoMessage) -> tuple[str | None, Order | None]:
    """Отправляет и, если ушло, засчитывает правило и оформляет бронь. Возвращает (ошибка, заказ)."""
    error = await _send(cfg, chat, msg, session)
    if error:
        return error, None
    msg.status = "sent"
    msg.sent_at = _now()
    msg.error = None
    _touch(chat, msg.text)
    if msg.rule_id is not None:
        hits = dict(chat.rule_hits or {})
        hits[str(msg.rule_id)] = int(hits.get(str(msg.rule_id), 0)) + 1
        chat.rule_hits = hits
        await session.execute(update(AvitoBotRule).where(AvitoBotRule.id == msg.rule_id).values(hits=AvitoBotRule.hits + 1))
    order = None
    if msg.order_payload and chat.order_id is None:
        result = await create_chat_order(session, chat, msg.order_payload)
        if isinstance(result, str):
            chat.needs_human = True
            chat.human_reason = f"Бронь не оформилась: {result}"[:200]
        else:
            order = result
            chat.order_id = order.id
            chat.order_number = order.order_number
            if not chat.is_simulated:
                log_event(session, chat.id, "order", f"{order.order_number} · {msg.order_payload.get('product_name', '')}")
    return None, order


async def deliver_due_message(message_id: UUID) -> None:
    """Отправка одного запланированного сообщения (обработчик уже взял его в работу)."""
    push: tuple[str, str] | None = None
    order: Order | None = None
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        msg = await session.get(AvitoMessage, message_id, with_for_update=True)
        if msg is None or msg.status != "scheduled":
            return
        chat = await session.get(AvitoChat, msg.chat_id)
        if chat is None or chat.mode != "bot":
            msg.status = "discarded"
            await session.commit()
            return
        # Части ответа уходят строго по порядку: если предыдущая ещё не ушла (например, ждёт
        # повтора после ошибки), эта ждёт её
        earlier = (await session.execute(
            select(func.max(AvitoMessage.send_at)).where(
                AvitoMessage.chat_id == chat.id, AvitoMessage.status == "scheduled",
                AvitoMessage.created_at < msg.created_at, AvitoMessage.id != msg.id)
        )).scalar()
        if earlier is not None:
            msg.send_at = max(earlier, _now()) + timedelta(seconds=2)
            await session.commit()
            return
        error, order = await deliver_message(session, cfg, chat, msg)
        if error:
            msg.attempts += 1
            msg.error = error
            if msg.attempts < SEND_RETRIES:
                msg.send_at = _now() + timedelta(seconds=15 * msg.attempts)
            else:
                msg.status = "failed"
                chat.needs_human = True
                chat.human_reason = "Не удалось отправить ответ в Авито"
                log_event(session, chat.id, "send_failed", error)
                push = ("Авито: ответ не отправился", f"{chat.client_name or 'Покупатель'}: {error[:120]}")
        elif chat.needs_human and chat.human_reason and chat.human_reason.startswith("Бронь"):
            push = ("Авито: бронь не оформилась", f"{chat.client_name or 'Покупатель'} · {chat.human_reason}")
        await session.commit()
        chat_id = chat.id
    if order is not None:
        await send_order_push(order)
    if push:
        await send_push_to_all(push[0], push[1], url=f"/admin?tab=avito&chat={chat_id}", tag=f"avito-{chat_id}")


def _touch(chat: AvitoChat, text_: str) -> None:
    chat.last_message_text = text_[:300]
    chat.last_message_at = _now()


# ── Входящие ─────────────────────────────────────────────────────────────────

def _system_patterns(cfg: AvitoBotConfig) -> list[str]:
    return [p.strip() for p in cfg.system_patterns.splitlines() if p.strip()]


async def handle_webhook(payload: dict[str, Any]) -> None:
    body = (payload or {}).get("payload") or {}
    value = body.get("value") or {}
    if body.get("type") not in (None, "message") or not value.get("chat_id"):
        return
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        await session.commit()
    kind = classify_avito_message(value, cfg.avito_user_id, _system_patterns(cfg))
    if kind is None:
        return
    await update_health(last_webhook_at=_now().isoformat())
    # user_id в сообщении — наш аккаунт, которому принадлежит чат: по нему и узнаём свои сообщения
    account_id = value.get("user_id")
    await handle_incoming(str(value["chat_id"]), str(value.get("id") or "") or None, value.get("author_id"), kind[1],
                          system=kind[0] == "system", account_id=account_id,
                          own=avito_client.same_id(value.get("author_id"), account_id) or None)


GREET_EVERY = timedelta(hours=24)


async def _greeted_recently(session: AsyncSession, chat: AvitoChat) -> bool:
    """Писали ли мы этому покупателю за последние сутки — в этом чате или в другом (по его ID в Авито).
    Тогда не здороваемся и не шлём шаблон с ценой ещё раз."""
    since = _now() - GREET_EVERY
    chat_ids = select(AvitoChat.id).where(AvitoChat.id == chat.id)
    if chat.client_avito_id and not chat.is_simulated:
        chat_ids = select(AvitoChat.id).where(or_(AvitoChat.id == chat.id, AvitoChat.client_avito_id == chat.client_avito_id))
    res = await session.execute(
        select(AvitoMessage.id).where(
            AvitoMessage.chat_id.in_(chat_ids), AvitoMessage.author.in_(("bot", "staff")),
            AvitoMessage.status == "sent", AvitoMessage.created_at >= since,
        ).limit(1)
    )
    return res.first() is not None


async def _import_history(session: AsyncSession, cfg: AvitoBotConfig, chat: AvitoChat, account_id: Any,
                          skip_id: str | None) -> None:
    """Новый для бота чат мог начаться в Авито раньше: подтягиваем последние сообщения, чтобы бот
    видел разговор и не здоровался заново с тем, с кем уже общались."""
    creds = avito_creds(cfg)
    try:
        creds.user_id = int(account_id) if account_id not in (None, "") else creds.user_id
        messages = await avito_client.list_messages(creds, chat.avito_chat_id, limit=30)
    except (avito_client.AvitoError, TypeError, ValueError) as exc:
        logger.warning("avito_history_import_failed", chat=chat.avito_chat_id, error=str(exc)[:200])
        return
    for m in sorted(messages, key=lambda x: x.get("created") or 0):
        mid = str(m.get("id") or "") or None
        if not mid or mid == skip_id:
            continue
        kind = classify_avito_message(m, creds.user_id, _system_patterns(cfg))
        if kind is None:
            continue
        direction = m.get("direction")
        own = direction == "out" if direction in ("in", "out") else avito_client.same_id(m.get("author_id"), creds.user_id)
        author = "system" if kind[0] == "system" else ("staff" if own else "client")
        created = datetime.fromtimestamp(int(m.get("created") or 0), tz=timezone.utc) if m.get("created") else _now()
        session.add(AvitoMessage(chat_id=chat.id, avito_message_id=mid, author=author, text=kind[1],
                                 source="avito" if author != "client" else None, sent_at=created, created_at=created))
    await session.flush()


async def _fill_meta(cfg: AvitoBotConfig, chat: AvitoChat, account_id: Any) -> None:
    """Ник покупателя и объявление. Пробуем при каждом сообщении, пока не получится."""
    creds = avito_creds(cfg)
    try:
        creds.user_id = int(account_id) if account_id not in (None, "") else creds.user_id
    except (TypeError, ValueError):
        pass
    try:
        meta = avito_client.chat_meta(await avito_client.get_chat(creds, chat.avito_chat_id), creds.user_id)
    except avito_client.AvitoError as exc:
        logger.warning("avito_chat_meta_failed", chat=chat.avito_chat_id, error=str(exc))
        return
    for k, v in meta.items():
        if v is not None:
            setattr(chat, k, v)


async def handle_incoming(avito_chat_id: str, avito_message_id: str | None, author_id: int | None, text_: str,
                          system: bool = False, account_id: Any = None, own: bool | None = None) -> bool:
    """Сохраняет сообщение. True — оно новое (не дубль). system — служебное сообщение Авито:
    сохраняем для сотрудников, но бот на него не отвечает и не учитывает в разговоре."""
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        if avito_message_id:
            exists = await session.execute(select(AvitoMessage.id).where(AvitoMessage.avito_message_id == avito_message_id))
            if exists.first():
                return False
        chat = (await session.execute(
            select(AvitoChat).where(AvitoChat.avito_chat_id == avito_chat_id).with_for_update()
        )).scalar_one_or_none()
        new_chat = chat is None
        if chat is None:
            chat = AvitoChat(id=uuid4(), avito_chat_id=avito_chat_id)
            session.add(chat)
        if (not chat.client_name or not chat.item_title) and avito_creds(cfg).ready and not chat.is_simulated:
            await _fill_meta(cfg, chat, account_id or cfg.avito_user_id)
        await session.flush()
        if new_chat and avito_creds(cfg).ready and cfg.avito_connected_at:
            await _import_history(session, cfg, chat, account_id or cfg.avito_user_id, avito_message_id)

        if system:
            session.add(AvitoMessage(chat_id=chat.id, avito_message_id=avito_message_id, author="system",
                                     text=text_, source="avito", sent_at=_now()))
            await session.commit()
            return False

        if own is None:
            own = avito_client.same_id(author_id, account_id) or avito_client.same_id(author_id, cfg.avito_user_id)
        if own:
            # Эхо нашего же ответа (id ещё не успели записать) — просто привязываем id
            echo = (await session.execute(
                select(AvitoMessage).where(
                    AvitoMessage.chat_id == chat.id, AvitoMessage.author.in_(("bot", "staff")),
                    AvitoMessage.status == "sent", AvitoMessage.avito_message_id.is_(None), AvitoMessage.text == text_,
                ).order_by(AvitoMessage.created_at.desc()).limit(1)
            )).scalar_one_or_none()
            if echo is not None:
                echo.avito_message_id = avito_message_id
                await session.commit()
                return False
            # Сотрудник ответил прямо из приложения Авито — диалог ведёт человек, ответ идёт в обучение
            state = await chat_state(session, chat)
            await _learn(session, chat, state, text_)
            await _cancel_pending_bot(session, chat.id)
            session.add(AvitoMessage(chat_id=chat.id, avito_message_id=avito_message_id, author="staff",
                                     text=text_, source="avito", sent_at=_now()))
            if cfg.staff_takes_over:
                chat.mode = "human"
                chat.needs_human = False
                chat.reply_due_at = None
            _touch(chat, text_)
            await session.commit()
            return True

        await _cancel_pending_bot(session, chat.id)
        session.add(AvitoMessage(chat_id=chat.id, avito_message_id=avito_message_id, author="client", text=text_, sent_at=_now()))
        _touch(chat, text_)
        if not chat.opted_out and wants_opt_out(text_):
            chat.opted_out = True
            log_event(session, chat.id, "opt_out", text_[:200])
        # Явная отмена заявки — сразу, даже если бот выключен или диалог ведёт сотрудник
        cancel_push = await _phrase_cancel(session, chat, text_)
        if chat.mode == "bot" and not chat.needs_human and cfg.enabled:
            chat.reply_due_at = _now() + timedelta(seconds=DEBOUNCE_SECONDS)
        await session.commit()
    if cancel_push:
        await send_push_to_all(cancel_push[0], cancel_push[1], url="/app", tag=f"avito-order-{avito_chat_id}")
    return True


async def poll_unread() -> int:
    """Догонялка: забирает свежие непрочитанные сообщения через API, если вебхук их не донёс."""
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        await session.commit()
    if not (cfg.enabled and cfg.avito_connected_at):
        return 0
    creds = avito_creds(cfg)
    since = max(cfg.avito_connected_at, _now() - POLL_WINDOW)
    caught = 0
    try:
        for chat in (await avito_client.list_chats(creds, unread_only=True))[:30]:
            chat_id = str(chat.get("id") or "")
            if not chat_id:
                continue
            for m in sorted(await avito_client.list_messages(creds, chat_id), key=lambda x: x.get("created") or 0):
                created = datetime.fromtimestamp(int(m.get("created") or 0), tz=timezone.utc)
                kind = classify_avito_message(m, cfg.avito_user_id, _system_patterns(cfg))
                if created < since or kind is None:
                    continue
                direction = m.get("direction")
                if await handle_incoming(chat_id, str(m.get("id") or "") or None, m.get("author_id"), kind[1],
                                         system=kind[0] == "system", account_id=cfg.avito_user_id,
                                         own=(direction == "out") if direction in ("in", "out") else None):
                    caught += 1
    except avito_client.AvitoError as exc:
        await update_health(last_poll_at=_now().isoformat(), last_poll_error=str(exc)[:200])
        await alert("poll", "Авито-бот: нет доступа к Авито", str(exc)[:150])
        return 0
    await update_health(last_poll_at=_now().isoformat(), last_poll_error=None,
                        caught_by_poll=lambda v: int(v or 0) + caught)
    if caught:
        logger.warning("avito_bot_poll_caught", count=caught)
        await alert("webhook", "Авито-бот: вебхук пропускает сообщения",
                    f"Опрос подобрал {caught} сообщ. — проверьте подключение в настройках бота")
    return caught


async def simulate(text_: str, chat_id: UUID | None, client_name: str, item_title: str | None, item_price: str | None) -> UUID:
    """Тренировочный диалог в админке: всё как в жизни, но в Авито ничего не уходит."""
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id) if chat_id else None
        if chat is None or not chat.is_simulated:
            chat = AvitoChat(id=uuid4(), avito_chat_id=f"sim-{uuid4().hex[:12]}", is_simulated=True,
                             client_name=client_name, item_title=item_title, item_price=item_price)
            session.add(chat)
            await session.flush()
        await _cancel_pending_bot(session, chat.id)
        session.add(AvitoMessage(chat_id=chat.id, author="client", text=text_, sent_at=_now()))
        _touch(chat, text_)
        cancel_push = await _phrase_cancel(session, chat, text_)   # как в настоящем чате
        if chat.mode == "bot" and not chat.needs_human:
            chat.reply_due_at = _now() + timedelta(seconds=SIM_DEBOUNCE_SECONDS)
        cid = chat.id
        await session.commit()
    if cancel_push:
        await send_push_to_all(cancel_push[0], cancel_push[1], url="/app", tag=f"avito-order-{cid}")
    return cid


# ── Напоминания ──────────────────────────────────────────────────────────────

async def claim_reminder_chats(cfg: AvitoBotConfig, limit: int = 10) -> list[UUID]:
    """Диалоги, где последнее слово за нами, покупатель молчит дольше заданного, но не дольше окна.
    Отметка reminder_sent_at ставится сразу — второй раз диалог не рассматривается."""
    async with AsyncSessionFactory() as session:
        res = await session.execute(text(
            "UPDATE avito_chats SET reminder_sent_at = now() WHERE id IN ("
            " SELECT c.id FROM avito_chats c"
            " WHERE c.reminder_sent_at IS NULL AND c.mode = 'bot' AND NOT c.needs_human AND c.order_id IS NULL"
            "   AND c.reply_due_at IS NULL AND (c.is_simulated OR :live)"
            "   AND c.last_message_at <= now() - make_interval(mins => :after)"
            "   AND c.last_message_at >= now() - make_interval(hours => :window)"
            "   AND (SELECT m.author || ':' || coalesce(m.source, '') FROM avito_messages m"
            "        WHERE m.chat_id = c.id AND m.status = 'sent' AND m.author <> 'system' ORDER BY m.created_at DESC LIMIT 1)"
            "       IN ('bot:rule', 'bot:llm', 'staff:staff', 'staff:avito')"  # после рассылки не напоминаем
            "   AND EXISTS (SELECT 1 FROM avito_messages m WHERE m.chat_id = c.id AND m.author = 'client')"
            "   AND NOT EXISTS (SELECT 1 FROM avito_messages m WHERE m.chat_id = c.id AND m.status IN ('draft', 'scheduled'))"
            " ORDER BY c.last_message_at LIMIT :limit FOR UPDATE SKIP LOCKED) RETURNING id"
        ), {"live": cfg.enabled, "after": cfg.reminder_after_minutes, "window": cfg.reminder_window_hours, "limit": limit})
        ids = [row[0] for row in res.all()]
        await session.commit()
    return ids


async def run_reminders() -> int:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        await session.commit()
    if not cfg.reminders_enabled or not in_window(_now(), cfg.reminder_from, cfg.reminder_to):
        return 0
    done = 0
    for chat_id in await claim_reminder_chats(cfg):
        try:
            done += await process_reminder(chat_id, cfg)
        except Exception as exc:  # noqa: BLE001
            logger.exception("avito_bot_reminder_failed", chat_id=str(chat_id), error=str(exc))
    return done


async def process_reminder(chat_id: UUID, cfg: AvitoBotConfig) -> int:
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id)
        if chat is None:
            return 0
        state = await chat_state(session, chat)
        last_client = next((t for a, t in reversed(state.ctx.history) if a == "client"), "")
        text_: str | None = None
        reason: str | None = None
        if is_refusal(last_client):
            reason = "покупатель отказался"
        elif cfg.reminder_use_llm and llm_settings(cfg).ready:
            products = (await catalog_products(session, chat.item_id, chat.item_title, None))[0] if cfg.use_catalog else []
            masker = PiiMasker()
            ctx = ChatContext(chat.item_title, chat.item_price, chat.client_name, [(a, masker.mask(t)) for a, t in state.ctx.history])
            try:
                raw = await llm_call(cfg, build_reminder_messages(
                    PromptConfig(cfg.persona_name, cfg.style, cfg.knowledge, cfg.handoff_topics), ctx,
                    [product_line(p) for p in products], _now()))
                verdict = parse_llm_answer(raw)
                text_ = masker.unmask(verdict.reply) or None
                reason = None if text_ else (verdict.reason or "модель решила не напоминать")
            except llm_client.LlmError as exc:
                reason = f"модель не ответила: {exc}"
        else:
            text_ = render_reminder(cfg.reminder_template, chat.item_title, chat.client_name)

        if not text_:
            if not chat.is_simulated:
                log_event(session, chat.id, "reminder_skip", reason)
            await session.commit()
            return 0
        msg = AvitoMessage(chat_id=chat.id, author="bot", text=text_, source="reminder")
        if cfg.mode == "draft" and not chat.is_simulated:
            msg.status = "draft"
        else:
            msg.status = "scheduled"
            msg.send_at = _now()
        session.add(msg)
        if not chat.is_simulated:
            log_event(session, chat.id, "reminder", text_[:120])
        await session.commit()
    return 1


# ── Рассылки ─────────────────────────────────────────────────────────────────

# Ошибки «не у покупателя, а у нас»: ключи, подключение, сеть — рассылка встаёт на паузу, получатели ждут
_PAUSE_PROBLEMS = ("токен", "не подключён", "Нет связи", "401", "403", "429")


async def broadcast_step() -> bool:
    """Одно сообщение одной идущей рассылки, если подошла её очередь. True — что-то сделали."""
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        res = await session.execute(text(
            "UPDATE avito_broadcasts SET next_send_at = now() + make_interval(secs => :iv) WHERE id = ("
            " SELECT id FROM avito_broadcasts WHERE status = 'sending' AND (next_send_at IS NULL OR next_send_at <= now())"
            " ORDER BY started_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id"
        ), {"iv": cfg.broadcast_interval_seconds})
        bid = res.scalar()
        if bid is None:
            await session.commit()
            return False
        b = await session.get(AvitoBroadcast, bid)
        rec = (await session.execute(
            select(AvitoBroadcastRecipient)
            .where(AvitoBroadcastRecipient.broadcast_id == bid, AvitoBroadcastRecipient.status == "pending")
            .limit(1).with_for_update(skip_locked=True)
        )).scalar_one_or_none()
        if rec is None:
            b.status = "done"
            b.finished_at = _now()
            await session.commit()
            logger.info("avito_broadcast_done", id=str(bid), sent=b.sent, failed=b.failed)
            return True
        chat = await session.get(AvitoChat, rec.chat_id)
        if chat is None or chat.opted_out:
            rec.status = "skipped"
            rec.error = "покупатель просил не писать" if chat else "диалог удалён"
            b.skipped += 1
            b.next_send_at = _now()  # пропуск не тратит паузу
            await session.commit()
            return True
        msg = AvitoMessage(chat_id=chat.id, author="staff", text=render_template(b.text, chat.item_title, chat.client_name),
                           source="broadcast")
        error = await _send(cfg, chat, msg, session)
        if error:
            rec.status = "failed"
            rec.error = error[:300]
            b.failed += 1
            stuck = any(p in error for p in _PAUSE_PROBLEMS)
            if stuck:
                rec.status = "pending"   # этого получателя попробуем снова после возобновления
                b.failed -= 1
            if stuck or (b.failed >= 3 and b.sent == 0):
                # Авито не пускает или всё подряд падает — нет смысла жечь остальных получателей
                b.status = "paused"
                await session.commit()
                await alert("broadcast", "Рассылка на паузе", f"«{b.title}»: {error[:120]}")
                return True
        else:
            msg.status = "sent"
            msg.sent_at = _now()
            session.add(msg)
            _touch(chat, msg.text)
            chat.last_broadcast_at = _now()
            rec.status = "sent"
            rec.sent_at = _now()
            b.sent += 1
        await session.commit()
    return True


async def create_broadcast(title: str, text_: str, chat_ids: list[UUID], created_by: str | None) -> UUID:
    async with AsyncSessionFactory() as session:
        chats = (await session.execute(select(AvitoChat.id, AvitoChat.opted_out).where(AvitoChat.id.in_(chat_ids)))).all()
        ok = [cid for cid, opted in chats if not opted]
        if not ok:
            raise ActionError("Некому отправлять: выбранные покупатели просили не писать или диалоги удалены")
        b = AvitoBroadcast(title=title.strip() or text_.strip()[:60], text=text_.strip(), total=len(ok), created_by=created_by)
        session.add(b)
        await session.flush()
        session.add_all(AvitoBroadcastRecipient(broadcast_id=b.id, chat_id=cid) for cid in ok)
        await session.commit()
        return b.id


async def set_broadcast_status(broadcast_id: UUID, action: str) -> None:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        b = await session.get(AvitoBroadcast, broadcast_id, with_for_update=True)
        if b is None:
            raise ActionError("Рассылка не найдена")
        if action == "start":
            if b.status not in ("draft", "paused"):
                raise ActionError("Рассылку уже нельзя запустить")
            live = (await session.execute(
                select(func.count()).select_from(AvitoBroadcastRecipient)
                .join(AvitoChat, AvitoChat.id == AvitoBroadcastRecipient.chat_id)
                .where(AvitoBroadcastRecipient.broadcast_id == b.id, AvitoBroadcastRecipient.status == "pending",
                       AvitoChat.is_simulated.is_(False))
            )).scalar_one()
            if live and not cfg.avito_connected_at:
                raise ActionError("Сначала подключите Авито в настройках бота")
            b.status = "sending"
            b.started_at = b.started_at or _now()
            b.next_send_at = _now()
        elif action == "pause":
            if b.status != "sending":
                raise ActionError("Рассылка сейчас не идёт")
            b.status = "paused"
        elif action == "cancel":
            if b.status in ("done", "cancelled"):
                raise ActionError("Рассылка уже завершена")
            b.status = "cancelled"
            b.finished_at = _now()
            await session.execute(
                update(AvitoBroadcastRecipient)
                .where(AvitoBroadcastRecipient.broadcast_id == b.id, AvitoBroadcastRecipient.status == "pending")
                .values(status="skipped", error="рассылка отменена")
            )
        await session.commit()


async def set_opt_out(chat_id: UUID, value: bool) -> None:
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id)
        if chat is None:
            raise ActionError("Диалог не найден")
        chat.opted_out = value
        await session.commit()


# ── Действия сотрудника ──────────────────────────────────────────────────────

class ActionError(Exception):
    pass


async def _learn(session: AsyncSession, chat: AvitoChat, state: ChatState, answer: str, bot_answer: str | None = None) -> None:
    """Ответ сотрудника вместо бота — пример для модели. Только если был вопрос без ответа
    и бот в нём участвовал (черновик, позвал человека); болтовня сотрудника не копится."""
    question = state.pending.strip()
    bot_answer = bot_answer if bot_answer is not None else state.bot_draft
    if not question or not answer.strip() or chat.is_simulated:
        return
    if not (bot_answer or chat.needs_human or chat.human_question):
        return
    if bot_answer and bot_answer.strip() == answer.strip():
        return  # сотрудник согласился с ботом — учить нечему
    session.add(AvitoBotExample(question=question[:2000], bot_answer=bot_answer, answer=answer.strip(),
                                item_title=chat.item_title, chat_id=chat.id))
    chat.human_question = None


async def staff_send(chat_id: UUID, text_: str) -> None:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        chat = await session.get(AvitoChat, chat_id, with_for_update=True)
        if chat is None:
            raise ActionError("Диалог не найден")
        state = await chat_state(session, chat)
        msg = AvitoMessage(chat_id=chat.id, author="staff", text=text_, source="staff")
        error = await _send(cfg, chat, msg, session)
        if error:
            raise ActionError(error)
        await _learn(session, chat, state, text_)
        await _cancel_pending_bot(session, chat.id)
        msg.status = "sent"
        msg.sent_at = _now()
        session.add(msg)
        chat.mode = "human"
        chat.needs_human = False
        chat.human_reason = None
        chat.reply_due_at = None
        _touch(chat, text_)
        await session.commit()


async def approve_draft(message_id: UUID, text_: str | None) -> None:
    order: Order | None = None
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        msg = await session.get(AvitoMessage, message_id, with_for_update=True)
        if msg is None or msg.status != "draft":
            raise ActionError("Черновик уже отправлен или устарел")
        chat = await session.get(AvitoChat, msg.chat_id)
        original = msg.text
        if text_ and text_.strip() != msg.text:
            state = await chat_state(session, chat)
            msg.text = text_.strip()
            msg.source = "staff"
            await _learn(session, chat, state, msg.text, bot_answer=original)
        # Как человек: первая часть уходит сейчас, остальные — следом, с паузой «печати»
        parts = _parts(cfg, msg.text, msg.source)
        order_payload = msg.order_payload
        msg.text = parts[0]
        if len(parts) > 1:
            msg.order_payload = None
        error, order = await deliver_message(session, cfg, chat, msg)
        if error:
            await session.rollback()
            raise ActionError(error)
        msg.created_at = _now()
        send_at = _now()
        for i, part in enumerate(parts[1:], 1):
            send_at += timedelta(seconds=_next_part_delay(cfg, part, chat.is_simulated))
            session.add(_part_message(chat.id, part, i, len(parts), msg.source, None, order_payload, "scheduled",
                                      send_at, msg.created_at))
        await session.commit()
    if order is not None:
        await send_order_push(order)


async def discard_message(message_id: UUID) -> None:
    async with AsyncSessionFactory() as session:
        msg = await session.get(AvitoMessage, message_id, with_for_update=True)
        if msg is None or msg.status not in ("draft", "scheduled"):
            raise ActionError("Сообщение уже отправлено или отменено")
        msg.status = "discarded"
        await session.commit()


async def set_mode(chat_id: UUID, mode: str) -> None:
    async with AsyncSessionFactory() as session:
        chat = await session.get(AvitoChat, chat_id, with_for_update=True)
        if chat is None:
            raise ActionError("Диалог не найден")
        chat.mode = mode
        chat.needs_human = False
        chat.human_reason = None
        if mode == "human":
            await _cancel_pending_bot(session, chat.id)
            chat.reply_due_at = None
        else:
            # Вернули боту — если покупатель ждёт ответа, бот подумает над ним сейчас
            state = await chat_state(session, chat)
            chat.reply_due_at = _now() if state.pending.strip() else None
        await session.commit()


# ── Счётчики ─────────────────────────────────────────────────────────────────

async def chat_counts(session: AsyncSession) -> tuple[int, int, int]:
    total = (await session.execute(select(func.count(AvitoChat.id)))).scalar_one()
    human = (await session.execute(select(func.count(AvitoChat.id)).where(AvitoChat.needs_human.is_(True)))).scalar_one()
    drafts = (await session.execute(select(func.count(func.distinct(AvitoMessage.chat_id))).where(AvitoMessage.status == "draft"))).scalar_one()
    return total, human, drafts


async def draft_chat_ids(session: AsyncSession) -> set[UUID]:
    res = await session.execute(select(AvitoMessage.chat_id).where(AvitoMessage.status == "draft").distinct())
    return set(res.scalars().all())


async def queue_sizes(session: AsyncSession) -> tuple[int, int]:
    replies = (await session.execute(select(func.count(AvitoChat.id)).where(AvitoChat.reply_due_at.is_not(None)))).scalar_one()
    sends = (await session.execute(select(func.count(AvitoMessage.id)).where(AvitoMessage.status == "scheduled"))).scalar_one()
    return replies, sends


# ── Очередь для обработчика: взять в работу атомарно (несколько процессов не возьмут одно и то же) ──

async def claim_due_chats(limit: int = 5) -> list[UUID]:
    async with AsyncSessionFactory() as session:
        res = await session.execute(text(
            "UPDATE avito_chats SET reply_due_at = NULL WHERE id IN ("
            " SELECT id FROM avito_chats WHERE reply_due_at <= now() ORDER BY reply_due_at"
            " LIMIT :limit FOR UPDATE SKIP LOCKED) RETURNING id"
        ), {"limit": limit})
        ids = [row[0] for row in res.all()]
        await session.commit()
    return ids


async def claim_due_messages(limit: int = 10, lease_seconds: int = 60) -> list[UUID]:
    """Сдвигаем send_at на время аренды: если процесс упадёт посреди отправки, сообщение вернётся в очередь."""
    async with AsyncSessionFactory() as session:
        res = await session.execute(text(
            "UPDATE avito_messages SET send_at = now() + make_interval(secs => :lease) WHERE id IN ("
            " SELECT id FROM avito_messages WHERE status = 'scheduled' AND send_at <= now() ORDER BY send_at"
            " LIMIT :limit FOR UPDATE SKIP LOCKED) RETURNING id"
        ), {"limit": limit, "lease": lease_seconds})
        ids = [row[0] for row in res.all()]
        await session.commit()
    return ids
