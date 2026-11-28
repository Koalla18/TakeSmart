"""
Авито-бот: приём сообщений, решение, очередь отправки, бронь, действия сотрудников.

Поток (всё через базу — переживает перезапуск и несколько процессов):
  1. Вебхук сначала сохраняет событие, а затем очередь или опрос сохраняют сообщение покупателя и ставят
     диалогу срок «подумать» (reply_due_at = сейчас + пара секунд). Ещё сообщение подряд —
     срок сдвигается, ответ будет один на все.
  2. Обработчик (avito_bot_worker) забирает диалоги со сроком → process_chat решает
     (avito_bot_engine) и кладёт ответ: черновик сотруднику или запланированное сообщение
     (status=scheduled, send_at — пауза «как у человека»); или зовёт человека (push).
  3. Обработчик отправляет запланированные сообщения; при явной ошибке повторяет, при неясном
     результате сверяется с историей Авито. Если покупатель успел написать ещё —
     запланированный ответ отменяется и бот думает заново.
  4. Бронь: модель может приложить к ответу заказ — он создаётся в общей таблице заказов,
     до отправки покупателю (в режиме черновиков — когда сотрудник
     нажал «Оформить бронь и отправить»).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from cryptography.fernet import InvalidToken
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.core import avito_catalog, avito_client, avito_quotes, llm_client
from src.app.core.avito_bot_engine import (
    MSK, ChatContext, PiiMasker, PromptConfig, build_messages, build_reminder_messages, build_system_prompt,
    human_delay, in_window, match_rule, parse_llm_answer, pick_examples, render_reminder,
    render_template, rule_covers, starts_with_refusal, wants_opt_out, is_first_reply, greeting_text,
    split_reply, typing_delay, classify_avito_message, normalize_phone, valid_email, valid_full_name,
    order_note_for_prompt, wants_cancel, CatalogItem, SearchIndex, family_name, catalog_vocab, query_segments, search_catalog,
    is_refusal, strip_greeting, sanitize_reply, price_lines,
    audit_reply_prices, trade_in_amounts, mentions_other_city, normalize, is_closing_message, bot_farewelled,
    audit_reply_colors, is_own_repeat, unsupported_variant_fact,
)
from src.app.core.config import settings
from src.app.core.integration_secrets import open_sealed, seal
from src.app.core.avito_routine import incomplete_delivery_address_reply, unverified_prize_reply
from src.app.core.logger import get_logger
from src.app.core.push_service import send_order_push, send_push_to_all
from src.app.database.models.avito_bot import AvitoBotEvent, AvitoBotExample, AvitoBroadcast, AvitoBroadcastRecipient, AvitoBotRule, AvitoChat, AvitoItemLink, AvitoMessage, AvitoWebhookEvent
from src.app.database.models.order import Order, OrderComment, OrderItem
from src.app.database.models.product import Product
from src.app.database.models.site_setting import SiteSetting
from src.app.database.repositories.site_setting_repository import SiteSettingRepository
from src.app.database.session import AsyncSessionFactory
from src.app.schemas.avito_bot import DEFAULT_GREETING, SECRET_FIELDS, AvitoBotConfig

logger = get_logger(__name__)

CONFIG_KEY = "avito_bot_config"
HEALTH_KEY = "avito_bot_health"
SIM_DEBOUNCE_SECONDS = 1
SIMULATED_MAX_DELAY = 2       # тренировочные диалоги — без долгих пауз
HISTORY_LIMIT = 30
SEND_RETRIES = 3
_BOOKING_CONFIRMED = re.compile(
    r"\b(?:забронировал\w*|зарезервировал\w*|(?:заявк\w*|брон\w*|заказ\w*)\s+(?:оформлен\w*|подтвержден\w*|сохранен\w*)|"
    r"(?:оформил\w*|подтвердил\w*|сохранил\w*)\s+(?:брон\w*|заявк\w*|заказ\w*))\b"
)
LLM_ALERT_STREAK = 3
ALERT_EVERY = timedelta(hours=1)
POLL_WINDOW = timedelta(hours=1)   # опрос подбирает только свежие сообщения
_VISIT = re.compile(
    r"^(?:(?:привет|здравствуйте|добрый день|добрый вечер) )?(?:да )?(?:я )?"
    r"(?:(?:сейчас|скоро) )?(?:приеду|подъеду|зайду)(?: (?:сейчас|скоро|сегодня))?$",
)
_STORE_VISIT = re.compile(
    r"\b(?:где\s+вы\s+(?:находитесь|расположены)|где\s+ваш\s+магазин|"
    r"какой\s+(?:у\s+вас\s+)?адрес(?:\s+у\s+вас)?|(?:ваш|точный)\s+адрес|"
    r"куда\s+(?:можно\s+|мне\s+)?(?:подъехать|приехать|зайти|подойти)|"
    r"(?:когда|во\s+сколько)\s+(?:можно\s+|лучше\s+|мне\s+)?(?:к\s+вам\s+)?"
    r"(?:приехать|подъехать|зайти|подойти)|до\s+скольки\s+(?:вы\s+)?(?:работаете|открыты))\b",
    re.IGNORECASE,
)
_VISIT_FILLER = re.compile(r"\b(?:а|и|привет|здравствуйте|подскажите|скажите|пожалуйста|сегодня|спасибо|к\s+вам)\b")
_STORE_VISIT_SHORT = re.compile(r"(?:адрес|где вы|куда ехать|часы работы|режим работы|до скольки)")
_STORE_HOURS = re.compile(
    r"\bработаем\s+(?:(ежедневно|каждый день)\s+)?с\s+(\d{1,2}:\d{2})\s+до\s+(\d{1,2}:\d{2})\b",
    re.IGNORECASE,
)


def store_visit_reply(cfg: AvitoBotConfig, pending: str) -> tuple[str | None, str]:
    address = cfg.pickup_address.strip().rstrip(".")
    brief = " ".join(_VISIT_FILLER.sub(" ", normalize(pending)).split())
    if not address:
        return None, pending
    if _STORE_VISIT_SHORT.fullmatch(brief):
        remaining = ""
    elif _STORE_VISIT.search(pending):
        remaining = _STORE_VISIT.sub(" ", pending)
        if not _VISIT_FILLER.sub(" ", normalize(remaining)).strip():
            remaining = ""
    else:
        return None, pending
    answer = f"Наш адрес — {address}."
    if hours := _STORE_HOURS.search(cfg.knowledge):
        daily = " ежедневно" if hours[1] else ""
        answer += f" Работаем{daily} с {hours[2]} до {hours[3]}."
    return f"{answer} Подскажите, пожалуйста, во сколько вам удобно подъехать?", remaining


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Шифрование секретов ──────────────────────────────────────────────────────

def encrypt_secret(value: str) -> str:
    return seal(value, "avito-bot") if value else ""


def decrypt_secret(value: str) -> str:
    if not value or not value.startswith("enc:"):
        return value or ""   # старое значение открытым текстом — перешифруется при сохранении
    try:
        return open_sealed(value, "avito-bot")
    except InvalidToken:
        logger.error("avito_bot_secret_undecryptable")
        raise ActionError("Проверьте ключ шифрования настроек Авито") from None


# ── Настройки ────────────────────────────────────────────────────────────────

async def load_config(session: AsyncSession, *, lock: bool | str = False) -> AvitoBotConfig:
    row = await session.get(SiteSetting, CONFIG_KEY, with_for_update={"read": True} if lock == "read" else bool(lock))
    if row is not None and not isinstance(row.value, dict):
        raise ActionError("Сохранённые настройки Авито требуют исправления")
    raw = dict(row.value) if row is not None else {}
    for f in SECRET_FIELDS:
        raw[f] = decrypt_secret(str(raw.get(f) or ""))
    try:
        cfg = AvitoBotConfig(**raw)
    except ValueError as exc:
        logger.warning("avito_bot_config_invalid")
        raise ActionError("Сохранённые настройки Авито требуют исправления") from exc
    if not cfg.webhook_secret:
        cfg.webhook_secret = secrets.token_urlsafe(24)
        await save_config(session, cfg)
    return cfg


async def save_config(session: AsyncSession, cfg: AvitoBotConfig, *, price_source: str | None = None) -> None:
    row = await session.get(SiteSetting, CONFIG_KEY, with_for_update=True)
    previous_price = (row.value or {}).get("price_list", "") if row else ""
    if cfg.price_list != previous_price:
        connection = await session.connection()
        await connection.run_sync(avito_catalog.publish, cfg.price_list, source=price_source)
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


def listing_allowed(cfg: AvitoBotConfig, item_id: int | None) -> bool:
    return cfg.listing_scope == "all" or (item_id is not None and item_id in cfg.allowed_listing_ids)


def automatic_allowed(cfg: AvitoBotConfig, chat: AvitoChat) -> bool:
    return chat.is_simulated or (cfg.enabled and listing_allowed(cfg, chat.item_id))


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
    await send_push_to_all(title, body, url="/admin?tab=avito&view=settings", tag=f"avito-alert-{kind}", kind="avito_error")


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


async def linked_product(session: AsyncSession, item_id: int | None) -> Product | None:
    if not item_id:
        return None
    link = await session.get(AvitoItemLink, item_id)
    if link is None:
        return None
    product = await session.get(Product, link.product_id)
    return product if product is not None and product.is_active else None


CATALOG_TTL = 60          # секунд: каталог считается свежим минуту; потом обновляется в фоне
_CATALOG: dict[str, Any] = {"at": 0.0}
_CATALOG_LOCK = asyncio.Lock()


async def _load_catalog(session: AsyncSession) -> None:
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
    _CATALOG.update(items=items, products=by_key, vocab=catalog_vocab(items),
                    index=SearchIndex(items), at=time.monotonic())


async def _refresh_catalog_bg() -> None:
    if _CATALOG_LOCK.locked():
        return
    async with _CATALOG_LOCK:
        try:
            async with AsyncSessionFactory() as session:
                await _load_catalog(session)
        except Exception as exc:  # старый каталог остаётся — бот продолжает отвечать
            logger.warning("avito_bot_catalog_refresh_failed", error=str(exc)[:200])


async def catalog_snapshot(session: AsyncSession) -> dict[str, Any]:
    """Каталог сайта для бота: товары, словарь слов, индекс поиска и справочник для модели.
    Ответ не ждёт базу: устаревший каталог отдаётся сразу, а обновляется в фоне; ждём только самый первый раз."""
    if "items" not in _CATALOG:
        async with _CATALOG_LOCK:
            if "items" not in _CATALOG:
                await _load_catalog(session)
    elif time.monotonic() - _CATALOG["at"] >= CATALOG_TTL and not _CATALOG_LOCK.locked():
        asyncio.get_running_loop().create_task(_refresh_catalog_bg())
    return _CATALOG


async def search_products(session: AsyncSession, item_title: str | None, question: str | None = None,
                          limit: int = 12) -> list[Product]:
    """Поиск карточек для ручной привязки в админке."""
    snap = await catalog_snapshot(session)
    texts = ([item_title] if item_title else []) + query_segments(question or "")
    if item_title and question:
        texts.append(f"{item_title} {question}")
    found = search_catalog(snap["items"], texts, snap["vocab"], limit=limit, index=snap["index"])
    return [snap["products"][it.key] for it in found if it.key in snap["products"]]


async def listing_price_info(session: AsyncSession, cfg: AvitoBotConfig, item_title: str | None
                             ) -> tuple[str | None, str | None, str | None]:
    import_id = await avito_catalog.active_import(session, cfg.price_list)
    items = await avito_catalog.listing_items(session, import_id, item_title)
    if len(items) != 1:
        return None, None, None
    hit = items[0]
    a = hit.attributes
    label = hit.name + "".join(f" · {a[k]}" for k in ("country", "sim") if a.get(k))
    return _rub(hit.price), "прайс", label


async def test_listing_suggestions(session: AsyncSession, cfg: AvitoBotConfig, limit: int = 200) -> list[str]:
    import_id = await avito_catalog.active_import(session, cfg.price_list)
    if import_id is None:
        return []
    from src.app.database.models.avito_catalog import variants
    statement = select(variants.c.name).where(variants.c.import_id == import_id).distinct()
    return list(await session.scalars(statement.order_by(variants.c.name).limit(limit)))


async def test_item_id(session: AsyncSession, title: str | None) -> int | None:
    """В тесте находим привязку по полному названию, если оно однозначно."""
    if not title:
        return None
    ids = (await session.execute(
        select(AvitoChat.item_id).where(
            AvitoChat.item_id.is_not(None), func.lower(AvitoChat.item_title) == title.strip().lower()
        ).union(select(AvitoItemLink.item_id).where(
            func.lower(AvitoItemLink.item_title) == title.strip().lower()
        )).limit(2)
    )).scalars().all()
    return ids[0] if len(ids) == 1 else None


async def price_variants_for_card(session: AsyncSession, import_id: int | None, card: Product
                                  ) -> list[CatalogItem]:
    query = avito_catalog.listing_query(card.name)
    if not query:
        return []
    attrs = card.attributes or {}
    features = dict(query.attributes)
    if not features.get("color") and (attrs.get("color") or card.color):
        features["color"] = attrs.get("color") or card.color
    for key in ("ram_gb", "storage_gb", "region", "sim"):
        if key not in features and attrs.get(key) is not None:
            features[key] = attrs[key]
    query = query.model_copy(update={"attributes": features})
    result = await avito_catalog.search(session, import_id, query, limit=2)
    return [match.item for match in result.matches if match.relation == "exact"]


async def booking_price(session: AsyncSession, import_id: int | None, product: Product) -> int | None:
    exact = await price_variants_for_card(session, import_id, product)
    return int(exact[0].price) if len(exact) == 1 else None


async def bookable_products(session: AsyncSession, cfg: AvitoBotConfig, item_id: int | None,
                            requested: CatalogContext) -> tuple[list[Product], dict[UUID, int]]:
    import_id = await avito_catalog.active_import(session, cfg.price_list)
    target_keys = {match.item.key for result in requested.results for match in result.matches
                   if match.relation == "exact"}
    if not requested.results:
        target_keys = {item.key for item in requested.listing}
    if not target_keys:
        return [], {}

    linked = await linked_product(session, item_id)
    cards = {linked.id: linked} if linked else {}
    if requested.intent.booking_requested:
        for item in requested.items:
            if item.key not in target_keys:
                continue
            for candidate in await search_products(session, item.name, limit=8):
                cards.setdefault(candidate.id, candidate)
    products = []
    prices = {}
    for card in cards.values():
        exact = await price_variants_for_card(session, import_id, card)
        if len(exact) == 1 and exact[0].key in target_keys:
            products.append(card)
            prices[card.id] = int(exact[0].price)
    return products, prices


async def staff_examples(session: AsyncSession, limit: int = 300) -> list[tuple[str, str]]:
    res = await session.execute(
        select(AvitoBotExample.question, AvitoBotExample.answer, AvitoChat.client_name)
        .outerjoin(AvitoChat, AvitoChat.id == AvitoBotExample.chat_id)
        .where(AvitoBotExample.is_active.is_(True)).order_by(AvitoBotExample.created_at.desc()).limit(limit)
    )
    result = []
    for question, answer, participant in res.all():
        masker = PiiMasker(participant)
        redacted = (masker.mask(question), masker.mask(answer))
        # Метки из других диалогов не должны совпасть с обратимыми метками покупателя.
        result.append(tuple(re.sub(r"\[(телефон|карта|почта|адрес|имя) \d+\]", r"[скрыто: \1]", text_) for text_ in redacted))
    return result


# ── Решение ──────────────────────────────────────────────────────────────────

@dataclass
class Decision:
    action: str                     # reply | handoff | silent
    text: str | None = None
    source: str | None = None       # rule | llm | catalog
    rule: AvitoBotRule | None = None
    reason: str | None = None
    delay_seconds: int = 0
    catalog: list[str] = field(default_factory=list)
    order: dict[str, Any] | None = None
    examples_used: int = 0
    cancel_order: bool = False
    search: list[dict[str, Any]] = field(default_factory=list)
    price_reply: bool = False
    quoted_subject: dict[str, Any] | None = None


@dataclass
class CatalogContext:
    intent: avito_catalog.SearchIntent
    results: list[avito_catalog.SearchResult]
    listing: list[CatalogItem] = field(default_factory=list)
    quote: avito_quotes.QuoteRequest | None = None
    search_parse_failed: bool = False

    @property
    def items(self) -> list[CatalogItem]:
        items = {match.item.key: match.item for result in self.results for match in result.matches}
        return list(items.values())


async def quote_product(session: AsyncSession, cfg: AvitoBotConfig, ctx: ChatContext,
                        pending: str, masker: PiiMasker) -> CatalogContext:
    """Единый путь от исходной реплики к предложениям текущего прайса Авито."""
    quote = avito_quotes.price_request(ctx, pending)
    ready = llm_settings(cfg).ready
    intent = avito_catalog.SearchIntent(queries=[])
    if not ready and quote is None:
        return CatalogContext(intent, [])
    if quote and quote.clarification:
        return CatalogContext(intent, [], quote=quote)
    import_id = await avito_catalog.active_import(session, cfg.price_list)
    purchase = avito_quotes.retail_part(pending)
    grounded = []
    if quote and avito_quotes.can_resolve_from_words(purchase) and (
        not quote.queries or quote.queries[0].reference != "explicit"
    ) and re.search(r"[a-zA-Z0-9]", purchase):
        grounded = await avito_catalog.models_in_text(session, import_id, purchase)
        if len(grounded) == 1:
            quote.queries = [avito_quotes.query_from_words(grounded[0], purchase)]
        elif grounded:
            quote.queries = []
    search_parse_failed = False
    if ready and not (quote and quote.queries and not quote.supplement):
        try:
            intent = await extract_search_intent(cfg, ctx, pending, masker)
        except ValueError as exc:
            search_parse_failed = True
            logger.warning("avito_bot_search_intent_invalid", error_type=type(exc).__name__)
        except llm_client.LlmError as exc:
            if quote is None:
                raise
            logger.warning("avito_bot_quote_intent_fallback", error_type=type(exc).__name__)
    if quote is None and intent.price_requested:
        quote = avito_quotes.QuoteRequest([], supplement=True)
    queries = quote.queries if quote and quote.queries else intent.queries
    if quote and quote.has_separate_product and not grounded:
        # Телефон после «чехол для …» и модель в запросе ремонта не являются предметом цены.
        if re.search(r"\b(?:ремонт\w*|замен\w*\s+экран\w*)\b", purchase, re.IGNORECASE):
            queries = []
        elif re.search(r"\b(?:чехол\w*|стекл\w*|кабел\w*|адаптер\w*|зарядк\w*)\b", purchase, re.IGNORECASE):
            queries = [query for query in queries if query.reference == "explicit"
                       and query.category and avito_catalog.category_key(query.category) == "accessory"]
    results = []
    for query in queries:
        if not query.model and query.reference in ("listing", "conversation"):
            subject, discussed = avito_quotes.conversation_subject(ctx)
            reference = subject if query.reference == "conversation" or discussed else avito_catalog.listing_query(ctx.item_title)
            if reference and (not query.brand or
                    avito_catalog.brand_key(query.brand) == avito_catalog.brand_key(reference.brand or "")):
                query = query.model_copy(update={
                    "brand": query.brand or reference.brand,
                    "category": query.category or reference.category,
                    "model": reference.model,
                    "model_id": reference.model_id,
                    "attributes": {**reference.attributes, **query.attributes},
                    "required": list(dict.fromkeys((*reference.required, *query.required))),
                })
        if quote:
            result = await avito_catalog.search(
                session, import_id, query, spread_storage=True, allow_other_models=False,
            )
        else:
            result = await avito_catalog.search(session, import_id, query)
        results.append(result)
    listing = await avito_catalog.listing_items(session, import_id, ctx.item_title) if not results and quote is None else []
    return CatalogContext(intent, results, listing, quote, search_parse_failed)


async def extract_search_intent(cfg: AvitoBotConfig, ctx: ChatContext, pending: str,
                                masker: PiiMasker) -> avito_catalog.SearchIntent:
    system = (
        "Извлеки поисковые запросы на покупку техники из последних реплик покупателя. "
        "Не отвечай покупателю. price_requested=true, если просят цену, её подтверждение или уточнение. "
        "«Почём?», «а на 512?», «а белый?» после разговора о цене требуют поиск. "
        "«Мне нужен чёрный» после списка цветов — выбор варианта обсуждаемой модели, а не просьба оформить бронь. "
        "Сначала товар из новой реплики, затем последний обсуждаемый товар, затем объявление. "
        "«Белый на терабайт сколько?» — укажи цвет white и storage_gb=1024, модель возьми из разговора "
        "или объявления. При смене товара не переноси характеристики предыдущей модели. "
        "«Я сейчас приеду» — сама по себе не просьба назвать цену. Для вопроса без поиска верни queries=[]. "
        "Не включай сдаваемый в trade-in товар, если о покупке именно его не спросили. "
        "Не выдумывай незаданные параметры. На каждый запрошенный вариант — отдельный запрос. "
        "Производитель латиницей, category коротким ключом: smartphone, tablet, computer, headphones, watch, "
        "vacuum, console, camera, accessory или подходящий тип для иной техники. "
        "Модель пиши как в запросе, убери из неё объём, цвет, SIM. "
        "Для смартфона используй ram_gb, storage_gb (целые числа), color, sim, region. "
        "SIM: two_physical, one_physical, physical_esim, esim_only, has_physical. "
        "Для другой техники используй её свойства, не добавляй поля телефона. "
        "booking_requested=true при явном согласии купить, просьбе о брони или продолжении оформления. "
        "В required перечисли ключи условий «только», «обязательно», «без этого не подойдёт». "
        "Если важный параметр неоднозначен, поставь один короткий вопрос в clarification. "
        'Строго JSON: {"queries":[{"brand":"Samsung","category":"smartphone","model":"Galaxy S26 Ultra",'
        '"attributes":{"ram_gb":16,"storage_gb":256,"sim":"two_physical"},"required":["sim"],'
        '"reference":"explicit"}],"clarification":null,"booking_requested":false,"price_requested":true}. '
        "reference: explicit, conversation или listing."
    )
    history = [(author, masker.mask(value)) for author, value in ctx.history]
    meta = f"Объявление: {ctx.item_title or 'неизвестно'}."
    messages = build_messages(system + "\n" + meta, ChatContext(None, None, None, history), HISTORY_LIMIT)
    messages.append({"role": "user", "content": "Реплики, на которые нужно ответить:\n" + masker.mask(pending)})
    raw = await llm_call(cfg, messages)
    intent = avito_catalog.SearchIntent.model_validate_json(raw.strip().removeprefix("```json").removesuffix("```").strip())
    intent.queries = [query.model_copy(update={"model_id": None}) for query in intent.queries]
    return intent


def checked_reply_prices(cfg: AvitoBotConfig, reply: str, item_title: str | None,
                         question: str | None = None, *, items: list[CatalogItem]) -> tuple[str, list[int], bool]:
    return audit_reply_prices(
        reply, items, catalog_vocab(items), SearchIndex(items), trade_in_amounts(cfg.trade_in_prices),
        anchor=item_title, question=question,
    )


def _order_payload(cfg: AvitoBotConfig, raw: dict[str, Any], products: list[Product],
                   masker: PiiMasker, prices: dict[UUID, int]) -> tuple[dict | None, str | None, list[str]]:
    """Проверяет бронь от модели. Возвращает (payload, причина отказа, каких контактов не хватает)."""
    name = " ".join(masker.unmask(str(raw.get("name") or "")).split())[:120]
    phone = normalize_phone(masker.unmask(str(raw.get("phone") or "")))
    email = masker.unmask(str(raw.get("email") or "")).strip()[:255]
    missing = [label for label, ok in (("ФИО", valid_full_name(name)), ("номер телефона", phone is not None)) if not ok]
    if missing:
        return None, None, missing
    payload, problem = _order_item(cfg, raw, products, masker, prices)
    if payload is not None:
        payload.update(name=name, phone=phone, email=email if valid_email(email) else "")
    return payload, problem, []


def _order_item(cfg: AvitoBotConfig, raw: dict[str, Any], products: list[Product], masker: PiiMasker, prices: dict[UUID, int]) -> tuple[dict | None, str | None]:
    try:
        idx = int(raw.get("item")) - 1
    except (TypeError, ValueError):
        return None, "Модель пыталась оформить бронь, но не указала товар"
    if not 0 <= idx < len(products):
        return None, "Модель пыталась оформить бронь на товар не из списка"
    p = products[idx]
    method = "delivery" if str(raw.get("method")).lower() == "delivery" else "pickup"
    address = masker.unmask(str(raw.get("address") or "").strip())[:300]
    if method == "delivery" and len(address) < 5:
        return None, "Бронь с доставкой без адреса"
    price = prices.get(p.id)
    if price is None:
        return None, f"Бронь не оформлена: не найдена точная цена для «{p.name}» в прайсе"
    return {
        "product_id": str(p.id),
        "product_name": p.name,
        "price": price,
        "price_source": "avito_price_list",
        "method": method,
        "address": address or cfg.pickup_address,
        "comment": masker.unmask(str(raw.get("comment") or "").strip())[:300],
    }, None


async def decide(session: AsyncSession, cfg: AvitoBotConfig, ctx: ChatContext, pending_text: str,
                 rule_hits: dict[str, Any], now: datetime | None = None, item_id: int | None = None,
                 order_info: tuple[str, str] | None = None, greet: bool | None = None,
                 requested: CatalogContext | None = None) -> Decision:
    """order_info — (номер, статус) заявки этого диалога: модель знает о ней и может её отменить."""
    if prize_reply := unverified_prize_reply(pending_text, ctx.history):
        return Decision("reply", prize_reply, "rule")
    if address_reply := incomplete_delivery_address_reply(pending_text, ctx.history):
        return Decision("reply", address_reply, "rule")
    if _VISIT.fullmatch(normalize(pending_text)):
        return Decision("reply", "Хорошо, будем ждать.", "rule")
    visit_text, search_text = store_visit_reply(cfg, pending_text)
    if visit_text and not search_text:
        return Decision("reply", visit_text, "rule")
    trade_device = avito_quotes.trade_in_phone(ctx.history, search_text)
    trade_rejection = avito_quotes.trade_in_rejection(trade_device, cfg.trade_in_prices)
    trade_only = trade_device is not None and avito_quotes.retail_part(search_text) == search_text
    if trade_rejection and trade_only:
        if ctx.item_title or ctx.quoted_subject:
            trade_rejection += " Выбранный товар можно купить без обмена."
        return Decision("reply", trade_rejection, "rule")
    now = now or _now()
    rules = await active_rules(session)
    llm = llm_settings(cfg)
    match = match_rule(rules, pending_text, rule_hits, now)

    greet = is_first_reply(ctx) if greet is None else greet
    # Отказ — по последнему сообщению: «не интересует», а потом «где вы находитесь?» — это уже вопрос
    refusal = is_refusal(pending_text.strip().split("\n")[-1])
    if refusal:
        match = None  # «Спасибо, не интересует» — не повод для автоответа «Желаете оформить доставку?»
    if match and match.rule.verbatim and "сдэк" not in normalize(match.rule.answer) and mentions_other_city(pending_text):
        match = None  # «доставите в Питер?» — это скрипт региона (СДЭК), а не московский: отвечает модель
    if match and is_closing_message(pending_text):
        match = None  # завершение диалога — тепло прощается модель, а не автоответ «Желаете оформить…»
    if is_closing_message(pending_text) and bot_farewelled(ctx):
        # На прощание ответили «спасибо»/«и вам» — молчим, не тратя вызов модели
        return Decision("silent", reason="Покупатель ответил на прощание — молчим")

    async def rule_decision(rule: AvitoBotRule) -> Decision:
        import_id = await avito_catalog.active_import(session, cfg.price_list)
        items = await avito_catalog.listing_items(session, import_id, ctx.item_title)
        text_, unknown, _ = checked_reply_prices(cfg, rule.answer.strip(), ctx.item_title, pending_text, items=items)
        if unknown:
            return Decision("handoff", reason=f"Цена в автоответе не подтверждена прайсом ({unknown[0]} ₽)")
        if not greet:
            text_ = strip_greeting(text_) or text_
        return Decision("reply", text_, "rule", rule, delay_seconds=rule.delay_seconds)

    cancelling = bool(order_info) and wants_cancel(pending_text)
    if cancelling:
        match = None  # отмену не перебивает автоответ — отвечает модель (или короткое подтверждение)
        if not llm.ready:
            return Decision("reply", "Заявку отменила. Если передумаете — пишите, с радостью помогу.", "rule")
    masker = PiiMasker(ctx.client_name)
    if requested is None and trade_only:
        requested = CatalogContext(avito_catalog.SearchIntent(queries=[]), [])
    if requested is None:
        try:
            requested = await quote_product(session, cfg, ctx, search_text, masker)
        except llm_client.LlmError as exc:
            if match and match.rule.verbatim and rule_covers(pending_text):
                return await rule_decision(match.rule)
            return Decision("handoff", reason=f"Не удалось разобрать запрос: {exc}"[:200])
    quote = requested.quote
    search_data = avito_quotes.quote_trace(requested.results, bool(quote and not quote.clarification))
    price_text = (quote.clarification or avito_quotes.format_quote(
        requested.results, cfg.card_markup_percent if quote.payment == "card" else None
    )) if quote else None
    if quote and quote.variant_choice and requested.results and all(result.status == "exact" for result in requested.results):
        count = sum(match.relation == "exact" for result in requested.results for match in result.matches)
        intro = "Да, такой вариант есть. Вот цена по прайсу:" if count == 1 else "Подскажу, какие варианты есть по прайсу:"
        price_text = f"{intro}\n{price_text}"
    if price_text and visit_text:
        price_text += f"\n\n{visit_text}"
    if quote and price_text and quote.trade_in:
        if trade_rejection:
            price_text += f"\n\n{trade_rejection}"
        elif trade_device:
            details = "состояние устройства" if "storage_gb" in trade_device.attributes else "объём памяти и состояние устройства"
            price_text += f"\n\nДля предварительной оценки {trade_device.model} подскажите, пожалуйста, {details}."
        else:
            price_text += "\n\nПо trade-in напишите модель, объём памяти и состояние устройства, которое хотите сдать. Уточним оценку."
    if quote and price_text and quote.payment == "card":
        price_text += f"\n\nПри оплате картой — плюс {cfg.card_markup_percent:g}% к розничной цене."
    if quote and price_text and quote.payment == "transfer":
        price_text += "\n\nПо переводу и реквизитам поможет менеджер."
        if not quote.supplement and not requested.intent.booking_requested:
            return Decision("handoff", price_text, "catalog",
                            reason="Покупатель просит уточнить условия по переводу", search=search_data, price_reply=True)
    if quote and not (quote.supplement or requested.intent.booking_requested):
        return Decision("reply", price_text, "catalog", search=search_data, price_reply=True)
    has_product_request = bool(quote or requested.results or requested.intent.clarification)
    if match and match.rule.verbatim and not has_product_request and (not llm.ready or rule_covers(pending_text)):
        return await rule_decision(match.rule)

    if not llm.ready:
        if refusal:
            return Decision("silent", reason="Покупатель отказался")
        if quote:
            return Decision("handoff", price_text, reason="Нужно уточнить дополнительный вопрос покупателя",
                            search=search_data, price_reply=True)
        if match:  # правило «своими словами», но модели нет — отдаём текст правила
            return await rule_decision(match.rule)
        return Decision("handoff", None, reason="Нет подходящего автоответа, а модель не подключена")

    examples = pick_examples(pending_text, await staff_examples(session))

    products, booking_prices = await bookable_products(session, cfg, item_id, requested) if cfg.orders_enabled else ([], {})
    lines = [p.name for p in products]
    items = requested.items
    if not quote and requested.intent.clarification and not requested.results:
        clarification, replaced = sanitize_reply(masker.unmask(requested.intent.clarification))
        clarification = avito_quotes.remove_buyer_voice(clarification, pending_text)
        if clarification and not replaced and not checked_reply_prices(cfg, clarification, None, items=[])[1]:
            if not greet:
                clarification = strip_greeting(clarification)
            if clarification:
                return Decision("reply", clarification, "llm")
        return Decision("reply", "Подскажите, пожалуйста, какая модель вам нужна?", "rule")
    anchor = None
    if len(requested.results) == 1 and items and requested.results[0].status in ("exact", "same_model"):
        exact = [match.item for match in requested.results[0].matches if match.relation == "exact"]
        if len(exact) == 1:
            item = exact[0]
            anchor = " ".join(value for value in (item.name, item.attributes.get("country"), item.attributes.get("sim"))
                              if value)
        else:
            anchor = items[0].name if len(items) == 1 else family_name(items[0])
    if not requested.results:
        items = requested.listing
        anchor = ctx.item_title

    def outcome(action: str, reply: str | None = None, *args, **kwargs) -> Decision:
        kwargs.setdefault("search", search_data)
        if price_text:
            reply = "\n\n".join(part for part in (price_text, reply) if part)
            kwargs["price_reply"] = True
            if action == "silent":
                action = "reply"
        elif visit_text:
            reply = "\n\n".join(part for part in (visit_text, reply) if part)
            if action == "silent":
                action = "reply"
        return Decision(action, reply, *args, **kwargs)

    masked_ctx = ChatContext(ctx.item_title, None if price_text else ctx.item_price, None,
                             [(a, masker.mask(t)) for a, t in ctx.history])
    omitted_match_fields = {"source_line", "source_number"} | ({"price_rub"} if price_text else set())
    system = build_system_prompt(
        PromptConfig(cfg.persona_name, cfg.style, cfg.knowledge, cfg.handoff_topics, cfg.greeting,
                     cfg.human_mode, cfg.allow_emoji, cfg.off_topic_silent),
        rules, masked_ctx, lines, now, hint=match.rule.answer if match else None,
        examples=examples,
        orders_enabled=cfg.orders_enabled, pickup_address=cfg.pickup_address,
        order_note=order_note_for_prompt(*order_info) if order_info else None,
        greet=greet,
        price_overview=[] if price_text else price_lines(items),
        search_context=[{**result, "matches": [
            {key: value for key, value in match.items() if key not in omitted_match_fields}
            for match in result["matches"]
        ]} for result in search_data],
        trade_in=cfg.trade_in_prices,
    )
    if trade_device:
        size = trade_device.attributes.get("storage_gb")
        device = f"{trade_device.model}, {size} ГБ" if size else trade_device.model
        system += f"\nУстройство покупателя для сдачи по trade-in: {device}. Это отдельный товар. Не подставляй его в запрос покупки."
    if quote:
        system += ("\nБэкенд уже включит цену, условия распознанного способа оплаты и следующий шаг по trade-in. "
                   "В поле reply пиши только ответы на остальные вопросы покупателя. Не вставляй строку товара с ценой, "
                   "даже если она есть в истории, результатах поиска или примерах. Для совпадения exact цена уже подтверждена. "
                   "Не обещай уточнить цену или передать вопрос о цене менеджеру.")
    system += ("\nТы отвечаешь как сотрудник магазина. Не обращайся к продавцу от лица покупателя, "
               "не пересказывай его сообщение вместо ответа и не придумывай банковские реквизиты.")
    try:
        messages = build_messages(system, masked_ctx, HISTORY_LIMIT)
        if quote and not requested.intent.booking_requested and (question := avito_quotes.supplemental_question(search_text)):
            messages[-1]["content"] = masker.mask(question)
        elif visit_text:
            messages[-1]["content"] = masker.mask(search_text)
        raw = await llm_call(cfg, messages)
    except llm_client.LlmError as exc:
        return outcome("handoff", None, reason=f"Модель не ответила: {exc}"[:200], catalog=lines)

    verdict = parse_llm_answer(raw)
    reply = masker.unmask(verdict.reply)
    if reply and (not greet or quote):
        reply = strip_greeting(reply)   # сегодня уже здоровались — второй раз не надо
    filtered = avito_quotes.remove_buyer_voice(reply, pending_text)
    if reply and not filtered:
        return outcome("handoff", reason="Модель сформулировала реплику от лица покупателя", catalog=lines)
    reply = filtered
    if cfg.off_topic_silent and verdict.off_topic and not verdict.order:
        # Сообщение целиком не по теме: как живой менеджер — прочитал и промолчал.
        return outcome("silent", reason="Не по теме магазина — бот не отвечает", catalog=lines,
                        examples_used=len(examples))
    reply, replaced = sanitize_reply(reply)
    if replaced:
        logger.warning("avito_bot_reply_replaced", reason="off_topic_or_too_long")
    if replaced and reply:
        verdict.order = None
        if cfg.off_topic_silent:
            return outcome("silent", reason="Ответ модели ушёл в сторону от магазина — бот промолчал",
                            catalog=lines, examples_used=len(examples))
    if price_text and reply:
        reply = avito_quotes.without_retail_prices(reply)
        if quote and quote.trade_in:
            reply = avito_quotes.without_trade_in_restatement(reply)
    if reply:
        # Контроль цен: каждая названная розничная цена — из прайса; устаревшую исправляем,
        # выдуманную не отправляем вовсе — зовём человека
        prices = {"items": items, "vocab": catalog_vocab(items), "index": SearchIndex(items)}
        if prices["items"]:
            # Контроль цветов: цвет, которого нет у этой модели в прайсе, — выдумка, зовём человека
            bad_colors = audit_reply_colors(reply, prices["items"], prices["vocab"], prices["index"],
                                            anchor=anchor)
            if bad_colors:
                logger.warning("avito_bot_color_not_in_list", colors=bad_colors)
                return outcome("handoff", None, "llm", match.rule if match else None,
                                reason=f"Модель назвала цвет «{bad_colors[0]}», которого нет в прайсе у этой модели",
                                catalog=lines, examples_used=len(examples))
        reply, unknown_prices, price_fixed = checked_reply_prices(cfg, reply, anchor, pending_text, items=items)
        if unknown_prices:
            logger.warning("avito_bot_price_not_in_list", prices=unknown_prices)
            return outcome("handoff", None, "llm", match.rule if match else None,
                            reason=f"Модель назвала цену не из прайса ({unknown_prices[0]} ₽) — проверьте прайс",
                            catalog=lines, examples_used=len(examples))
        if price_fixed:
            logger.warning("avito_bot_price_corrected", hint="цена в ответе заменена на актуальную из прайса")
        fact = unsupported_variant_fact(reply, items, anchor, prices["vocab"], prices["index"])
        if fact:
            return outcome("reply", f"По прайсу пока не могу подтвердить {fact}. Подскажите, пожалуйста, это обязательное условие?",
                           "rule", catalog=lines)
        if is_own_repeat(reply, ctx):
            # Дословный повтор своего же сообщения — не шлём дубль
            logger.warning("avito_bot_repeat", hint="модель повторила своё прошлое сообщение дословно")
            return outcome("silent", reason="Модель повторила своё прошлое сообщение — дубль не шлём",
                            catalog=lines, examples_used=len(examples))
    first_part = (split_reply(reply) or [reply])[0] if cfg.human_mode else reply
    delay = (typing_delay(first_part, cfg.reply_delay_min, cfg.reply_delay_max) if cfg.human_mode
             else human_delay(cfg.reply_delay_min, cfg.reply_delay_max))
    rule = match.rule if match else None
    order, order_problem, missing = (None, None, [])
    if verdict.order:
        if cfg.orders_enabled and products:
            order, order_problem, missing = _order_payload(cfg, verdict.order, products, masker, booking_prices)
        else:
            order_problem = "Для выбранного варианта нет карточки, доступной для оформления брони"
    if missing:
        # Модель поспешила с заявкой: без ФИО и телефона не оформляем и не говорим «забронировала»
        has_email = bool(str(verdict.order.get("email") or "").strip())
        ask = ("Отлично, оформлю заявку! Напишите, пожалуйста, " + " и ".join(missing)
               + ("" if has_email else ". Почту — по желанию") + ".")
        return outcome("reply", ask, "llm", rule, delay_seconds=delay, catalog=lines, examples_used=len(examples))
    if _BOOKING_CONFIRMED.search(normalize(reply)) and not order and not (order_info and order_info[1] in CANCELABLE):
        if not order_problem:
            return outcome("reply", "Могу помочь с бронью. Подскажите, пожалуйста, хотите оформить заявку?", "rule")
        reply = ""
    if verdict.handoff or order_problem:
        if not reply and cfg.handoff_message:
            reply, unknown, _ = checked_reply_prices(cfg, cfg.handoff_message, anchor, items=items)
            if unknown:
                reply = ""
        # Сбой с заявкой — молча зовём человека; сам покупатель попросил менеджера — короткая фраза модели
        decision = outcome("handoff", None if order_problem else (reply or None), "llm", rule,
                            reason=order_problem or verdict.reason or "Модель просит сотрудника", delay_seconds=delay,
                            catalog=lines, examples_used=len(examples))
    elif not reply:
        if requested.search_parse_failed and not price_text and not visit_text:
            decision = outcome("reply", "Подскажите, пожалуйста, какая модель вас интересует или что хотите узнать?", "rule")
        else:
            decision = outcome("silent", reason="Модель решила, что отвечать не нужно", catalog=lines, examples_used=len(examples))
    else:
        decision = outcome("reply", reply, "llm", rule, delay_seconds=delay, catalog=lines, order=order,
                            examples_used=len(examples))
    decision.cancel_order = bool(verdict.cancel_order and wants_cancel(pending_text)
                                 and order_info and order_info[1] in CANCELABLE)
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
    subject = None
    for msg in reversed(msgs):
        if msg.status != "sent":
            continue
        if msg.author == "staff":
            break
        if msg.quoted_subject is not None:
            subject = msg.quoted_subject
            break
    return ChatState(ChatContext(chat.item_title, chat.item_price, chat.client_name, sent, subject),
                     "\n".join(pending), last_client, draft)


async def _cancel_pending_bot(session: AsyncSession, chat_id: UUID) -> None:
    """Неотправленные ответы бота больше не к месту — покупатель написал новое или ответил человек."""
    await session.execute(
        update(AvitoMessage).where(AvitoMessage.chat_id == chat_id, AvitoMessage.status.in_(("draft", "scheduled")))
        .values(status="discarded")
    )


# ── Обработка диалога (вызывает avito_bot_worker) ────────────────────────────

async def process_chat(chat_id: UUID, lease: datetime | None = None) -> None:
    """Ответ в диалоге. Любой сбой — бот молчит, отмечает прочитанным и зовёт менеджера."""
    try:
        await _process_chat(chat_id, lease)
    except Exception as exc:  # noqa: BLE001
        logger.exception("avito_bot_process_failed", chat_id=str(chat_id), error=str(exc)[:300])
        await _fail_to_human(chat_id, exc, lease)


async def _fail_to_human(chat_id: UUID, exc: Exception, lease: datetime | None = None) -> None:
    try:
        async with AsyncSessionFactory() as session:
            cfg = await load_config(session)
            chat = await session.get(AvitoChat, chat_id, with_for_update=True)
            if chat is None or chat.needs_human:
                return
            if lease is not None and chat.reply_due_at != lease:
                return
            chat.needs_human = True
            chat.human_reason = "Сбой бота — ответьте покупателю сами"
            chat.reply_due_at = None
            if not chat.is_simulated:
                log_event(session, chat.id, "handoff", f"Сбой бота: {exc}"[:200])
            name, item, avito_id, simulated = chat.client_name, chat.item_title, chat.avito_chat_id, chat.is_simulated
            await session.commit()
        if not simulated and cfg.avito_connected_at:
            try:
                await avito_client.mark_read(avito_creds(cfg), avito_id)
            except Exception:  # noqa: BLE001
                pass
        await send_push_to_all("⚠️ Авито: сбой бота", f"{name or 'Покупатель'} · {item or ''} · ответьте сами",
                               url=f"/admin?tab=avito&chat={chat_id}", tag=f"avito-{chat_id}", kind="avito_error")
    except Exception as exc2:  # noqa: BLE001 — даже база недоступна: только в лог
        logger.error("avito_bot_fail_to_human_failed", chat_id=str(chat_id), error=str(exc2)[:300])


@dataclass
class PlannedReply:
    text: str
    source: str | None
    decision: Decision | None
    whole: bool = False


async def plan_chat_reply(session: AsyncSession, cfg: AvitoBotConfig, ctx: ChatContext, pending: str,
                          rule_hits: dict[str, Any], *, item_id: int | None = None,
                          order_info: tuple[str, str] | None = None,
                          greet: bool | None = None) -> tuple[Decision, list[PlannedReply]]:
    greet = is_first_reply(ctx) if greet is None else greet
    decision = await decide(session, cfg, ctx, pending, rule_hits, item_id=item_id,
                            order_info=order_info, greet=greet)
    if decision.price_reply:
        decision.quoted_subject = avito_quotes.quoted_subject(decision.search)
    if decision.order and not _BOOKING_CONFIRMED.search(normalize(decision.text or "")):
        decision.text = "\n\n".join(part for part in (decision.text, "Заявка оформлена.") if part)
    if decision.action not in ("reply", "handoff"):
        return decision, []
    if decision.action == "handoff" and not decision.text:
        if not cfg.handoff_message.strip():
            return decision, []
        decision.text = cfg.handoff_message.strip()
    if greet:
        greeting = greeting_text(cfg.greeting.strip() or DEFAULT_GREETING, cfg.persona_name)
        separator = "\n\n" if cfg.human_mode else "\n"
        body = strip_greeting(decision.text) if decision.text else ""
        listing_terms = normalize(ctx.item_title or "")
        trade_in_ad = item_id in cfg.trade_in_listing_ids or re.search(
            r"\b(?:цена|стоимость)\s+(?:с|по|при)\s+(?:trade in|трейд ин)|\bс учетом\s+(?:trade in|трейд ин)",
            listing_terms,
        )
        notice = "Цена в объявлении действует при сдаче устройства по trade-in." if trade_in_ad else ""
        decision.text = separator.join(part for part in (greeting, notice, body) if part)
    if not decision.text:
        return decision, []
    return decision, [PlannedReply(decision.text, decision.source, decision, whole=decision.price_reply)]


async def _process_chat(chat_id: UUID, lease: datetime | None = None) -> None:
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        chat = await session.get(AvitoChat, chat_id)
        if chat is not None and lease is not None and chat.reply_due_at != lease:
            return
        # Позвали человека — бот в этом диалоге молчит, пока сотрудник не вернёт его
        if chat is None or chat.mode != "bot" or chat.needs_human or not automatic_allowed(cfg, chat):
            await clear_reply_lease(session, chat_id, lease)
            return
        state = await chat_state(session, chat)
        if not state.pending.strip():
            await clear_reply_lease(session, chat_id, lease)
            return
        if cfg.human_mode and not chat.is_simulated and cfg.avito_connected_at:
            # Как человек: сначала «прочитано», потом печатает ответ
            await avito_client.mark_read(avito_creds(cfg), chat.avito_chat_id)
        order_info = await _order_info(session, chat)
        decision, planned = await plan_chat_reply(
            session, cfg, state.ctx, state.pending, dict(chat.rule_hits or {}), item_id=chat.item_id,
            order_info=order_info, greet=not await _greeted_recently(session, chat),
        )
        await session.commit()

    push: tuple[str, str] | None = None
    push_kind = "avito"
    read_now = False
    extra_pushes: list[tuple[str, str]] = []
    async with AsyncSessionFactory() as session:
        current_cfg = await load_config(session)
        chat = await session.get(AvitoChat, chat_id, with_for_update=True)
        if chat is not None and lease is not None and chat.reply_due_at != lease:
            return
        if chat is None or chat.mode != "bot" or chat.needs_human or not automatic_allowed(current_cfg, chat):
            await clear_reply_lease(session, chat_id, lease)
            return
        # Пока думали, покупатель дописал — новый срок уже стоит, ответим на всё сразу
        if (await chat_state(session, chat)).last_client_id != state.last_client_id:
            return
        chat.reply_due_at = None
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
            push = ("⚠️ Авито: нужен менеджер", f"{chat.client_name or 'Покупатель'} · {chat.item_title or ''} · {chat.human_reason}")
            push_kind = "avito_error"
            read_now = not cfg.human_mode and not chat.is_simulated and bool(cfg.avito_connected_at)
            avito_chat_id = chat.avito_chat_id

        send_at = None
        base_time = _now()
        debounce = SIM_DEBOUNCE_SECONDS if chat.is_simulated else cfg.collect_messages_seconds
        for n, plan in enumerate(planned):
            text_, source, dec = plan.text, plan.source, plan.decision
            rule_id = dec.rule.id if dec and dec.rule else None
            order = dec.order if dec else None
            item_base = base_time + timedelta(milliseconds=100 * n)   # порядок: шаблон раньше ответа
            if cfg.mode == "draft" and not chat.is_simulated:
                # Черновик — одним сообщением; ответ модели разделится на части при отправке
                draft_source = "llm_open" if plan.whole and source == "llm" else source
                session.add(AvitoMessage(chat_id=chat.id, author="bot", text=text_, source=draft_source, rule_id=rule_id,
                                         order_payload=order, quoted_subject=dec.quoted_subject if dec else None,
                                         decision_trace=dec.search if dec and dec.search else None,
                                         status="draft", created_at=item_base))
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
            parts = planned_parts(cfg, plan)
            for i, part in enumerate(parts):
                if i:
                    send_at += timedelta(seconds=_next_part_delay(cfg, part, chat.is_simulated))
                message = _part_message(chat.id, part, i, len(parts), source, rule_id, order,
                                        "scheduled", send_at, item_base)
                if dec and i == 0:
                    message.quoted_subject = dec.quoted_subject
                    message.decision_trace = dec.search or None
                session.add(message)
        await session.commit()

    if read_now:   # позвали человека — сообщение покупателя отмечаем прочитанным
        try:
            await avito_client.mark_read(avito_creds(cfg), avito_chat_id)
        except Exception:  # noqa: BLE001
            pass
    for title, body in extra_pushes:
        await send_push_to_all(title, body, url="/app", tag=f"avito-order-{chat_id}", kind="avito")
    if push:
        await send_push_to_all(push[0], push[1], url=f"/admin?tab=avito&chat={chat_id}", tag=f"avito-{chat_id}",
                               kind=push_kind)


def planned_parts(cfg: AvitoBotConfig, plan: PlannedReply) -> list[str]:
    if plan.whole or (plan.decision and plan.decision.order):
        return [plan.text]
    return _parts(cfg, plan.text, plan.source)


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
        cfg = await load_config(session)
        products = (await session.scalars(
            select(Product).join(AvitoItemLink, AvitoItemLink.product_id == Product.id)
            .where(Product.is_active.is_(True))
            .order_by(Product.is_featured.desc(), Product.updated_at.desc())
        )).unique()
        import_id = await avito_catalog.active_import(session, cfg.price_list)
        match = None
        for product in products:
            price = await booking_price(session, import_id, product)
            if price is not None:
                match = product, price
                break
        if match is None:
            raise ActionError("Нет привязанной карточки с точной ценой из прайса")
        product, price = match
        chat = AvitoChat(id=uuid4(), avito_chat_id=f"sim-{uuid4().hex[:12]}", is_simulated=True,
                         client_name="Тестовый покупатель", item_title=product.name)
        session.add(chat)
        await session.flush()
        result = await create_chat_order(session, chat, {
            "product_id": str(product.id), "method": "pickup", "address": "",
            "name": "Тестов Тест Тестович", "phone": "+79990000000", "email": "", "comment": "Проверка пометки в PWA",
            "price": price, "price_source": "avito_price_list",
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
    """Покупатель отменил заявку в чате: заказ → «Отменён», в заказе — комментарий.
    Возвращает текст пуша менеджеру (None — отменять нечего).
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
    """Сохраняет заявку из чата по актуальной цене. Остаток ведёт магазин. Строка — ошибка."""
    from src.app.api.routers.gta6 import GIFT_NAME, gift_product_ids  # поздний импорт: роутеры тянут много

    product = await session.get(Product, UUID(payload["product_id"]), with_for_update=True)
    if product is None or not product.is_active:
        return "товар больше не продаётся"
    planned_price = payload.get("price") if payload.get("price_source") == "avito_price_list" else None
    cfg = await load_config(session)
    import_id = await avito_catalog.active_import(session, cfg.price_list)
    price = await booking_price(session, import_id, product)
    if price is None:
        return "не найдена точная цена в прайсе"
    price = Decimal(str(price))
    if planned_price is not None and Decimal(str(planned_price)) != price:
        return f"цена изменилась на {price:,.0f} ₽ — согласуйте с покупателем".replace(",", " ")
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
    await session.flush()
    await session.refresh(order, attribute_names=["items", "comments"])
    return order


