"""
Аналитика Авито-бота за последние N дней (по московскому времени). Тренировочные
диалоги не учитываются.

  Диалоги        — новые и активные (где покупатель писал за период)
  Без человека   — активные диалоги без ответа сотрудника и без передачи человеку
  Время ответа   — от первого сообщения покупателя за период до первого ответа (медиана, 90-й процентиль)
  Рассылки и напоминания — не «ответы»: их нет ни во времени ответа, ни в ответах сотрудников
  Брони          — заказы, оформленные ботом из чата, и их сумма (без отменённых)
  Напоминания    — сколько отправлено, сколько покупателей после них ответили и оформили бронь
  Модель         — вызовы, ошибки, токены и оценка стоимости по ценам из настроек
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.core.avito_bot_engine import MSK
from src.app.schemas.avito_bot import AnalyticsDay, AnalyticsTop, AvitoAnalyticsOut, AvitoBotConfig

# Сообщения живых (не тренировочных) диалогов
_LIVE_MSGS = "avito_messages m JOIN avito_chats c ON c.id = m.chat_id AND NOT c.is_simulated"


async def _one(session: AsyncSession, sql: str, params: dict):
    return (await session.execute(text(sql), params)).one()


async def _scalar(session: AsyncSession, sql: str, params: dict):
    return (await session.execute(text(sql), params)).scalar()


async def build(session: AsyncSession, cfg: AvitoBotConfig, days: int) -> AvitoAnalyticsOut:
    today = datetime.now(timezone.utc).astimezone(MSK).date()
    first_day = today - timedelta(days=days - 1)
    since = datetime(first_day.year, first_day.month, first_day.day, tzinfo=MSK)
    p = {"since": since}

    dialogs_new = await _scalar(session, "SELECT count(*) FROM avito_chats WHERE NOT is_simulated AND created_at >= :since", p)

    msgs = await _one(session, f"""
        SELECT
          count(*) FILTER (WHERE m.author = 'client'),
          count(*) FILTER (WHERE m.author = 'bot' AND m.status = 'sent'),
          count(*) FILTER (WHERE m.author = 'bot' AND m.status = 'sent' AND m.source = 'rule'),
          count(*) FILTER (WHERE m.author = 'bot' AND m.status = 'sent' AND m.source = 'llm'),
          count(*) FILTER (WHERE m.author = 'staff' AND m.status = 'sent' AND coalesce(m.source, '') <> 'broadcast'),
          count(DISTINCT m.chat_id) FILTER (WHERE m.author = 'client')
        FROM {_LIVE_MSGS} WHERE m.created_at >= :since""", p)
    client_messages, bot_replies, bot_rule, bot_llm, staff_replies, active = msgs

    auto_handled = await _scalar(session, f"""
        SELECT count(DISTINCT m.chat_id) FROM {_LIVE_MSGS}
        WHERE m.author = 'client' AND m.created_at >= :since
          AND NOT EXISTS (SELECT 1 FROM avito_messages s WHERE s.chat_id = m.chat_id AND s.author = 'staff'
                          AND s.status = 'sent' AND coalesce(s.source, '') <> 'broadcast' AND s.created_at >= :since)
          AND NOT EXISTS (SELECT 1 FROM avito_bot_events e WHERE e.chat_id = m.chat_id AND e.kind = 'handoff'
                          AND e.created_at >= :since)""", p)

    handoffs = await _scalar(session, "SELECT count(*) FROM avito_bot_events WHERE kind = 'handoff' AND created_at >= :since", p)

    resp = await _one(session, f"""
        WITH firsts AS (
          SELECT m.chat_id, min(m.created_at) AS t0 FROM {_LIVE_MSGS}
          WHERE m.author = 'client' AND m.created_at >= :since GROUP BY m.chat_id
        ), answered AS (
          SELECT extract(epoch FROM (
            SELECT min(coalesce(o.sent_at, o.created_at)) FROM avito_messages o
            WHERE o.chat_id = f.chat_id AND o.author IN ('bot', 'staff') AND o.status = 'sent'
              AND coalesce(o.source, '') NOT IN ('broadcast', 'reminder')
              AND coalesce(o.sent_at, o.created_at) >= f.t0) - f.t0) AS s
          FROM firsts f
        )
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s), percentile_cont(0.9) WITHIN GROUP (ORDER BY s)
        FROM answered WHERE s IS NOT NULL""", p)

    orders = await _one(session, """
        SELECT count(*), coalesce(sum(o.total_amount), 0) FROM avito_chats c JOIN orders o ON o.id = c.order_id
        WHERE NOT c.is_simulated AND o.created_at >= :since AND o.status <> 'cancelled'""", p)

    rem = await _one(session, """
        SELECT count(*),
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM avito_messages m WHERE m.chat_id = e.chat_id
                                         AND m.author = 'client' AND m.created_at > e.created_at)),
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM avito_chats c JOIN orders o ON o.id = c.order_id
                                         WHERE c.id = e.chat_id AND o.created_at > e.created_at))
        FROM avito_bot_events e WHERE e.kind = 'reminder' AND e.created_at >= :since""", p)

    learned = await _scalar(session, "SELECT count(*) FROM avito_bot_examples WHERE created_at >= :since", p)

    llm = await _one(session, """
        SELECT coalesce(sum(calls), 0), coalesce(sum(errors), 0), coalesce(sum(prompt_tokens), 0), coalesce(sum(completion_tokens), 0)
        FROM avito_bot_llm_usage WHERE day >= :day""", {"day": first_day})
    calls, errors, tin, tout = (int(x) for x in llm)
    cost = None
    if cfg.llm_price_in or cfg.llm_price_out:
        cost = round(tin / 1_000_000 * cfg.llm_price_in + tout / 1_000_000 * cfg.llm_price_out, 2)

    # По дням
    rows = (await session.execute(text(f"""
        WITH d AS (SELECT generate_series(CAST(:first AS date), CAST(:today AS date), interval '1 day')::date AS day)
        SELECT d.day,
          (SELECT count(*) FROM avito_chats c WHERE NOT c.is_simulated AND (c.created_at AT TIME ZONE 'Europe/Moscow')::date = d.day),
          (SELECT count(*) FROM {_LIVE_MSGS} WHERE m.author = 'bot' AND m.status = 'sent' AND (m.created_at AT TIME ZONE 'Europe/Moscow')::date = d.day),
          (SELECT count(*) FROM {_LIVE_MSGS} WHERE m.author = 'staff' AND m.status = 'sent' AND coalesce(m.source, '') <> 'broadcast' AND (m.created_at AT TIME ZONE 'Europe/Moscow')::date = d.day),
          (SELECT count(*) FROM avito_chats c JOIN orders o ON o.id = c.order_id
             WHERE NOT c.is_simulated AND o.status <> 'cancelled' AND (o.created_at AT TIME ZONE 'Europe/Moscow')::date = d.day)
        FROM d ORDER BY d.day"""), {"first": first_day, "today": today})).all()
    series = [AnalyticsDay(day=r[0].isoformat(), dialogs=r[1], bot_replies=r[2], staff_replies=r[3], orders=r[4]) for r in rows]

    top_rules = [AnalyticsTop(label=r[0] or "—", count=r[1]) for r in (await session.execute(text(f"""
        SELECT r.keywords->>0, count(*) FROM {_LIVE_MSGS} JOIN avito_bot_rules r ON r.id = m.rule_id
        WHERE m.status = 'sent' AND m.created_at >= :since GROUP BY r.id, r.keywords ORDER BY 2 DESC LIMIT 8"""), p)).all()]
    top_reasons = [AnalyticsTop(label=r[0] or "без причины", count=r[1]) for r in (await session.execute(text("""
        SELECT detail, count(*) FROM avito_bot_events WHERE kind = 'handoff' AND created_at >= :since
        GROUP BY detail ORDER BY 2 DESC LIMIT 8"""), p)).all()]

    return AvitoAnalyticsOut(
        days=days, dialogs_new=dialogs_new or 0, dialogs_active=active or 0, client_messages=client_messages or 0,
        bot_replies=bot_replies or 0, bot_by_rule=bot_rule or 0, bot_by_llm=bot_llm or 0, staff_replies=staff_replies or 0,
        auto_handled=auto_handled or 0, handoffs=handoffs or 0,
        response_median_s=float(resp[0]) if resp[0] is not None else None,
        response_p90_s=float(resp[1]) if resp[1] is not None else None,
        orders=orders[0] or 0, orders_sum=float(orders[1] or 0),
        reminders=rem[0] or 0, reminders_replied=rem[1] or 0, reminders_orders=rem[2] or 0,
        examples_learned=learned or 0,
        llm_calls=calls, llm_errors=errors, llm_tokens_in=tin, llm_tokens_out=tout, llm_cost=cost,
        series=series, top_rules=top_rules, top_handoff_reasons=top_reasons,
    )
