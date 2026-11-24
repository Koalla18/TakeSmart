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
    greeting: str = ""
    human_mode: bool = False
    allow_emoji: bool = False


# ── Приветствие и тон ────────────────────────────────────────────────────────

_GREETING_START = re.compile(r"^\W*(здравствуй|добр(ый|ое|ого)\s+(день|утро|вечер)|приветствую|привет|доброго)", re.IGNORECASE)


def is_first_reply(ctx: "ChatContext") -> bool:
    """Наш ответ будет первым в диалоге — значит, нужно поздороваться."""
    return not any(author in ("bot", "staff") for author, _ in ctx.history)


def greeting_text(greeting: str, persona_name: str) -> str:
    return " ".join(greeting.replace("{name}", persona_name).split())


def with_greeting(text: str, greeting: str, persona_name: str, sep: str = "\n") -> str:
    """Добавить приветствие перед готовым ответом, если в нём его ещё нет.
    sep="\n\n" — приветствие уйдёт отдельным сообщением (см. split_reply)."""
    hello = greeting_text(greeting, persona_name)
    if not hello or _GREETING_START.match(text or ""):
        return text
    return f"{hello}{sep}{text}".strip()


# ── Как человек в мессенджере ────────────────────────────────────────────────

MAX_PARTS = 3


def split_reply(text: str, max_parts: int = MAX_PARTS) -> list[str]:
    """Ответ → короткие сообщения по пустым строкам (как пишут в мессенджере).
    Лишние куски склеиваются в последнее сообщение."""
    parts = [p.strip() for p in re.split(r"\n\s*\n", (text or "").strip()) if p.strip()]
    if len(parts) > max_parts:
        parts = parts[: max_parts - 1] + ["\n".join(parts[max_parts - 1:])]
    return parts


def typing_delay(text: str, min_s: int, max_s: int, rng: random.Random | None = None) -> int:
    """Сколько живой человек читал бы и печатал этот текст: пара секунд на прочтение и
    примерно 6–9 знаков в секунду на телефоне. В границах паузы из настроек."""
    rng = rng or random
    lo, hi = sorted((max(0, min_s), max(0, max_s)))
    seconds = rng.uniform(1.5, 3.5) + len(text or "") / rng.uniform(6, 9)
    return int(round(min(hi, max(lo, seconds))))