async def _send(cfg: AvitoBotConfig, chat: AvitoChat, msg: AvitoMessage, session: AsyncSession | None = None) -> str | None:
    """Отправить в Авито (тренировочные — только в базу). None — успех, иначе текст ошибки."""
    if chat.is_simulated:
        return None
    try:
        resp = await avito_client.send_text(avito_creds(cfg), chat.avito_chat_id, msg.text)
    except avito_client.SendUnconfirmed:
        if msg.send_started_at is not None:
            raise
        return "Авито не подтвердил отправку. Проверьте переписку перед повтором."
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


async def _verify_outgoing(session: AsyncSession, cfg: AvitoBotConfig, chat: AvitoChat, msg: AvitoMessage) -> bool:
    if msg.avito_message_id:
        return True
    try:
        recent = await avito_client.list_messages(avito_creds(cfg), chat.avito_chat_id)
    except avito_client.AvitoError:
        return False
    possible = []
    for remote in recent:
        message_id = remote.get("id")
        created = remote.get("created")
        own = remote.get("direction") == "out" or avito_client.same_id(remote.get("author_id"), cfg.avito_user_id)
        if (message_id and own and isinstance(created, (int, float))
                and int(msg.send_started_at.timestamp()) <= created <= msg.send_started_at.timestamp() + 45
                and (remote.get("content") or {}).get("text") == msg.text):
            possible.append(str(message_id))
    if len(possible) != 1 or await session.scalar(select(AvitoMessage.id).where(
        AvitoMessage.avito_message_id == possible[0]
    )):
        return False
    msg.avito_message_id = possible[0]
    return True


