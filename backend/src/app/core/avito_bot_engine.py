"""
Решение Авито-бота — чистые функции без базы и сети, их легко гонять тестами.

Порядок решения на новое сообщение покупателя:
  1. Подходящее правило автоответа (ключевые слова + расписание + лимит на диалог).
     Правило «дословно» → отправляем его текст как есть.
  2. Иначе (или правило «своими словами», или покупатель начал с отказа — «нет,
     спасибо» не должно запускать правило «спасибо → оформим доставку?») → модель.
     Модель видит объявление, историю, тексты всех правил как базу знаний, свободные
     знания из настроек и подходящие товары каталога с живыми ценами.
  3. Модель не готова или не уверена → зовём человека.
"""
from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol, Sequence

MSK = timezone(timedelta(hours=3))
DAY_NAMES = ("понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье")

_PUNCT = re.compile(r"[^\w\s*]+", re.UNICODE)
_SPACES = re.compile(r"\s+")
# Сообщение начинается с отказа — шаблонный ответ тут легко звучит глупо
_REFUSAL_START = re.compile(r"^(нет|неа|не надо|не нужно|не интересно|не актуально|передумал\w*|уже не надо|уже купил\w*)\b")


def normalize(text: str) -> str:
    text = (text or "").lower().replace("ё", "е")
    text = _PUNCT.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def keyword_matches(keyword: str, text_norm: str) -> bool:
    """Фраза ищется целиком по границам слов. «гарант*» — по началу слова."""
    kw = normalize(keyword)
    if not kw:
        return False
    if kw.endswith("*"):
        stem = re.escape(kw.rstrip("*").strip())
        return bool(stem) and re.search(rf"(?:^|\s){stem}\w*(?:\s|$)", text_norm) is not None
    return f" {kw} " in f" {text_norm} "


def starts_with_refusal(text: str) -> bool:
    return _REFUSAL_START.match(normalize(text)) is not None


RULE_ONLY_MAX_WORDS = 8


def rule_covers(pending_text: str) -> bool:
    """Готовый текст правила закрывает вопрос целиком, только если покупатель написал одно
    короткое сообщение. «Где вы? и цена актуальная?» — уже два вопроса: отвечает модель,
    а правило идёт ей подсказкой."""
    lines = [ln for ln in pending_text.split("\n") if ln.strip()]
    return len(lines) <= 1 and len(normalize(pending_text).split()) <= RULE_ONLY_MAX_WORDS


class RuleLike(Protocol):
    id: Any
    keywords: list[str]
    answer: str
    verbatim: bool
    time_from: str
    time_to: str
    days: list[int]
    delay_seconds: int
    max_per_chat: int
    is_active: bool
    sort: int


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def rule_in_schedule(rule: RuleLike, now: datetime) -> bool:
    now = now.astimezone(MSK)
    if now.weekday() not in (rule.days or []):
        return False
    cur, start, end = now.hour * 60 + now.minute, _minutes(rule.time_from), _minutes(rule.time_to)
    if start <= end:
        return start <= cur <= end
    return cur >= start or cur <= end  # окно через полночь: 22:00–09:00


@dataclass
class RuleMatch:
    rule: RuleLike
    keyword: str


def match_rule(rules: Sequence[RuleLike], text: str, rule_hits: dict[str, Any], now: datetime) -> RuleMatch | None:
    """Лучшее подходящее правило: самая длинная совпавшая фраза, при равенстве — меньший sort."""
    text_norm = normalize(text)
    best: tuple[int, int, RuleMatch] | None = None
    for rule in rules:
        if not rule.is_active or not rule_in_schedule(rule, now):
            continue
        if rule.max_per_chat and int(rule_hits.get(str(rule.id), 0)) >= rule.max_per_chat:
            continue
        for kw in rule.keywords or []:
            if keyword_matches(kw, text_norm):
                key = (len(normalize(kw)), -rule.sort)
                if best is None or key > best[:2]:
                    best = (key[0], key[1], RuleMatch(rule, kw))
    return best[2] if best else None


# ── Модель ───────────────────────────────────────────────────────────────────

@dataclass
class ChatContext:
    item_title: str | None = None
    item_price: str | None = None
    client_name: str | None = None
    history: list[tuple[str, str]] = field(default_factory=list)  # (author: client|bot|staff, text)


@dataclass
class PromptConfig:
    persona_name: str
    style: str
    knowledge: str
    handoff_topics: str