def build_system_prompt(cfg: PromptConfig, rules: Sequence[RuleLike], ctx: ChatContext,
                        catalog_lines: Sequence[str], now: datetime, hint: str | None = None,
                        examples: Sequence[tuple[str, str]] = (), orders_enabled: bool = False,
                        pickup_address: str = "", order_note: str | None = None,
                        catalog_overview: Sequence[str] = (), first_sent: bool = False,
                        first_price_known: bool = True) -> str:
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
        ("- Без markdown и без списков со звёздочками." if cfg.human_mode
         else "- Одно сообщение, без markdown, без списков со звёздочками."),
        "",
        "Тон (это важнее краткости):",
        "- Вежливо, тепло и с уважением, как внимательный продавец, которому приятно помочь. Обращайся на «вы».",
        "- Не отвечай одним словом или голыми цифрами: оберни ответ в живую фразу («Да, есть в наличии!», "
        "«Подскажу: …», «Хороший выбор, …»). Благодари за интерес, когда это уместно.",
        "- Никогда не грубить, не спорить, не поучать и не писать приказным тоном. Не начинай с сухого «Нет.» — "
        "мягко объясни и предложи вариант.",
        "",
        "Живая речь — пиши как человек в мессенджере, а не как справочник:",
        "- Подстраивайся под покупателя: пишет коротко и просто — отвечай так же; подробно — можно подробнее.",
        "- Простые разговорные слова: «сейчас гляну», «есть в наличии», «могу отложить», «подскажу». "
        "Без казённых оборотов («Ваш запрос обработан», «Благодарим за обращение», «Данный товар»).",
        "- Не начинай каждый ответ с «Конечно!», «Отличный вопрос!», «Я помогу вам» и не пересказывай вопрос покупателя.",
        "- Начала фраз меняй, не повторяй дословно то, что уже писал в этом диалоге.",
        "- Если знаешь имя покупателя — иногда, не в каждом сообщении, обращайся по имени.",
        "- Задавай не больше одного вопроса за раз.",
        ("- Эмодзи — изредка одно, по настроению (🙂, 👍), и только если покупатель сам пишет неформально."
         if cfg.allow_emoji else "- Без эмодзи."),
        "Примеры. Плохо: «Здравствуйте. Цена указана верно. Товар в наличии. Оформить заказ?» "
        "Хорошо: «Да, цена актуальная 🙂 Телефон есть в наличии, могу отложить на вас — когда удобно подъехать?» "
        "(эмодзи — только если они разрешены выше).",
        "",
        f"Сейчас {DAY_NAMES[now.weekday()]}, {now:%d.%m.%Y %H:%M} по Москве.",
    ]
    if cfg.human_mode:
        parts += ["", "Можно ответить одним или двумя короткими сообщениями подряд, как в мессенджере: "
                      "раздели их пустой строкой (не больше двух). Короткий ответ — одним сообщением."]
    if ctx.client_name:
        parts += [f"Имя покупателя в Авито: {ctx.client_name}."]
    hello = greeting_text(cfg.greeting, cfg.persona_name)
    if first_sent:
        parts += ["", "Приветствие и розничную цену ты УЖЕ отправил первым сообщением (оно последнее в истории). "
                      "Не здоровайся и не повторяй цену. Ответь только на то, о чём ещё спросили; если покупатель "
                      "спросил только «цена актуальна?» или просто поздоровался — reply пустой."]
        if not first_price_known:
            parts += ["Но розничную цену товара из объявления в первом сообщении назвать не удалось. Найди этот товар "
                      "в каталоге и назови розничную цену одной фразой («Розничная стоимость без участия в программе — …»). "
                      "Если товара в каталоге нет — handoff=true, reason «нет цены для объявления»."]
    elif is_first_reply(ctx):
        parts += ["", "Это твоё ПЕРВОЕ сообщение в этом диалоге: обязательно начни с приветствия"
                      + (f" — «{hello}» (можно чуть своими словами)" if hello else " и представься")
                      + ", затем ответь на вопрос"
                      + (" — приветствие отдельным коротким сообщением (через пустую строку)." if cfg.human_mode else ".")]
    else:
        parts += ["", "Вы уже общаетесь: не здоровайся заново, но сохраняй тёплый и вежливый тон."]
    if ctx.item_title or ctx.item_price:
        parts += ["", f"Покупатель пишет по объявлению: {ctx.item_title or '—'}"
                      + (f", цена в объявлении: {ctx.item_price}" if ctx.item_price else "")]
    active = [r for r in rules if r.is_active]
    if active:
        parts += ["", "Готовые ответы магазина (скрипты). Если вопрос по теме скрипта — отвечай ЕГО ТЕКСТОМ почти "
                      "дословно, сохраняя переносы строк и пункты; можно убрать лишнее, но не пересказывать своими словами:"]
        for r in active:
            parts.append(f"• [{', '.join(r.keywords)}]:\n{r.answer.strip()}")
    if cfg.knowledge.strip():
        parts += ["", "Что ещё нужно знать о магазине:", cfg.knowledge.strip()]
    if catalog_overview:
        parts += ["", "Справочник каталога магазина — всё, что сейчас есть в наличии и на предзаказ, цены как на сайте "
                      "(модель: память — цена (цвета)):", *catalog_overview]
    if catalog_lines:
        parts += ["", "Подробно — товары, о которых спрашивают (точные цены и остатки по каждому варианту):"]
        parts += [f"[{i}] {line.lstrip('• ')}" for i, line in enumerate(catalog_lines, 1)]
    if catalog_overview or catalog_lines:
        parts += ["", "Как работать с каталогом:",
                  "- Если спрашивают про несколько товаров — ответь по каждому.",
                  "- «Базовая» модель — без Pro, Max, Plus, Air, Ultra в названии. Не путай базовую модель с Pro.",
                  "- Если нужного варианта (цвета, памяти, модели) нет в справочнике — так и скажи и сразу предложи "
                  "ближайшие из справочника: другой цвет, объём или соседнюю модель с ценами. Менеджера зови, только "
                  "если похожего нет совсем или покупатель хочет именно отсутствующий вариант под заказ.",
                  "- Цены и наличие — только из справочника и подробного списка, ничего не придумывай."]
    if examples:
        parts += ["", "Как сотрудники магазина отвечали в похожих случаях (повторяй их факты и манеру):"]
        for q, a in examples:
            parts.append(f"Покупатель: {q.strip()[:300]}\nСотрудник: {a.strip()[:500]}")
    if hint:
        parts += ["", f"Подсказка: по смыслу подходит готовый ответ магазина — «{hint.strip()}». "
                      "Используй его факты, но ответь уместно контексту диалога."]
    if order_note:
        parts += ["", order_note]
    if orders_enabled and catalog_lines:
        parts += [
            "",
            "Бронь (заявка): ты можешь оформить её сам. Делай это ТОЛЬКО когда покупатель явно согласился "
            "купить или забронировать конкретный товар из списка выше и понятно, как он получит товар: "
            f"самовывоз ({pickup_address or 'в магазине'}) или доставка (тогда нужен адрес). "
            "Для самовывоза спроси, ко скольки покупателя ожидать (впиши в comment). "
            "Для заявки ОБЯЗАТЕЛЬНЫ ФИО (фамилия и имя, лучше полностью) и номер телефона; почта — по желанию, "
            "спроси о ней один раз и не настаивай. Пока ФИО и телефона нет — вежливо попроси их одним сообщением "
            "и НЕ пиши, что бронь оформлена. "
            'Когда всё есть — добавь в JSON поле "order": {"item": номер товара в квадратных скобках, '
            '"method": "pickup" или "delivery", "address": "адрес или пусто", "name": "ФИО как написал покупатель", '
            '"phone": "телефон как в переписке", "email": "почта или пусто", "comment": "пожелания или пусто"}, '
            "а в reply подтверди заявку своими словами: менеджер свяжется для подтверждения.",
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
    cancel_order: bool = False


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
                cancel_order=data.get("cancel_order") is True,
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


# ── Напоминания ──────────────────────────────────────────────────────────────

def build_reminder_messages(cfg: PromptConfig, ctx: ChatContext, catalog_lines: Sequence[str], now: datetime) -> list[dict[str, str]]:
    """Модель решает, уместно ли одно напоминание замолчавшему покупателю, и пишет его."""
    now = now.astimezone(MSK)
    system = "\n".join([
        f"Ты — {cfg.persona_name}, менеджер магазина техники TakeSmart, переписка в чате Авито.",
        "Покупатель не ответил на твоё последнее сообщение. Реши, уместно ли ОДНО короткое ненавязчивое напоминание.",
        "Не напоминай (reply пустой), если покупатель отказался, уже купил, договорились о встрече, попрощался "
        "или разговор естественно закончен.",
        "Если уместно — 1–2 предложения: по-человечески, без давления и без повтора прошлого текста; можно "
        "предложить забронировать или ответить на вопрос. Без markdown.",
        "Стиль:", cfg.style.strip(),
        f"Сейчас {DAY_NAMES[now.weekday()]}, {now:%H:%M} по Москве.",
        *(["Товары и цены (не выдумывай других):", *catalog_lines] if catalog_lines else []),
        'Ответь строго JSON: {"reply": "текст напоминания или пустая строка", "reason": "почему"}.',
    ])
    messages = [{"role": "system", "content": system}]
    for author, text in ctx.history[-20:]:
        messages.append({"role": "user" if author == "client" else "assistant", "content": text})
    messages.append({"role": "user", "content": "(покупатель молчит; напиши напоминание или верни пустой reply)"})
    return messages


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def render_reminder(template: str, item_title: str | None, client_name: str | None) -> str:
    text = template.format_map(_SafeDict(item=item_title or "товару", name=(client_name or "").strip()))
    text = re.sub(r"\s*,\s*([!?.])", r"\1", text)  # пустое имя: «Здравствуйте, !» → «Здравствуйте!»
    return _SPACES.sub(" ", text).strip()


def in_window(now: datetime, start: str, end: str) -> bool:
    now = now.astimezone(MSK)
    cur, a, b = now.hour * 60 + now.minute, _minutes(start), _minutes(end)
    return a <= cur <= b if a <= b else (cur >= a or cur <= b)


# ── Рассылки ─────────────────────────────────────────────────────────────────

_OPT_OUT = re.compile(
    r"(не\s+(пишите|присылайте|беспокойте|надо\s+(мне\s+)?(писать|рассыл))|отпиш|уберите\s+меня|хватит\s+(писать|слать)|"
    r"(стоп|прекратите)\s+(рассылк|спам|писать)|^стоп$|это\s+спам|заблокирую)", re.IGNORECASE)


def wants_opt_out(text: str) -> bool:
    """Покупатель просит больше не писать — в рассылки он больше не попадёт."""
    return _OPT_OUT.search(normalize(text)) is not None


def render_template(template: str, item_title: str | None, client_name: str | None) -> str:
    return render_reminder(template, item_title, client_name)


# ── Системные сообщения Авито ────────────────────────────────────────────────

SYSTEM_TYPES = {"system", "call", "appCall", "app_call"}


def classify_avito_message(value: dict[str, Any], own_user_id: int | None, patterns: Sequence[str]) -> tuple[str, str] | None:
    """Сообщение из вебхука или опроса → ("message" | "system", текст) или None (не хранить).
    Системным считаем служебный тип, сообщение без автора, сценарий Авито (flow) или текст
    с фразой из списка в настройках — бот на них не отвечает и не учитывает в разговоре."""
    msg_type = value.get("type") or "text"
    if msg_type == "deleted":
        return None
    content = value.get("content") or {}
    text_ = (content.get("text") or "").strip()
    if msg_type == "link":
        text_ = text_ or ((content.get("link") or {}).get("url")) or "[ссылка]"
    elif msg_type != "text" or not text_:
        text_ = text_ or _NON_TEXT.get(msg_type, f"[{msg_type}]")
    author = value.get("author_id")
    if msg_type in SYSTEM_TYPES or content.get("flow_id") or content.get("flowId"):
        return "system", text_
    if (author in (None, 0, "0")) and author != own_user_id:
        return "system", text_
    low = normalize(text_)
    for p in patterns:
        p = normalize(p)
        if p and p in low:
            return "system", text_
    return "message", text_


_NON_TEXT = {"image": "[фото]", "voice": "[голосовое сообщение]", "item": "[объявление]", "location": "[геолокация]",
             "file": "[файл]", "video": "[видео]", "call": "[звонок]", "appCall": "[звонок]"}


# ── Контакты для брони ───────────────────────────────────────────────────────

_EMAIL = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.-]+$")