async def deliver_message(session: AsyncSession, cfg: AvitoBotConfig, chat: AvitoChat, msg: AvitoMessage) -> tuple[str | None, Order | None]:
    """Фиксирует заявку, отправляет сообщение и засчитывает правило. Возвращает (ошибка, заказ)."""
    if not automatic_allowed(cfg, chat):
        msg.status = "discarded"
        return "Автоответы по объявлению отключены", None
    order = None
    if msg.order_payload:
        # Блокировка диалога и фиксация заявки до отправки позволяют безопасно повторить
        # отправку при сетевой ошибке без второй заявки.
        chat = await session.get(AvitoChat, chat.id, with_for_update=True)
        chat_id, message_id = chat.id, msg.id
        try:
            if chat.order_id is None:
                result = await create_chat_order(session, chat, msg.order_payload)
                if isinstance(result, str):
                    chat.needs_human = True
                    chat.human_reason = f"Бронь не оформилась: {result}"[:200]
                    msg.status = "failed"
                    msg.error = chat.human_reason
                    return msg.error, None
                order = result
                chat.order_id = order.id
                chat.order_number = order.order_number
                msg.order_payload = {**msg.order_payload, "saved_order_id": str(order.id)}
                if not chat.is_simulated:
                    log_event(session, chat.id, "order", f"{order.order_number} · {msg.order_payload.get('product_name', '')}")
            elif msg.order_payload.get("saved_order_id") != str(chat.order_id):
                chat.needs_human = True
                chat.human_reason = "Бронь не оформлена: в диалоге уже есть заявка"
                msg.status = "failed"
                msg.error = chat.human_reason
                return msg.error, None
            await session.commit()
        except Exception:
            logger.exception("avito_bot_order_save_failed", chat_id=str(chat_id))
            await session.rollback()
            msg = await session.get(AvitoMessage, message_id, with_for_update=True)
            chat = await session.get(AvitoChat, chat_id, with_for_update=True)
            chat.needs_human = True
            chat.human_reason = "Бронь не оформилась: ошибка сохранения"
            msg.status = "failed"
            msg.error = chat.human_reason
            return msg.error, None
        # После фиксации проверяем, что сотрудник или покупатель не отменил сообщение.
        cfg = await load_config(session, lock="read")
        chat = await session.get(AvitoChat, chat_id, with_for_update=True)
        msg = await session.get(AvitoMessage, message_id, with_for_update=True)
        if msg is None or chat is None:
            raise ActionError("Сообщение или диалог удалены")
        if msg.status not in ("draft", "scheduled"):
            return "Сообщение отменено", order
        saved_order = await session.get(Order, chat.order_id)
        if saved_order is None or saved_order.status == "cancelled":
            msg.status = "discarded"
            return "Заявка отменена до отправки", order
    if not automatic_allowed(cfg, chat):
        msg.status = "discarded"
        return "Автоответы по объявлению отключены", order
    if chat.is_simulated:
        error = await _send(cfg, chat, msg, session)
    else:
        try:
            if msg.send_started_at is not None:
                if msg.status == "draft" and _now() - msg.send_started_at < timedelta(seconds=60):
                    return "Отправка уже выполняется. Проверьте статус через минуту.", order
                raise avito_client.SendUnconfirmed()
            chat_id, message_id = chat.id, msg.id
            msg.send_started_at = _now()
            await session.commit()
            cfg = await load_config(session, lock="read")
            chat = await session.get(AvitoChat, chat_id, with_for_update=True, populate_existing=True)
            msg = await session.get(AvitoMessage, message_id, with_for_update=True, populate_existing=True)
            if msg is None or chat is None:
                raise ActionError("Сообщение или диалог удалены")
            if msg.status not in ("draft", "scheduled"):
                return "Сообщение отменено до отправки", order
            if not automatic_allowed(cfg, chat):
                msg.status = "discarded"
                return "Сообщение отменено до отправки", order
            error = await _send(cfg, chat, msg, session)
        except avito_client.SendUnconfirmed:
            error = None
            if not await _verify_outgoing(session, cfg, chat, msg):
                error = "Авито не подтвердил отправку. Проверьте переписку перед повтором."
                msg.status = "failed"
                msg.error = error
                chat.needs_human = True
                chat.human_reason = error
                log_event(session, chat.id, "send_failed", error)
                await session.flush()
                await _cancel_pending_bot(session, chat.id)
                return error, order
        msg.send_started_at = None
    if error:
        return error, order
    msg.status = "sent"
    msg.sent_at = _now()
    msg.error = None
    _touch(chat, msg.text)
    if msg.rule_id is not None:
        hits = dict(chat.rule_hits or {})
        hits[str(msg.rule_id)] = int(hits.get(str(msg.rule_id), 0)) + 1
        chat.rule_hits = hits
        await session.execute(update(AvitoBotRule).where(AvitoBotRule.id == msg.rule_id).values(hits=AvitoBotRule.hits + 1))
    return None, order