def build_system_prompt(cfg: PromptConfig, rules: Sequence[RuleLike], ctx: ChatContext,
                        catalog_lines: Sequence[str], now: datetime, hint: str | None = None,
                        examples: Sequence[tuple[str, str]] = (), orders_enabled: bool = False,
                        pickup_address: str = "") -> str:
    now = now.astimezone(MSK)
    parts = [
        f"Ты — {cfg.persona_name}, менеджер магазина техники TakeSmart (Москва), отвечаешь покупателям "
        "в чате Авито. Твоя цель — быстро и по делу помочь и довести до покупки: бронь, самовывоз или доставка.",
        "",
        "Стиль:",
        cfg.style.strip(),
        "",
        "Жёсткие правила:",
        "- Цены, наличие, сроки и условия бери ТОЛЬКО из данных ниже. Чего там нет — не выдумывай: "
        "скажи, что уточнишь, и поставь handoff=true.",
        "- Если покупатель прямо и всерьёз спрашивает, бот ли ты или живой человек, не отрицай, что ты "
        "виртуальный помощник магазина, и предложи подключить менеджера. В остальном общайся естественно, "
        "не упоминай, что ты ИИ, без надобности.",
        f"- Зови человека (handoff=true), если речь о: {cfg.handoff_topics.strip()}; а также если покупатель "
        "раздражён, просит менеджера или вопрос выходит за рамки данных.",
        "- Не проси и не пересылай телефоны, карты и коды; оплату и оформление веди по условиям магазина.",
        "- Одно сообщение, без markdown, без списков со звёздочками.",
        "",
        f"Сейчас {DAY_NAMES[now.weekday()]}, {now:%d.%m.%Y %H:%M} по Москве.",
    ]
    if ctx.item_title or ctx.item_price:
        parts += ["", f"Покупатель пишет по объявлению: {ctx.item_title or '—'}"
                      + (f", цена в объявлении: {ctx.item_price}" if ctx.item_price else "")]
    active = [r for r in rules if r.is_active]
    if active:
        parts += ["", "Ответы магазина на частые вопросы (это факты, опирайся на них):"]
        for r in active:
            parts.append(f"• {', '.join(r.keywords)}: {r.answer.strip()}")
    if cfg.knowledge.strip():
        parts += ["", "Что ещё нужно знать о магазине:", cfg.knowledge.strip()]
    if catalog_lines:
        parts += ["", "Товары из каталога магазина, подходящие к разговору (живые цены и наличие):"]
        parts += [f"[{i}] {line.lstrip('• ')}" for i, line in enumerate(catalog_lines, 1)]
    if examples:
        parts += ["", "Как сотрудники магазина отвечали в похожих случаях (повторяй их факты и манеру):"]
        for q, a in examples:
            parts.append(f"Покупатель: {q.strip()[:300]}\nСотрудник: {a.strip()[:500]}")
    if hint:
        parts += ["", f"Подсказка: по смыслу подходит готовый ответ магазина — «{hint.strip()}». "
                      "Используй его факты, но ответь уместно контексту диалога."]
    if orders_enabled and catalog_lines:
        parts += [
            "",
            "Бронь: ты можешь оформить заказ сам. Делай это ТОЛЬКО когда покупатель явно согласился "
            "купить или забронировать конкретный товар из списка выше и понятно, как он получит товар: "
            f"самовывоз ({pickup_address or 'в магазине'}) или доставка (тогда нужен адрес). "
            "Телефон не обязателен — связь через чат Авито. Если чего-то не хватает — сначала спроси. "
            'Тогда добавь в JSON поле "order": {"item": номер товара в квадратных скобках, '
            '"method": "pickup" или "delivery", "address": "адрес или пусто", "name": "имя или пусто", '
            '"phone": "телефон как в переписке или пусто", "comment": "пожелания или пусто"}, '
            "а в reply подтверди бронь своими словами.",
        ]
    parts += [
        "",
        'Ответь строго JSON-объектом без пояснений: {"reply": "текст сообщения покупателю или пустая строка", '
        '"handoff": true|false, "reason": "коротко, зачем нужен человек, или пусто"}. '
        "Если сказать нечего (например, покупатель просто попрощался после твоего вопроса) — reply пустой, handoff=false.",
    ]
    return "\n".join(parts)


def build_messages(system: str, ctx: ChatContext, limit: int = 30) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": system}]
    for author, text in ctx.history[-limit:]:
        role = "user" if author == "client" else "assistant"
        if messages[-1]["role"] == role and role == "user":
            messages[-1]["content"] += "\n" + text
        else:
            messages.append({"role": role, "content": text})
    if messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": "(покупатель ничего не добавил)"})
    return messages