def valid_full_name(name: str) -> bool:
    """ФИО: хотя бы имя и фамилия, только буквы и дефисы."""
    words = [w for w in re.split(r"\s+", (name or "").strip()) if w]
    return len(words) >= 2 and all(re.fullmatch(r"[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'-]*\.?", w) for w in words)


def normalize_phone(phone: str) -> str | None:
    """+7XXXXXXXXXX из «8 (999) 802-10-22», «+7 999…», «999 802 10 22»; None — не телефон."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        digits = "7" + digits
    if len(digits) == 11 and digits[0] in "78":
        return "+7" + digits[1:]
    return None


def valid_email(email: str) -> bool:
    return bool(_EMAIL.match((email or "").strip()))


# ── Отмена заявки ────────────────────────────────────────────────────────────

_CANCEL = re.compile(
    r"(отменя(ю|ем)|отмени(те)?\b|(хочу|хотел\w*|надо|нужно|прошу)\s+(бы\s+)?отменить|отменить\s+(бронь|заказ|заявку|брон)|"
    r"^отмена\b|отмена\s+(брони|заказа|заявки)|отказыва(юсь|емся)|откажусь|"
    r"передумал\w*|уже\s+не\s+(надо|нужно|актуально)|(не|больше\s+не)\s+(буду|будем)\s+(брать|покупать|забирать)|"
    r"(заказ|бронь|заявка)\s+(уже\s+)?не\s+(нуж|актуал)\w*|не\s+нуж\w*\s+(уже\s+)?(заказ|бронь|заявка)|"
    r"снимите\s+(бронь|резерв)|не\s+приеду)")
_NOT_CANCEL = re.compile(r"\bне\s+(надо|нужно|стоит)\s+отмен|\bне\s+отмен")


def wants_cancel(text: str) -> bool:
    """Покупатель явно отменяет бронь. «Не надо отменять» отменой не считается."""
    low = normalize(text)
    return bool(_CANCEL.search(low)) and not _NOT_CANCEL.search(low)


def order_note_for_prompt(number: str, status: str) -> str:
    if status == "cancelled":
        return (f"Заявка покупателя №{number} отменена по его просьбе. Вежливо подтверди отмену и скажи, "
                "что будешь рад помочь, если передумает. Не уговаривай.")
    return (f"У покупателя оформлена заявка №{number}. Если он явно и однозначно отменяет её (передумал, "
            'не нужно, не приедет) — добавь в JSON "cancel_order": true и вежливо подтверди отмену. '
            "Если только сомневается или спрашивает, можно ли отменить — не отменяй, уточни.")


# ── Каталог для модели: справочник и поиск ───────────────────────────────────
# Строится из живой базы сайта на каждый ответ (с коротким кэшем) — цены и наличие
# всегда как на сайте, никаких файлов, которые надо обновлять.

@dataclass
class CatalogItem:
    name: str
    category: str
    price: float
    old_price: float | None = None
    stock: int = 0
    preorder: bool = False
    preorder_note: str | None = None
    used: bool = False
    attributes: dict[str, Any] = field(default_factory=dict)
    key: Any = None          # id товара в базе


_STORAGE = re.compile(r"(?<!\w)(\d+\s*/\s*)?\d+\s*(?:гб|gb|тб|tb)(?!\w)", re.IGNORECASE)


def _rub_short(value: float) -> str:
    return f"{int(round(value)):,}".replace(",", " ")


def item_storage(it: CatalogItem) -> str | None:
    v = it.attributes.get("storage") if isinstance(it.attributes, dict) else None
    if v:
        return " ".join(str(v).split())
    # В названии может быть и оперативная память, и диск: «16ГБ, 512ГБ SSD» → «16ГБ/512ГБ»
    found = [" ".join(m.group(0).split()).upper().replace("GB", "ГБ").replace("TB", "ТБ") for m in _STORAGE.finditer(it.name)]
    return "/".join(dict.fromkeys(found)) or None


def item_color(it: CatalogItem) -> str | None:
    v = it.attributes.get("color") if isinstance(it.attributes, dict) else None
    if v:
        return str(v).strip()
    if "," in it.name:
        tail = it.name.rsplit(",", 1)[1].strip()
        if tail and not _STORAGE.fullmatch(tail) and len(tail) <= 40:
            return tail
    return None


def family_name(it: CatalogItem) -> str:
    """Модель без памяти и цвета: «iPhone 17 Pro 256 ГБ, Синий титан» → «iPhone 17 Pro»."""
    s = it.name
    for v in (it.attributes or {}).values() if isinstance(it.attributes, dict) else ():
        if isinstance(v, str) and len(v.strip()) >= 2:
            s = re.sub(re.escape(v.strip()), " ", s, flags=re.IGNORECASE)
    color = item_color(it)
    if color:
        s = re.sub(re.escape(color), " ", s, flags=re.IGNORECASE)
    s = _STORAGE.sub(" ", s)
    s = re.sub(r"\(\s*[,/\s]*\)", " ", s)
    s = re.sub(r"\s*,\s*(,\s*)*", ", ", s)
    s = " ".join(s.split()).strip(" ,-/")
    return s or it.name


def _range(prices: list[float]) -> str:
    lo, hi = min(prices), max(prices)
    return f"{_rub_short(lo)} ₽" if lo == hi else f"{_rub_short(lo)}–{_rub_short(hi)} ₽"


def build_overview(items: Sequence[CatalogItem], max_lines: int = 250) -> list[str]:
    """Справочник: категория → модель → память: цены и цвета. Только в наличии и предзаказ."""
    live = [it for it in items if it.stock > 0 or it.preorder]
    cats: dict[str, dict[str, list[CatalogItem]]] = {}
    for it in live:
        fam = family_name(it) + (" (б/у)" if it.used else "")
        cats.setdefault(it.category or "Другое", {}).setdefault(fam, []).append(it)
    lines: list[str] = []
    total_models = sum(len(f) for f in cats.values())
    for cat in sorted(cats):
        lines.append(f"## {cat}")
        for fam in sorted(cats[cat], key=str.lower):
            group = cats[cat][fam]
            by_storage: dict[str, list[CatalogItem]] = {}
            for it in group:
                by_storage.setdefault(item_storage(it) or "", []).append(it)
            parts = []
            for storage in sorted(by_storage, key=lambda s: (len(s), s)):
                variants = by_storage[storage]
                colors = sorted({c for c in (item_color(v) for v in variants) if c}, key=str.lower)
                pre = " предзаказ" if all(v.preorder for v in variants) else ""
                seg = (f"{storage} — " if storage else "") + _range([v.price for v in variants]) + pre
                if colors:
                    seg += f" ({', '.join(colors)})"
                parts.append(seg)
            lines.append(f"- {fam}: " + "; ".join(parts))
            if len(lines) >= max_lines:
                shown = sum(1 for ln in lines if ln.startswith("- "))
                lines.append(f"… и ещё {total_models - shown} моделей — точные варианты в подробном списке ниже")
                return lines
    return lines


def _aliases() -> dict[str, str]:
    from src.app.core.price_command import TOKEN_ALIASES  # чистый модуль, без базы
    extra = {"айфона": "iphone", "айфоне": "iphone", "айфону": "iphone", "айпада": "ipad", "айпаде": "ipad",
             "галакси": "galaxy", "эпл": "apple", "вотч": "watch", "часики": "watch", "аирподсы": "airpods",
             "эйрподсы": "airpods", "наушники": "airpods", "макбука": "macbook", "плейстейшен": "playstation",
             "пс5": "ps5", "плойку": "playstation", "сяоми": "xiaomi"}
    return {**TOKEN_ALIASES, **extra}


_WORD = re.compile(r"[a-zа-я0-9]+(?:[.,][0-9]+)?", re.IGNORECASE)
_QUERY_SKIP = {"гб", "тб", "gb", "tb", "есть", "цена", "сколько", "стоит", "наличии", "можно", "базовый", "базовая",
               "версия", "та", "же", "тот", "какая", "какой", "подскажите", "пожалуйста", "здравствуйте", "а", "и"}


_UNIT = re.compile(r"(\d+)\s*(gb|гб|tb|тб)\b", re.IGNORECASE)


def _split_units(text: str) -> str:
    """«512gb», «1ТБ» → «512 гб», «1 тб»: число объёма — отдельное слово."""
    return _UNIT.sub(lambda m: f"{m.group(1)} {'тб' if m.group(2).lower() in ('tb', 'тб') else 'гб'}", text or "")


def item_words(it: CatalogItem) -> set[str]:
    attrs = " ".join(str(v) for v in (it.attributes or {}).values()) if isinstance(it.attributes, dict) else ""
    return set(_WORD.findall(normalize(_split_units(f"{it.name} {attrs}"))))


def query_tokens(text: str, vocab: set[str]) -> list[str]:
    """Слова запроса, которые есть в каталоге: «айфон 17 белый 256 гб» → iphone, 17, белый, 256."""
    aliases = _aliases()
    out: list[str] = []
    for w in _WORD.findall(normalize(_split_units(text or ""))):
        w = aliases.get(w, w)
        if w in _QUERY_SKIP or w in out:
            continue
        if w.isdigit() or w in vocab or (len(w) >= 5 and any(v.startswith(w[:-2]) for v in vocab if len(v) >= 5)):
            out.append(w)
    return out


def query_segments(text: str) -> list[str]:
    """«цена на айпад 11 128 гб и айфон 17 белый 256 гб» → два запроса."""
    parts = re.split(r"[?\n;]|\s(?:и|а также|или)\s", text or "", flags=re.IGNORECASE)
    return [p.strip() for p in parts if len(p.strip()) >= 2]


def _fuzzy_hit(token: str, words: set[str]) -> bool:
    if token in words:
        return True
    # «белый» ↔ «белого», «синий» ↔ «синего»: совпадение по основе слова
    return len(token) >= 5 and any(w.startswith(token[:-2]) for w in words if len(w) >= 5)


def search_catalog(items: Sequence[CatalogItem], texts: Sequence[str], vocab: set[str],
                   per_query: int = 5, limit: int = 12) -> list[CatalogItem]:
    """Подходящие товары для каждого запроса отдельно: сначала самые полные совпадения,
    в наличии раньше, чем без наличия."""
    words_cache = {id(it): item_words(it) for it in items}
    picked: list[CatalogItem] = []
    for text in texts:
        tokens = query_tokens(text, vocab)
        if not tokens:
            continue
        scored = []
        for it in items:
            words = words_cache[id(it)]
            score = sum(1 for t in tokens if _fuzzy_hit(t, words))
            if score:
                scored.append((score, it))
        if not scored:
            continue
        best = max(s for s, _ in scored)
        need = best if best <= 2 else best - 1
        top = sorted((x for x in scored if x[0] >= need),
                     key=lambda x: (-x[0], not (x[1].stock > 0 or x[1].preorder), x[1].price))[:per_query]
        for _, it in top:
            if it not in picked:
                picked.append(it)
    return picked[:limit]


def catalog_vocab(items: Sequence[CatalogItem]) -> set[str]:
    vocab: set[str] = set()
    for it in items:
        vocab |= {w for w in item_words(it) if not w.isdigit()}
    return vocab


# ── Первое сообщение: шаблон магазина с розничной ценой ──────────────────────

DEFAULT_FIRST_MESSAGE = (
    "Здравствуйте! Меня зовут {name}, я ваш менеджер.\n\n"
    "Указанная в объявлении цена является максимальной суммой доплаты в рамках программы trade-in.\n\n"
    "✨ Розничная стоимость без участия в программе - {price}"
)


def title_match(items: Sequence[CatalogItem], title: str | None, vocab: set[str]) -> CatalogItem | None:
    """Товар каталога для объявления — только если совпадение надёжное: все числа из названия
    (модель, память) есть в товаре и совпало не меньше 70% значимых слов. Иначе None — лучше
    не назвать цену, чем назвать чужую. При нескольких равных берём тот, что в наличии и дешевле."""
    if not title:
        return None
    tokens = query_tokens(title, vocab)
    if not tokens:
        return None
    digits = [t for t in tokens if t.isdigit()]
    best: list[tuple[float, CatalogItem]] = []
    for it in items:
        words = item_words(it)
        if any(d not in words for d in digits):
            continue
        hit = sum(1 for t in tokens if _fuzzy_hit(t, words))
        share = hit / len(tokens)
        if share >= 0.7:
            best.append((share, it))
    if not best:
        return None
    top = max(s for s, _ in best)
    candidates = [it for s, it in best if s == top]
    candidates.sort(key=lambda it: (not (it.stock > 0 or it.preorder), it.price))
    return candidates[0]


def render_first_message(template: str, persona_name: str, price: str | None) -> str:
    """Шаблон первого сообщения. Цены нет — строка с {price} убирается целиком, чужую цену не подставляем."""
    text = template.replace("{name}", persona_name)
    if price:
        return text.replace("{price}", price).strip()
    lines = [ln for ln in text.split("\n") if "{price}" not in ln]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