async def deliver_due_message(message_id: UUID) -> None:
    """Отправка одного запланированного сообщения (обработчик уже взял его в работу)."""
    push: tuple[str, str] | None = None
    order: Order | None = None
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session, lock="read")
        chat_id = await session.scalar(select(AvitoMessage.chat_id).where(AvitoMessage.id == message_id))
        chat = await session.get(AvitoChat, chat_id, with_for_update=True) if chat_id else None
        msg = await session.get(AvitoMessage, message_id, with_for_update=True)
        if msg is None or msg.status != "scheduled":
            return
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
        if error and msg.status in ("failed", "discarded"):
            if chat.needs_human:
                push = ("Авито: проверьте диалог", f"{chat.client_name or 'Покупатель'} · {chat.human_reason}")
        elif error:
            msg.attempts += 1
            msg.error = error
            if msg.attempts < SEND_RETRIES:
                msg.send_at = _now() + timedelta(seconds=15 * msg.attempts)
            else:
                msg.status = "failed"
                chat.needs_human = True
                chat.human_reason = "Не удалось отправить ответ в Авито"
                log_event(session, chat.id, "send_failed", error)
                push = ("⚠️ Авито: ответ не отправился", f"{chat.client_name or 'Покупатель'}: {error[:120]}")
        elif chat.needs_human and chat.human_reason and chat.human_reason.startswith("Бронь"):
            push = ("⚠️ Авито: бронь не оформилась", f"{chat.client_name or 'Покупатель'} · {chat.human_reason}")
        await session.commit()
        chat_id = chat.id
    if order is not None:
        await send_order_push(order)
    if push:
        await send_push_to_all(push[0], push[1], url=f"/admin?tab=avito&chat={chat_id}", tag=f"avito-{chat_id}",
                               kind="avito_error")