@dataclass
class LlmVerdict:
    reply: str
    handoff: bool
    reason: str
    order: dict[str, Any] | None = None


_JSON_OBJ = re.compile(r"\{.*\}", re.DOTALL)


def parse_llm_answer(raw: str) -> LlmVerdict:
    raw = (raw or "").strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
    m = _JSON_OBJ.search(raw)
    if m:
        try:
            data = json.loads(m.group(0))
            order = data.get("order")
            return LlmVerdict(
                reply=str(data.get("reply") or "").strip(),
                handoff=bool(data.get("handoff")),
                reason=str(data.get("reason") or "").strip()[:200],
                order=order if isinstance(order, dict) and order.get("item") else None,
            )
        except (ValueError, TypeError):
            pass
    # Модель ответила просто текстом — принимаем как ответ
    return LlmVerdict(reply=raw, handoff=False, reason="")


def human_delay(min_s: int, max_s: int) -> int:
    lo, hi = sorted((max(0, min_s), max(0, max_s)))
    return random.randint(lo, hi)


# Слова для поиска товара в каталоге: латиница и цифры из названия объявления и вопроса
_TOKEN = re.compile(r"[a-zа-я0-9]+", re.IGNORECASE)
_SKIP = {"и", "в", "на", "с", "для", "по", "а", "есть", "ли", "это", "цена", "сколько", "стоит", "гб", "gb", "тб", "tb"}


_LATIN = re.compile(r"[a-z]")


def catalog_tokens(item_title: str | None, question: str | None = None) -> list[str]:
    """Слова для поиска в каталоге. Из названия объявления — все значимые; из вопроса —
    только похожие на модель (латиница, числа от двух цифр): «скинете 3 тысячи» не должно
    тащить в подсказку случайные товары."""
    seen: list[str] = []

    def add(tok: str) -> None:
        if tok not in _SKIP and tok not in seen:
            seen.append(tok)

    for tok in _TOKEN.findall(normalize(item_title or "")):
        if len(tok) >= 2 or tok.isdigit():
            add(tok)
    for tok in _TOKEN.findall(normalize(question or "")):
        if _LATIN.search(tok) and len(tok) >= 2 or (tok.isdigit() and len(tok) >= 2):
            add(tok)
    return seen[:8]


# ── Персональные данные ──────────────────────────────────────────────────────
# Телефоны, карты и почта уходят модели как метки «[телефон 1]»; метки возвращаются
# обратно в ответе и в брони. Модель (тем более зарубежная) реальных данных не видит.

_PII = [
    ("карта", re.compile(r"(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)")),
    ("телефон", re.compile(r"(?<![\w+])(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)")),
    ("почта", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
]


class PiiMasker:
    def __init__(self) -> None:
        self.mapping: dict[str, str] = {}
        self._reverse: dict[str, str] = {}
        self._counts: dict[str, int] = {}

    def mask(self, text: str) -> str:
        for kind, rx in _PII:
            text = rx.sub(lambda m, k=kind: self._token(k, m.group(0)), text)
        return text

    def _token(self, kind: str, value: str) -> str:
        if value in self._reverse:
            return self._reverse[value]
        self._counts[kind] = self._counts.get(kind, 0) + 1
        token = f"[{kind} {self._counts[kind]}]"
        self.mapping[token] = value
        self._reverse[value] = token
        return token

    def unmask(self, text: str) -> str:
        for token, value in self.mapping.items():
            text = text.replace(token, value)
        return text


# ── Примеры сотрудников ──────────────────────────────────────────────────────

def _words(text: str) -> set[str]:
    return {w for w in normalize(text).split() if len(w) >= 3}


def pick_examples(question: str, examples: Sequence[tuple[str, str]], limit: int = 4,
                  min_score: float = 0.2) -> list[tuple[str, str]]:
    """Похожие по словам вопросы (коэффициент Жаккара) — самые близкие первыми."""
    q = _words(question)
    if not q:
        return []
    scored = []
    for ex_q, ex_a in examples:
        w = _words(ex_q)
        if not w:
            continue
        score = len(q & w) / len(q | w)
        if score >= min_score:
            scored.append((score, ex_q, ex_a))
    scored.sort(key=lambda x: -x[0])
    return [(q_, a_) for _, q_, a_ in scored[:limit]]