def _touch(chat: AvitoChat, text_: str) -> None:
    chat.last_message_text = text_[:300]
    chat.last_message_at = _now()


# ── Входящие ─────────────────────────────────────────────────────────────────

def _system_patterns(cfg: AvitoBotConfig) -> list[str]:
    return [p.strip() for p in cfg.system_patterns.splitlines() if p.strip()]


async def enqueue_webhook(session: AsyncSession, payload: dict[str, Any]) -> None:
    body = payload.get("payload")
    if not isinstance(body, dict) or body.get("type") not in (None, "message"):
        return
    value = body.get("value")
    if not isinstance(value, dict) or not value.get("chat_id"):
        return
    chat_id = str(value["chat_id"])
    if len(chat_id) > 120:
        return
    identity = [chat_id, str(value["id"])] if value.get("id") else value
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    await session.execute(insert(AvitoWebhookEvent).values(key=key, chat_id=chat_id, payload=payload).on_conflict_do_nothing())


async def claim_webhook_events(limit: int) -> list[tuple[str, dict]]:
    async with AsyncSessionFactory.begin() as session:
        result = await session.execute(text(
            "UPDATE avito_webhook_events SET due_at = now() + interval '3 minutes' WHERE key IN ("
            " SELECT e.key FROM avito_webhook_events e WHERE e.due_at <= now()"
            " AND NOT EXISTS (SELECT 1 FROM avito_webhook_events prior WHERE prior.chat_id = e.chat_id"
            "                 AND (prior.created_at, prior.key) < (e.created_at, e.key))"
            " ORDER BY e.created_at, e.key LIMIT :limit FOR UPDATE OF e SKIP LOCKED) RETURNING key, payload"
        ), {"limit": limit})
        return [(row.key, row.payload) for row in result]


async def process_webhook_event(key: str, payload: dict) -> None:
    await handle_webhook(payload)
    async with AsyncSessionFactory.begin() as session:
        await session.execute(delete(AvitoWebhookEvent).where(AvitoWebhookEvent.key == key))


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
    """В новом диалоге представляемся, даже если уже писали покупателю по другому объявлению."""
    since = _now() - GREET_EVERY
    res = await session.execute(
        select(AvitoMessage.id).where(
            AvitoMessage.chat_id == chat.id, AvitoMessage.author.in_(("bot", "staff")),
            AvitoMessage.status == "sent", AvitoMessage.created_at >= since,
        ).limit(1)
    )
    return res.first() is not None


async def _import_history(session: AsyncSession, cfg: AvitoBotConfig, chat: AvitoChat, account_id: Any,
                          skip_id: str | None) -> None:
    """Новый для бота чат мог начаться в Авито раньше: подтягиваем последние сообщения, чтобы бот
    видел разговор и не повторял приветствие в том же чате."""
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
    cancel_push = None
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session)
        # Both the webhook and polling can deliver the same chat, including the first message.
        await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:chat_key, 0))"),
                              {"chat_key": f"avito-incoming:{avito_chat_id}"})
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
        if (not chat.client_name or chat.item_id is None or not chat.item_title) and avito_creds(cfg).ready and not chat.is_simulated:
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
        if listing_allowed(cfg, chat.item_id):
            cancel_push = await _phrase_cancel(session, chat, text_)
        if chat.mode == "bot" and not chat.needs_human and automatic_allowed(cfg, chat):
            chat.reply_due_at = _now() + timedelta(seconds=cfg.collect_messages_seconds)
        else:
            chat.reply_due_at = None
        await session.commit()
    if cancel_push:
        await send_push_to_all(cancel_push[0], cancel_push[1], url="/app", tag=f"avito-order-{avito_chat_id}", kind="avito")
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
                             client_name=client_name, item_title=item_title, item_price=item_price,
                             item_id=await test_item_id(session, item_title))
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
        await send_push_to_all(cancel_push[0], cancel_push[1], url="/app", tag=f"avito-order-{cid}", kind="avito")
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
            "   AND c.reply_due_at IS NULL AND (c.is_simulated OR (:live AND"
            "            (:all_items OR c.item_id = ANY(CAST(:item_ids AS bigint[])))))"
            "   AND c.last_message_at <= now() - make_interval(mins => :after)"
            "   AND c.last_message_at >= now() - make_interval(hours => :window)"
            "   AND (SELECT m.author || ':' || coalesce(m.source, '') FROM avito_messages m"
            "        WHERE m.chat_id = c.id AND m.status = 'sent' AND m.author <> 'system' ORDER BY m.created_at DESC LIMIT 1)"
            "       IN ('bot:rule', 'bot:llm', 'bot:catalog', 'staff:staff', 'staff:avito')"  # после рассылки не напоминаем
            "   AND EXISTS (SELECT 1 FROM avito_messages m WHERE m.chat_id = c.id AND m.author = 'client')"
            "   AND NOT EXISTS (SELECT 1 FROM avito_messages m WHERE m.chat_id = c.id AND m.status IN ('draft', 'scheduled'))"
            " ORDER BY c.last_message_at LIMIT :limit FOR UPDATE SKIP LOCKED) RETURNING id"
        ), {"live": cfg.enabled, "all_items": cfg.listing_scope == "all", "item_ids": cfg.allowed_listing_ids, "after": cfg.reminder_after_minutes, "window": cfg.reminder_window_hours, "limit": limit})
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
        if chat is None or not automatic_allowed(cfg, chat):
            return 0
        import_id = await avito_catalog.active_import(session, cfg.price_list)
        items = await avito_catalog.listing_items(session, import_id, chat.item_title)
        state = await chat_state(session, chat)
        last_client = next((t for a, t in reversed(state.ctx.history) if a == "client"), "")
        text_: str | None = None
        reason: str | None = None
        if is_refusal(last_client):
            reason = "покупатель отказался"
        elif cfg.reminder_use_llm and llm_settings(cfg).ready:
            masker = PiiMasker(chat.client_name)
            ctx = ChatContext(chat.item_title, chat.item_price, None, [(a, masker.mask(t)) for a, t in state.ctx.history])
            try:
                raw = await llm_call(cfg, build_reminder_messages(
                    PromptConfig(cfg.persona_name, cfg.style, cfg.knowledge, cfg.handoff_topics), ctx,
                    price_lines(items), _now()))
                verdict = parse_llm_answer(raw)
                text_ = masker.unmask(verdict.reply) or None
                reason = None if text_ else (verdict.reason or "модель решила не напоминать")
            except llm_client.LlmError as exc:
                reason = f"модель не ответила: {exc}"
        else:
            text_ = render_reminder(cfg.reminder_template, chat.item_title, chat.client_name)

        if text_:
            text_, unknown, _ = checked_reply_prices(cfg, text_, chat.item_title, items=items)
            if unknown:
                text_, reason = None, "Цена в напоминании не подтверждена прайсом"
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


async def approve_draft(message_id: UUID, text_: str | None, confirm_order: bool = False) -> None:
    order: Order | None = None
    async with AsyncSessionFactory() as session:
        cfg = await load_config(session, lock="read")
        chat_id = await session.scalar(select(AvitoMessage.chat_id).where(AvitoMessage.id == message_id))
        chat = await session.get(AvitoChat, chat_id, with_for_update=True) if chat_id else None
        msg = await session.get(AvitoMessage, message_id, with_for_update=True)
        if chat is None or msg is None or msg.status != "draft":
            raise ActionError("Черновик уже отправлен или устарел")
        original = msg.text
        edited = bool(text_ and text_.strip() != msg.text)
        if msg.order_payload and not confirm_order and not edited:
            raise ActionError("Для этого черновика отдельно подтвердите оформление брони")
        if confirm_order and (not msg.order_payload or edited):
            raise ActionError("Бронь подтверждается только по исходному черновику")
        if edited:
            if msg.order_payload and _BOOKING_CONFIRMED.search(normalize(text_)):
                raise ActionError("Уберите из текста подтверждение брони или оформите её из исходного черновика")
            state = await chat_state(session, chat)
            msg.text = text_.strip()
            msg.source = "staff"
            msg.quoted_subject = None
            msg.order_payload = None
            msg.decision_trace = None
            await _learn(session, chat, state, msg.text, bot_answer=original)
        # Как человек: первая часть уходит сейчас, остальные — следом, с паузой «печати»
        parts = [msg.text] if msg.order_payload else _parts(cfg, msg.text, msg.source)
        if msg.source == "llm_open":
            msg.source = "llm"
        order_payload = msg.order_payload
        msg.text = parts[0]
        if len(parts) > 1:
            msg.order_payload = None
        error, order = await deliver_message(session, cfg, chat, msg)
        if error:
            if msg.status in ("failed", "discarded"):
                await session.commit()
            else:
                await session.rollback()
            if order is not None:
                await send_order_push(order)
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

async def clear_reply_lease(session: AsyncSession, chat_id: UUID, lease: datetime | None) -> None:
    if lease is not None:
        await session.execute(update(AvitoChat).where(AvitoChat.id == chat_id, AvitoChat.reply_due_at == lease)
                              .values(reply_due_at=None))
        await session.commit()


async def claim_due_chats(limit: int = 5, lease_seconds: int = 180) -> list[tuple[UUID, datetime]]:
    async with AsyncSessionFactory() as session:
        res = await session.execute(text(
            "UPDATE avito_chats SET reply_due_at = now() + make_interval(secs => :lease) WHERE id IN ("
            " SELECT id FROM avito_chats WHERE reply_due_at <= now() ORDER BY reply_due_at"
            " LIMIT :limit FOR UPDATE SKIP LOCKED) RETURNING id, reply_due_at"
        ), {"limit": limit, "lease": lease_seconds})
        claims = [(row.id, row.reply_due_at) for row in res.all()]
        await session.commit()
    return claims


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
