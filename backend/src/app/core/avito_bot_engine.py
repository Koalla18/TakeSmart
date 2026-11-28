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


# Города, кроме Москвы: вопрос про доставку туда — это скрипт региона (СДЭК), а не московский
_OTHER_CITY = re.compile(
    r"\b(питер\w*|спб|петербург\w*|новосибирск\w*|екатеринбург\w*|казань|казани|казанью|"
    r"нижни\w*\s+новгород\w*|самар\w*|омск\w*|челябинск\w*|ростов\w*|уф[аеуой]\b|"
    r"краснодар\w*|воронеж\w*|перм\w*|волгоград\w*|красноярск\w*|саратов\w*|тюмен\w*|"
    r"тольятти|ижевск\w*|барнаул\w*|иркутск\w*|хабаровск\w*|владивосток\w*|ярославл\w*|"
    r"сочи|калининград\w*|ставропол\w*|брянск\w*|смоленск\w*|тула|туле|тулу|тулой|курск\w*|тверь|твери|тверью|"
    r"белгород\w*|рязан\w*|костром\w*|орел\b|орлу\b|липецк\w*|пенз\w*|киров\w*|чебоксар\w*|"
    r"ульяновск\w*|владимира\b|владимире\b|астрахан\w*|сургут\w*|мурманск\w*|архангельск\w*|"
    r"калуг\w*|вологд\w*|оренбург\w*|иваново\b|иванове\b|тамбов\w*|грозн\w*|махачкал\w*|"
    r"владикавказ\w*|нальчик\w*|томск\w*|чита\b|чите\b|читу\b|читой\b|якутск\w*)\b", re.IGNORECASE)
_MOSCOW = re.compile(r"москв\w*|\bмск\b", re.IGNORECASE)


def mentions_other_city(text: str) -> bool:
    """Покупатель упомянул город, кроме Москвы: доставка туда идёт по скрипту региона (СДЭК).
    Готовый московский скрипт тут не подходит — пусть отвечает модель."""
    t = normalize(text)
    return not _MOSCOW.search(t) and bool(_OTHER_CITY.search(t))


# ── Завершение диалога ───────────────────────────────────────────────────────

_CLOSING = re.compile(r"подума\w*|не\s+актуальн\w*|до\s+завтра|пока\b|до\s+свидания|всего\s+доброго|"
                      r"спасиб\w*|благодар\w*|и\s+вам\b|отлично\b|хорошего\s+(дня|вечера)", re.IGNORECASE)
_QUESTIONISH = re.compile(r"\?|как\b|сколько|когда|где|куда|почём|почему|есть|можно|какой|какая|какие|"
                          r"цен\w*|доставк\w*|брон\w*|наличи\w*|гарант\w*|адрес|регион|цвет|память|объём", re.IGNORECASE)
_FAREWELL_BOT = re.compile(r"хорошего\s+(дня|вечера|настроения)|доброй\s+ночи|всего\s+доброго|"
                           r"приятн\w+|хороших\s+выходных|рад\w*\s+помочь|обращайтесь", re.IGNORECASE)


def is_closing_message(text: str) -> bool:
    """Разговор подходит к концу: короткая благодарность, «подумаю», прощание — без нового вопроса.
    На такое не должен срабатывать автоответ-продажа («Желаете оформить доставку?»): тепло прощается модель."""
    t = normalize(text)
    if len(t.split()) > RULE_ONLY_MAX_WORDS or not _CLOSING.search(t):
        return False
    return not _QUESTIONISH.search(t)


def bot_farewelled(ctx: "ChatContext") -> bool:
    """Наше последнее сообщение уже было прощанием — на «спасибо»/«и вам» больше не отвечаем."""
    for author, text in reversed(ctx.history):
        if author in ("bot", "staff"):
            return bool(_FAREWELL_BOT.search(text))
    return False


# ── Модель ───────────────────────────────────────────────────────────────────

@dataclass
class ChatContext:
    item_title: str | None = None
    item_price: str | None = None
    client_name: str | None = None
    history: list[tuple[str, str]] = field(default_factory=list)  # (author: client|bot|staff, text)
    quoted_subject: dict[str, Any] | None = None


@dataclass
class PromptConfig:
    persona_name: str
    style: str
    knowledge: str
    handoff_topics: str
    greeting: str = ""
    human_mode: bool = False
    allow_emoji: bool = False
    off_topic_silent: bool = True


def farewell_wish(now: datetime) -> str:
    """Пожелание по времени суток в Москве: утром и днём — хорошего дня, вечером — вечера, ночью — доброй ночи."""
    h = now.astimezone(MSK).hour
    if 5 <= h < 17:
        return "хорошего дня и отличного настроения"
    if 17 <= h < 23:
        return "хорошего вечера и отличного настроения"
    return "доброй ночи"


_PHONE_NAME = re.compile(r"\b(iphone|galaxy\s+(s|a|z|m|note)\d*|pixel\s*\d|xiaomi|redmi|poco|honor|realme|oneplus|nothing\s+phone|айфон)", re.IGNORECASE)


def is_phone_item(category: str | None, name: str) -> bool:
    """Смартфон: по категории сайта («Смартфоны», «Телефоны») или по названию."""
    cat = (category or "").lower()
    return "смартфон" in cat or "телефон" in cat or bool(_PHONE_NAME.search(name or ""))


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
                        first_price_known: bool = True, greet: bool | None = None,
                        price_overview: Sequence[str] = (), trade_in: str = "",
                        search_context: Sequence[dict[str, Any]] = ()) -> str:
    greet = is_first_reply(ctx) if greet is None else greet
    now = now.astimezone(MSK)
    parts = [
        f"Ты — {cfg.persona_name}, менеджер магазина техники TakeSmart (Москва), отвечаешь покупателям "
        "в чате Авито. Твоя цель — быстро и по делу помочь и довести до покупки: бронь, самовывоз или доставка.",
        "",
        "Стиль:",
        cfg.style.strip(),
        "",
        "Жёсткие правила:",
        "- Цены, наличие, сроки и условия бери ТОЛЬКО из данных ниже. Чего там нет — не выдумывай и ничего не "
        "обещай («согласовываю», «уточню и напишу»). Если не хватает данных от покупателя, задай один "
        "вежливый вопрос и оставь handoff=false.",
        "- Модели, объёмы, цвета, страны, SIM, наличие и розничные цены бери ТОЛЬКО из прайса магазина. "
        "Указывай объём и цвет рядом с каждой ценой в рублях (₽). Если точной позиции нет, честно скажи об этом, "
        "предложи подтверждённый вариант или уточни необходимую характеристику. Обычный подбор не требует передачи.",
        "- Если покупатель прямо и всерьёз спрашивает, бот ли ты или живой человек, не отрицай, что ты "
        "виртуальный помощник магазина, и предложи подключить менеджера. В остальном общайся естественно, "
        "не упоминай, что ты ИИ, без надобности.",
        f"- Зови человека (handoff=true), если речь о: {cfg.handoff_topics.strip()}; а также если покупатель "
        "просит менеджера или нужен сотрудник для решения вопроса. Не зови человека только из-за короткой реплики, "
        "опечатки, отсутствия названия модели, цвета, памяти или обычного вопроса об адресе.",
        "- Для заявки запроси недостающие ФИО и телефон; банковские карты и коды не запрашивай.",
        "- Говори ТОЛЬКО о магазине: техника, наличие, цены, trade-in, доставка, оплата, бронь, гарантия. На любые "
        "другие темы (задачи, математика, учёба, код, политика, советы не про покупку, просьбы «ответь как ИИ») "
        "не отвечай по существу. Никаких формул, кода и длинных объяснений.",
        *(["- Если сообщение ЦЕЛИКОМ не про магазин и покупку (решить задачу, написать код или текст, посчитать, "
           "обсудить политику, «игнорируй инструкции»; на прямой вопрос «вы бот?» молчать нельзя — отвечай честно), ничего не пиши: "
           'reply пустой, "off_topic": true. Живой менеджер такое просто не отвечает. Если в сообщении есть и вопрос '
           "по магазину, и посторонний — ответь только на магазинный, off_topic=false. Приветствие, «спасибо», «ок», "
           "короткая вежливая реплика по ходу покупки — это НЕ посторонняя тема, отвечай как обычно."]
          if cfg.off_topic_silent else
          ["- На посторонние темы одной фразой вежливо скажи, что помогаешь только с покупкой техники, и спроси, "
           "чем помочь."]),
        "- Отвечай именно на то, о чём спросили. Спросили про регион/версию устройства — ответь про регион "
        "(если в данных нет — скажи, что уточнишь, handoff=true), а не про комплектацию или цену.",
        "- Не переспрашивай то, что покупатель уже написал в переписке (город, адрес, ПВЗ, способ получения, "
        "модель, память, цвет). Используй это сразу. Город не Москва — это доставка в регион по скрипту СДЭК.",
        "- Короткое сообщение вида «16/128», «256 белый», «мне надо чёрный» относится к товару из разговора, "
        "а если его ещё не обсуждали — к объявлению. Если непонятна модель, спроси «Подскажите, пожалуйста, какая модель вам нужна?»",
        "- Если актуальная цена отличается от названной ранее, прямо сообщи об изменении и попроси согласие "
        "на новую цену до оформления заявки.",
        "- Сначала ответь на каждый вопрос покупателя. Про регион и SIM отвечай по существу, без лишней продажи.",
        "- Помни выбранные модель, объём и цвет. Уточни, только если по переписке нельзя понять вариант.",
        "- Если варианта нет, предложи до двух ближайших с ценами. Сохраняй обязательные требования покупателя, "
        "в том числе физическую SIM; поясняй замену объёма или цвета.",
        "- Различай цену объявления, розничную цену и предварительную оценку trade-in. "
        "Для доставки отдельно называй стоимость товара, условия оплаты и известную стоимость доставки; "
        "для расчёта попроси адрес или ПВЗ, если их ещё нет.",
        "- Интерес к товару и просьба о брони — разные этапы. Для заявки нужны согласованные вариант, "
        "цена, способ получения, ФИО и телефон. Спроси недостающие данные, не переспрашивай известные.",
        "- Подтверждай оформление только в ответе с заполненным полем order либо когда в истории есть "
        "подтверждённая заявка. Резерв и его срок называй подтверждёнными только по факту.",
        "- При передаче менеджеру укажи в reason конкретную модель, вариант и вопрос покупателя.",
        "- Пиши естественно и коротко, избегай канцелярита и повторных предложений помощи после закрытого вопроса.",
        ("- Без markdown и без списков со звёздочками." if cfg.human_mode
         else "- Одно сообщение, без markdown, без списков со звёздочками."),
        "",
        "Тон (это важнее краткости):",
        "- Вежливо, тепло и с уважением, как внимательный продавец, которому приятно помочь. Обращайся на «вы».",
        "- Не отвечай одним словом или голыми цифрами: оберни ответ в живую фразу («Да, есть в наличии!», "
        "«Подскажу: …», «Хороший выбор, …»). Благодари за интерес, когда это уместно.",
        "- Когда спрашивают адрес, начни с «Наш адрес — …». Если в данных есть часы работы, добавь их, "
        "а затем спроси, во сколько удобно подъехать, если покупатель ещё не назвал время.",
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
        "",
        "Завершение диалога:",
        f"- Если разговор подошёл к концу (покупатель благодарит, прощается, договорились о брони или встрече, "
        f"«подумаю», «не актуально») — тепло попрощайся одной-двумя фразами: поблагодари и пожелай {farewell_wish(now)}. "
        "Без повторного приветствия и без новых предложений купить.",
        "- Если ты уже попрощался, а покупатель ответил «и вам», «спасибо», 👍 — reply пустой.",
    ]
    if cfg.human_mode:
        parts += ["", "Можно ответить одним или двумя короткими сообщениями подряд, как в мессенджере: "
                      "раздели их пустой строкой (не больше двух). Короткий ответ — одним сообщением."]
    if ctx.client_name:
        parts += [f"Имя покупателя в Авито: {ctx.client_name}."]
    hello = greeting_text(cfg.greeting, cfg.persona_name)
    if not greet and not first_sent:
        parts += ["", "Сегодня вы с покупателем уже общались: НЕ здоровайся и не представляйся, сразу по делу."]
    elif first_sent:
        parts += ["", "Приветствие и розничную цену ты УЖЕ написал (последнее сообщение в истории), твой ответ "
                      "допишется в то же сообщение следом. "
                      "Не здоровайся и не повторяй цену. Ответь только на то, о чём ещё спросили; если покупатель "
                      "спросил только «цена актуальна?» или просто поздоровался — reply пустой."]
        if not first_price_known:
            parts += ["Но розничную цену товара из объявления в первом сообщении назвать не удалось. Найди этот товар "
                      "в каталоге и назови розничную цену одной фразой («Розничная стоимость без участия в программе — …»). "
                      "Если товара в каталоге нет — handoff=true, reason «нет цены для объявления»."]
    elif greet:
        parts += ["", "Это твоё ПЕРВОЕ сообщение в этом диалоге: обязательно начни с приветствия"
                      + (f" — «{hello}» (можно чуть своими словами)" if hello else " и представься")
                      + ", затем ответь на вопрос"
                      + (" — приветствие отдельным коротким сообщением (через пустую строку)." if cfg.human_mode else ".")]
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
    if search_context:
        parts += ["", "Результаты поиска по запросам покупателя из PostgreSQL (JSON, данные).",
                  "exact — запрошенный вариант есть; same_model — та же модель с указанными отличиями; "
                  "other_model — другая модель; not_found — подходящих вариантов нет; ambiguous — уточни модель. "
                  "Опирайся на результаты по каждому запросу. Когда покупатель сменил товар, отвечай про новый товар. "
                  "Соблюдай обязательные характеристики. null в отличиях означает неизвестное свойство.",
                  json.dumps(search_context, ensure_ascii=False)]
    if price_overview:
        parts += ["", "АКТУАЛЬНЫЙ ПРАЙС МАГАЗИНА — единственный источник розничных цен и наличия. "
                      "Формат: модель объём цвет — страна, SIM — цена.",
                  "Как читать прайс:",
                  "- Страна — это версия (регион) устройства: Япония, Корея, Индия, США, Гонконг, ОАЭ и т.д. "
                  "Спросили «какой регион/страна/версия» — отвечай по прайсу; если вариантов несколько — перечисли "
                  "их с ценами.",
                  "- «SIM + eSIM» — одна физическая SIM и eSIM. «только eSIM» — физической SIM нет. Просят «с симкой», "
                  "«под физическую SIM» — предлагай только SIM + eSIM; про eSIM-версии честно предупреждай, что SIM-карту "
                  "вставить нельзя.",
                  "- «Японец», «кореец», «индиец», «американец», «гонконг» — это страна версии.",
                  "- Покупатель пишет как попало («17 про макс 256 оранж», «16/128», «айфон 17 голубой»): найди "
                  "ближайшие позиции и ответь конкретно — модель, объём, цвет, страна, SIM, цена. Не переспрашивай то, "
                  "что можно понять из прайса и объявления; если вариантов несколько — назови их, а не задавай вопрос.",
                  "- Если позиции нет в прайсе — так и скажи и предложи ближайшие из прайса (другой цвет, объём, страну).",
                  "- Цвета называй как в прайсе. Просят цвет, которого нет у этой модели, но есть близкий оттенок "
                  "(красный → бордовый/Burgundy, голубой → небесно-голубой) — не отвечай просто «нет такого»: "
                  "предложи ближайший оттенок и сразу назови его цену из прайса.",
                  "- «осталось мало» — последние штуки. Когда называешь такую позицию, скажи спокойно, что осталось "
                  "совсем немного и лучше забронировать заранее. Не дави и не выдумывай точное количество.",
                  *price_overview]
    if trade_in.strip():
        parts += ["", "Оценка trade-in (принимаем только эти модели; называй вилку как предварительную «до»):",
                  trade_in.strip()]
    if catalog_overview:
        parts += ["", "Справочник каталога магазина — всё, что сейчас есть в наличии и на предзаказ, цены как на сайте "
                      "(модель: память — цена (цвета)):", *catalog_overview]
    if catalog_lines:
        parts += ["", "Карточки для оформления брони. Цены и наличие бери из прайса."]
        parts += [f"[{i}] {line.lstrip('• ')}" for i, line in enumerate(catalog_lines, 1)]
    if catalog_overview:
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
            "купить или забронировать именно вариант, указанный в карточке, и понятно, как он получит товар: "
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
        "Образцы правильного поведения (модель, объём, цвет, страну, SIM и цену всегда бери из прайса/каталога выше):",
        "- «есть красный?» → красного нет, но есть бордовый (Burgundy) — назови его цену из прайса и предложи отложить.",
        "- «какой регион/страна?» → ответь страной из прайса (например, «Япония»), без цены и комплектации.",
        "- «нужен с физической симкой» → только варианты SIM + eSIM; про eSIM-only честно предупреди, что SIM-карту вставить нельзя.",
        "- «примете Samsung / iPhone 12 в трейд?» → вежливый отказ: в trade-in только iPhone из списка оценки; предложи новое устройство без trade-in.",
        "- trade-in 512 ГБ и больше или устройство с заменёнными деталями → не оценивай сам: handoff=true.",
        "- торг, «скиньте цену», «уступите» → handoff=true, своих скидок не предлагай.",
        "- «спасибо, подумаю» → тёплое прощание с пожеланием по времени суток, без новых продаж.",
        "",
        "Перед отправкой проверь свой ответ по списку:",
        "- Отвечает ли он ровно на тот вопрос, что задал покупатель (а не на соседний)?",
        "- Каждая названная цена и вариант (цвет, объём, страна, SIM) есть в прайсе/каталоге выше — дословно?",
        "- Не повторяет ли он то, что уже сказано в переписке (цену, приветствие, вопрос, на который есть ответ)?",
        "- Если это первое твоё сообщение в диалоге — оно начинается с приветствия?",
        "Если хоть один ответ «нет» — исправь reply до отправки.",
        "",
        'Ответь строго JSON-объектом без пояснений: {"reply": "текст сообщения покупателю или пустая строка", '
        '"handoff": true|false, "reason": "коротко, зачем нужен человек, или пусто", "off_topic": true|false}. '
        "Если сказать нечего (например, вы уже попрощались) — reply пустой, handoff=false.",
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
    off_topic: bool = False


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
                off_topic=data.get("off_topic") is True,
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
    ("адрес", re.compile(r"(?<!\w)(?:адрес\s*:|улица\s+|ул\.\s+|проспект\s+|переулок\s+)"
                         r"[^\n!?;]{2,95}?\b\d+[а-я]?(?:/\d+)?(?:\s*,?\s*(?:кв\.?|квартира|корпус|стр\.)\s*\d+)*", re.I)),
    ("имя", re.compile(r"(?<!\w)(?:ФИО\s*:?\s*|[Мм]еня зовут\s+)([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){0,2})")),
    ("имя", re.compile(r"\b[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){1,2}(?=\s*[,;]?\s*\[телефон \d+\])")),
]


class PiiMasker:
    def __init__(self, participant: str | None = None) -> None:
        self.mapping: dict[str, str] = {}
        self._reverse: dict[str, str] = {}
        self._counts: dict[str, int] = {}
        name = (participant or "").strip()
        self._participant = re.compile(rf"(?<!\w){re.escape(name)}(?!\w)", re.I) if len(name) >= 3 else None

    def mask(self, text: str) -> str:
        for kind, rx in _PII:
            def replace(match, kind=kind):
                value = match.group(1) if match.lastindex else match.group(0)
                return match.group(0).replace(value, self._token(kind, value), 1)
            text = rx.sub(replace, text)
        if self._participant:
            text = self._participant.sub(lambda match: self._token("имя", match.group(0)), text)
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
    """Отличает служебные метаданные и явные заголовки от обычных реплик покупателей."""
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
    if any(marker.startswith("[") and marker.endswith("]") and
           text_.casefold().startswith(marker.casefold()) for marker in patterns):
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
_NOT_CANCEL = re.compile(r"\bне\s+(надо|нужно|стоит)\s+отмен|\bне\s+отмен|"
                         r"\bотмен\w*\s+(?:(?:заказа|брони|заявки)\s+)?не\s+(?:нуж\w*|надо|требу\w*)")


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
    if it.attributes.get("catalog_model"):
        return it.attributes["catalog_model"]
    s = it.name
    for v in (it.attributes or {}).values() if isinstance(it.attributes, dict) else ():
        if isinstance(v, str) and len(v.strip()) >= 2 and v != it.attributes.get("source_line"):
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
    extra = {"японец": "япония", "японский": "япония", "японская": "япония", "японии": "япония", "японию": "япония",
             "япон": "япония", "jp": "япония", "кореец": "корея", "корейский": "корея", "корейская": "корея",
             "корее": "корея", "корею": "корея", "kr": "корея", "индиец": "индия", "индийский": "индия",
             "индийская": "индия", "индии": "индия", "американец": "сша", "американский": "сша", "американская": "сша",
             "американка": "сша", "штатов": "сша", "usa": "сша", "us": "сша", "гонконгский": "гонконг", "hk": "гонконг",
             "китайский": "китай", "китайская": "китай", "эмираты": "оаэ", "дубай": "оаэ", "дубайский": "оаэ",
             "симкой": "sim", "симка": "sim", "симку": "sim", "сим": "sim", "физической": "sim", "физ": "sim",
             "есим": "esim", "есимом": "esim", "есимка": "esim", "оранж": "orange", "оранжевый": "orange",
             "голубой": "blue", "синий": "blue", "белый": "white", "черный": "black", "серебристый": "silver",
             "серебро": "silver", "золотой": "gold", "розовый": "pink", "бирюзовый": "teal", "лавандовый": "lavender",
             "бордовый": "burgundy", "бордовая": "burgundy", "красный": "burgundy", "красная": "burgundy",
             "красного": "burgundy", "красное": "burgundy", "красную": "burgundy",
             "про": "pro", "макс": "max", "эйр": "air", "плюс": "plus", "дуо": "duo",
             "айфона": "iphone", "айфоне": "iphone", "айфону": "iphone", "айпада": "ipad", "айпаде": "ipad",
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
    text = _UNIT.sub(lambda m: f"{m.group(1)} {'тб' if m.group(2).lower() in ('tb', 'тб') else 'гб'}", text or "")
    # Одно и то же пишут по-разному: «Fold8» и «Fold 8», «S26+» и «S26 Plus», «46mm», «18 Max» = «18 Pro Max»
    text = re.sub(r"(fold|flip)(\d)", r"\1 \2", text, flags=re.IGNORECASE)
    text = re.sub(r"(\d)\+(?!\s*e?\s*-?sim)(?=\s|$|,)", r"\1 plus", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(3[89]|4[0-9])\s*(?:mm|мм)\b", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(r"\bgo\s+pro\b", "gopro", text, flags=re.IGNORECASE)
    return re.sub(r"\b(iphone|айфон)\s*(1[1-9])\s*(?:max|макс)\b", r"\1 \2 pro max", text, flags=re.IGNORECASE)


def item_words(it: CatalogItem) -> set[str]:
    attrs = " ".join(str(v) for v in (it.attributes or {}).values()) if isinstance(it.attributes, dict) else ""
    return set(_WORD.findall(normalize(_split_units(f"{it.name} {attrs}"))))


def query_tokens(text: str, vocab: set[str]) -> list[str]:
    """Слова запроса, которые есть в каталоге: «айфон 17 белый 256 гб» → iphone, 17, белый, 256."""
    aliases = _aliases()
    out: list[str] = []
    for w in _WORD.findall(normalize(_split_units(text or ""))):
        if any(ch.isdigit() for ch in w) and w not in aliases:
            w = _fix_word(w)
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


class SearchIndex:
    """Индекс каталога: слова каждого товара и обратный индекс «слово → товары».
    Строится один раз на каталог — поиск не пересчитывает слова и не обходит весь каталог на каждое слово."""

    def __init__(self, items: Sequence[CatalogItem]):
        self.items = list(items)
        self.words = [item_words(it) for it in self.items]
        self.name_len = [len(_WORD.findall(normalize(_split_units(it.name)))) for it in self.items]
        self.inv: dict[str, list[int]] = {}
        for i, ws in enumerate(self.words):
            for w in ws:
                self.inv.setdefault(w, []).append(i)
        self._cands: dict[str, frozenset[int]] = {}

    def candidates(self, token: str) -> frozenset[int]:
        """Товары со словом точно или по основе («белый» ↔ «белого»)."""
        hit = self._cands.get(token)
        if hit is None:
            found = set(self.inv.get(token, ()))
            if len(token) >= 5:
                stem = token[:-2]
                for w, ids in self.inv.items():
                    if len(w) >= 5 and w.startswith(stem):
                        found.update(ids)
            hit = self._cands[token] = frozenset(found)
        return hit

    def extra_words(self, i: int, score: int) -> int:
        """Лишние слова в названии: у «iPhone 17» их меньше, чем у «iPhone 17 Pro Max» — он точнее для запроса «17»."""
        return max(0, self.name_len[i] - score)


def search_catalog(items: Sequence[CatalogItem], texts: Sequence[str], vocab: set[str],
                   per_query: int = 5, limit: int = 12, index: SearchIndex | None = None) -> list[CatalogItem]:
    """Подходящие товары для каждого запроса отдельно: сначала самые полные совпадения,
    при равных — в наличии, затем точнее по названию (без лишних слов), затем дешевле."""
    index = index or SearchIndex(items)
    picked: list[CatalogItem] = []
    for text in texts:
        tokens = query_tokens(text, vocab)
        if not tokens:
            continue
        scores: dict[int, int] = {}
        for t in tokens:
            for i in index.candidates(t):
                scores[i] = scores.get(i, 0) + 1
        if not scores:
            continue
        best = max(scores.values())
        need = best if best <= 2 else best - 1
        top = sorted((i for i, sc in scores.items() if sc >= need),
                     key=lambda i: (-scores[i], not (index.items[i].stock > 0 or index.items[i].preorder),
                                    index.extra_words(i, scores[i]), index.items[i].price))[:per_query]
        for i in top:
            if index.items[i] not in picked:
                picked.append(index.items[i])
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


# Слова названия объявления, которые не определяют товар
_TITLE_SKIP = {"apple", "смартфон", "телефон", "мобильный", "новый", "новая", "новые", "оригинал", "оригинальный",
               "ростест", "гарантия", "рассрочка", "trade", "in", "трейд", "ин", "обмен", "в", "на", "с", "для",
               "без", "доставка", "москва", "наличии", "запечатанный", "запечатан", "nfc"}


def title_words(title: str) -> list[str]:
    """Значимые слова названия объявления — все, включая те, которых нет в каталоге."""
    aliases = _aliases()
    out: list[str] = []
    for w in _WORD.findall(normalize(_split_units(title or ""))):
        w = aliases.get(w, w)
        if w in _QUERY_SKIP or w in _TITLE_SKIP or w in out:
            continue
        out.append(w)
    return out


# Слова, меняющие модель: «17» ≠ «17 Pro» ≠ «17 Pro Max», «S25» ≠ «S25 FE»
_QUALIFIERS = {"pro", "max", "plus", "ultra", "air", "mini", "duo", "fe", "se", "xl", "fold", "flip", "lite",
               # аксессуар — не само устройство: «iPad Pro 11» не получит цену клавиатуры
               "keyboard", "pencil", "дисковод", "portal", "vr2", "блок", "чехол", "ремешок", "стекло", "кабель"}
# Особые исполнения: берём их цену, только если в объявлении нет обычного варианта
_SPECIAL = {"lte", "nano", "рус", "актив", "digital", "case", "надорвана"}
_CHIP = re.compile(r"\bm\d (?:pro|max)\b")          # «M5 Pro» и «M5» — разные ноутбуки


def _model_words(name: str) -> set[str]:
    """Слова названия модели — без цвета после запятой и без чипа «A18 Pro»."""
    base = name.rsplit(",", 1)[0] if "," in name else name
    base = re.sub(r"\ba1\d pro\b", " ", normalize(_split_units(base)))
    return set(_WORD.findall(base))


def title_match(items: Sequence[CatalogItem], title: str | None, vocab: set[str],
                index: SearchIndex | None = None) -> CatalogItem | None:
    """Товар для объявления — только при надёжном совпадении: каждое слово с цифрой из названия
    (модель и память: 17, s25, 256) есть в товаре, и совпало не меньше 70% значимых слов названия —
    считая и слова, которых в каталоге нет вовсе («Samsung Galaxy S25» не совпадёт с iPhone 256 ГБ).
    Иначе None — лучше не назвать цену, чем назвать чужую. При нескольких равных берём тот, что
    в наличии, точнее по названию («17 Pro», а не «17 Pro Max») и дешевле."""
    if not title:
        return None
    words = title_words(title)
    if not words:
        return None
    index = index or SearchIndex(items)
    words = list(dict.fromkeys("lte" if w == "cellular" else w for w in words))
    qualifiers = _QUALIFIERS & set(words)
    aliases = _aliases()
    chips = set(_CHIP.findall(" ".join(aliases.get(w, w) for w in _WORD.findall(normalize(_split_units(title))))))
    digits = [w for w in words if any(ch.isdigit() for ch in w) and w not in ("4g", "5g")]
    if any(d not in index.inv for d in digits):
        return None
    if digits:
        pool = set(index.inv[digits[0]])
        for d in digits[1:]:
            pool &= set(index.inv[d])
    else:
        pool = set(range(len(index.items)))
    best: list[tuple[float, int, int]] = []
    for i in pool:
        model = _model_words(index.items[i].name)
        base = normalize(_split_units(index.items[i].name))
        if (_QUALIFIERS & model != qualifiers or set(_CHIP.findall(base)) != chips
                or ("lte" in words and "lte" not in model)):
            continue                     # другая модель — её цену называть нельзя
        hit = sum(1 for w in words if i in index.candidates(w))
        share = hit / len(words)
        if share >= 0.7:
            best.append((share, hit, i))
    if not best:
        return None
    top = max(b[0] for b in best)
    candidates = [(hit, i) for sh, hit, i in best if sh == top]
    candidates.sort(key=lambda x: (not (index.items[x[1]].stock > 0 or index.items[x[1]].preorder),
                                   len((_SPECIAL & _model_words(index.items[x[1]].name)) - set(words)),
                                   index.extra_words(x[1], x[0]), index.items[x[1]].price))
    return index.items[candidates[0][1]]


def render_first_message(template: str, persona_name: str, price: str | None) -> str:
    """Шаблон первого сообщения. Цены нет — строка с {price} убирается целиком, чужую цену не подставляем."""
    text = template.replace("{name}", persona_name)
    if price:
        return text.replace("{price}", price).strip()
    lines = [ln for ln in text.split("\n") if "{price}" not in ln]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


# ── Отказ, повторное приветствие, посторонние темы ───────────────────────────

_REFUSAL_ANY = re.compile(
    r"(^нет\b|^неа\b|\bне\s+(интересует|интересно|нужно|надо|актуально|подходит|буду)\b|\bнет,?\s+спасибо|"
    r"спасибо,?\s+(нет|не\s+надо|не\s+нужно)|передумал\w*|уже\s+купил\w*|\bне\s+актуальн\w*)")


def is_refusal(text: str) -> bool:
    """Покупатель отказывается — в любом месте фразы: «Спасибо, не интересует», «нет, спасибо»."""
    return _REFUSAL_ANY.search(normalize(text)) is not None


_GREETING_LEAD = re.compile(
    r"^\s*(здравствуйте|здраствуйте|добрый\s+(день|вечер)|доброе\s+утро|доброго\s+(дня|вечера|времени\s+суток)|"
    r"приветствую|привет)(?!\w)[.!?,)]*\s*", re.IGNORECASE)
_INTRO_LEAD = re.compile(r"^\s*(меня\s+зовут\s+[^.!?\n]+|это\s+\w+,\s*менеджер[^.!?\n]*)[.!?]*\s*", re.IGNORECASE)


def strip_greeting(text: str) -> str:
    """Убрать «Здравствуйте! Меня зовут …» в начале — когда сегодня уже здоровались."""
    out = _GREETING_LEAD.sub("", text or "", count=1)
    out = _INTRO_LEAD.sub("", out, count=1)
    if out == text:
        return out
    out = out.lstrip(" \n,—-")
    return out[:1].upper() + out[1:] if out else ""


OFF_TOPIC_REPLY = "Я подскажу только по технике, ценам и заказам в нашем магазине. Чем могу помочь с покупкой?"
_FORMULAS = re.compile(r"\$\$|\\frac|\\cdot|\\left|\\right|\\sqrt|```|^\s*#{1,4}\s", re.MULTILINE)
MAX_REPLY_CHARS = 1200


# ── Контроль цен в ответе ────────────────────────────────────────────────────

MIN_QUOTED_PRICE = 10_000          # меньшие суммы (доставка, предоплата 1000 ₽) не проверяем
# Розница иногда приходит без знака валюты: «129 990», «129990» или «130 тыс.».
_REPLY_MONEY = re.compile(
    r"(?<![\w.,/])(?:(?P<amount>\d{1,3}(?:[ \u00a0\u202f]\d{3}){1,2}|\d{1,6})"
    r"(?:[.,]0+)?(?![\d/]|[.,]\d)\s*(?:₽|руб(?:лей|ля|ь)?\b|р\b)|"
    r"(?P<bare>\d{1,3}(?:[ \u00a0\u202f]\d{3}){1,2}|\d{5,6})(?![\w/]|[.,]\d)|"
    r"(?P<thousands>\d{1,3})\s*тыс(?:яч[аи]?)?\b|"
    r"(?P<short>\d{2,3})\s*[кk]\b)", re.IGNORECASE,
)


def quoted_prices(text: str) -> list[int]:
    """Цены, названные в тексте: «127 990 ₽», «91500 руб» → [127990, 91500]. Только от 10 000 ₽."""
    return [value for match in _REPLY_MONEY.finditer(text or "") if match["amount"]
            if (value := _reply_amount(match)[0]) >= MIN_QUOTED_PRICE]


def _reply_amount(match: re.Match) -> tuple[int, str]:
    for group in ("amount", "bare"):
        if match[group]:
            return int(re.sub(r"\D", "", match[group])), group
    return int(match["thousands"] or match["short"]) * 1000, "thousands"


def trade_in_amounts(text: str) -> list[int]:
    return [_reply_amount(match)[0] for match in _REPLY_MONEY.finditer(text)]


def format_price(value: int) -> str:
    return f"{value:,}".replace(",", " ")


def audit_reply_prices(reply: str, items: Sequence["CatalogItem"], vocab: set[str],
                       index: "SearchIndex | None", extra_allowed: Sequence[int] = (),
                       anchor: str | None = None, *, question: str | None = None) -> tuple[str, list[int], bool]:
    """Сверяет каждую цену с вариантом в той же части ответа."""
    matches = list(_REPLY_MONEY.finditer(reply))
    if not matches:
        return reply, [], False
    unknown: set[int] = set()
    fixes: list[tuple[int, int, str]] = []
    start = 0
    trade_in_scope = False
    if question:
        requested = _price_variants(items, _REPLY_MONEY.sub(" ", question), anchor, vocab, index)
        if len(requested) == 1:
            item = requested[0]
            anchor = " ".join(str(value) for value in (
                item.name, item.attributes.get("country"), item.attributes.get("sim")
            ) if value)
    for match in matches:
        value, group = _reply_amount(match)
        before = reply[start:match.start()]
        start = match.end()
        # Запятая может отделять и следующий вариант, и уточнение к нему («бордовый, 256 ГБ»).
        clauses = re.split(r"[.!?;\n]|,\s*(?=но |зато |а )", before)
        before = clauses[-1]
        if len(clauses) > 1:
            trade_in_scope = False
        after = re.match(r"\s*\(([^()]*)\)", reply[start:])
        clause = before + (f" {after[1]}" if after else "")
        if after:
            start += after.end()
        trade_context = bool(re.search(r"трейд|trade|оцен|примем|зач[её]т|\bваш\w*\b", normalize(before)))
        in_range = trade_in_scope and bool(re.fullmatch(r"\s*(?:[–—-]|до)\s*", before))
        retail_context = re.search(r"рознич|без\s+(?:trade|трейд|обмена)", normalize(before))
        if value in extra_allowed and (trade_context or in_range) and not retail_context:
            trade_in_scope = True
            continue
        trade_in_scope = False
        if value < MIN_QUOTED_PRICE and re.search(
            r"достав|предоплат|брон|пвз|сдэк|курьер", normalize(clause)
        ) and not (_variant_colors(clause) or _TITLE_WORDS.search(clause)):
            continue
        variants = _price_variants(items, clause, anchor, vocab, index)
        prices = {int(round(item.price)) for item in variants}
        if len(prices) != 1:
            unknown.add(value)
        elif (right := next(iter(prices))) != value:
            if group == "thousands":
                fixes.append((*match.span(), f"{format_price(right)} ₽"))
            else:
                fixes.append((*match.span(group), format_price(right)))
    if unknown:
        return reply, sorted(unknown), False
    for begin, end, price in reversed(fixes):
        reply = reply[:begin] + price + reply[end:]
    return reply, [], bool(fixes)


# ── Контроль цветов в ответе ─────────────────────────────────────────────────

# Русские цвета → канонический цвет из прайса. «Красный» осознанно ведёт на burgundy:
# в ассортименте это ближайший оттенок (бордовый), и мы его предлагаем вместо отказа
COLOR_WORDS = {
    "бордовый": "burgundy", "красный": "burgundy", "оранжевый": "orange", "оранж": "orange",
    "голубой": "blue", "небесно-голубой": "blue", "синий": "blue", "белый": "white",
    "черный": "black", "серебристый": "silver", "серебро": "silver", "золотой": "gold",
    "розовый": "pink", "бирюзовый": "teal", "лавандовый": "lavender", "фиолетовый": "purple",
    "зеленый": "green", "желтый": "yellow", "серый": "gray", "титановый": "titanium",
    "песочный": "desert", "космос": "cosmic",
}

_NEGATED = re.compile(r"\b(нет\b|не\b|не\s+бывает|отсутств\w+|к\s+сожалению|без\b)", re.IGNORECASE)


def _build_color_stems() -> list[tuple[str, str]]:
    stems: list[tuple[str, str]] = []
    for word, canon in COLOR_WORDS.items():
        stem = word.split("-")[-1]
        if len(stem) > 4 and stem[-2:] in ("ый", "ий", "ой"):
            stem = stem[:-2]
        stems.append((stem, canon))
    return sorted(stems, key=lambda sc: -len(sc[0]))   # длинные корни раньше: «серебрист…» ≠ «серый»


_COLOR_STEMS = _build_color_stems()


def _canonical_color(token: str) -> str | None:
    """Цвет слова с учётом падежей: «бордовую» → burgundy, «голубого» → blue."""
    parts = token.split("-") if token else []
    for part in parts or [""]:
        for stem, canon in _COLOR_STEMS:
            if len(stem) >= 3 and part.startswith(stem):
                return canon
    return None


def _color_canonicals(items: Sequence["CatalogItem"]) -> set[str]:
    """Какие цвета реально есть у позиций (en + русские, всё в канонический вид)."""
    out: set[str] = set()
    for it in items:
        a = it.attributes or {}
        for key in ("color", "color_ru"):
            value = a.get(key)
            if not isinstance(value, str) or not value.strip():
                continue
            v = normalize(value)
            canon = _canonical_color(v)
            out.add(canon or v)
    return out


def asserted_colors(reply: str) -> list[str]:
    """Цвета, названные в ответе УТВЕРДИТЕЛЬНО (не «нет», «не бывает», «к сожалению»).
    Канонический вид: burgundy, orange, blue…"""
    out: list[str] = []
    for clause in re.split(r"[.,!?…\n;—–]+", reply or ""):
        t = normalize(clause)
        if not t or _NEGATED.search(t):
            continue
        for token in t.split():
            canon = _canonical_color(token.strip(",:()«»\"'—–-"))
            if canon and canon not in out:
                out.append(canon)
    return out


def audit_reply_colors(reply: str, items: Sequence["CatalogItem"], vocab: set[str],
                       index: "SearchIndex | None", anchor: str | None = None) -> list[str]:
    """Цвет, которого нет у обсуждаемой модели в прайсе, — выдумка: возвращаем такие цвета.
    Проверяем только когда понятно, о какой модели речь, и у неё в прайсе цвета заданы;
    цвета в отрицательных клаузах («красного нет») не считаются."""
    bad: list[str] = []
    for sentence in re.split(r"[!?;\n]|(?<!\d)\.(?!\d)", _REPLY_MONEY.sub(" ", reply)):
        colors = asserted_colors(sentence)
        if not colors:
            continue
        variants = _price_variants(items, sentence, anchor, vocab, index, filter_color=False)
        available = _color_canonicals(variants)
        if available:
            bad.extend(color for color in colors if color not in available)
    return list(dict.fromkeys(bad))


def unsupported_variant_fact(reply: str, items: Sequence[CatalogItem], anchor: str | None,
                             vocab: set[str], index: SearchIndex | None) -> str | None:
    """Проверяем явно заявленные характеристики и наличие для предмета ответа."""
    for clause in re.split(r"(?<=[.!?])\s+|[;\n]+", reply):
        if clause.rstrip().endswith("?") or re.search(r"\b(?:если|уточню|подтвердить|проверю|не могу)\b", clause, re.I):
            continue
        sim = _reply_sim_label(clause)
        if sim == "только eSIM" and not re.search(r"\bтолько\s+e[ -]?sim|\be[ -]?sim[- ]only\b", clause, re.I):
            sim = None
        region = _line_country(clause) if re.search(r"\b(?:версия|регион|поставк\w*|для рынка)\b", clause, re.I) else None
        available = bool(re.search(r"\b(?:есть|сейчас)\s+в\s+наличии\b", clause, re.I))
        if not (sim or region or available):
            continue
        candidates = _price_variants(items, clause, anchor, vocab, index)
        if sim and not any(item.attributes.get("sim") == sim for item in candidates):
            return "тип SIM"
        if region and not any(item.attributes.get("country") == region for item in candidates):
            return "регион поставки"
        if available and not any(item.stock > 0 for item in candidates):
            return "наличие этой комплектации"
    return None


_CAPACITY = re.compile(r"(?<![\w/])(?:(\d+)\s*/\s*)?(\d+)\s*(гб|gb|тб|tb)\b|"
                       r"(?<![\w/])(?:(\d+)\s*/\s*)?(32|64|128|256|512|1024|2048|4096)(?![\w/])",
                       re.IGNORECASE)


def _capacity(match: re.Match) -> tuple[str | None, int]:
    ram, size, units, bare_ram, bare_size = match.groups()
    return ram or bare_ram, int(size or bare_size) * (1024 if (units or "").lower() in ("тб", "tb") else 1)


def _variant_colors(text: str) -> set[str]:
    words = _WORD.findall(normalize(text))
    colors = set(asserted_colors(text))
    offset = 0
    while offset < len(words):
        for count in range(min(3, len(words) - offset), 0, -1):
            name = " ".join(words[offset:offset + count])
            if name.isascii() and name in COLORS:
                colors.add(normalize(COLORS[name][0]))
                offset += count
                break
        else:
            offset += 1
    return colors


def _price_variants(items: Sequence[CatalogItem], text: str, anchor: str | None, vocab: set[str],
                    index: SearchIndex | None, *, filter_color: bool = True) -> list[CatalogItem]:
    """Находит модель по ответу или объявлению, затем применяет уточнения к варианту."""
    if not items:
        return []
    specs = _CAPACITY.sub(" ", text)
    tokens = query_tokens(_SIM_PHYS.sub(" ", _SIM_COMBO.sub(" ", _ONE_PHYSICAL_SIM.sub(" ", specs))), vocab)
    colors = _variant_colors(text)
    country = _line_country(text) or next(
        (_COUNTRY_NAMES[word] for word in tokens if word in _COUNTRY_NAMES), None
    )
    sim = _reply_sim_label(text)
    if not sim and "sim" in tokens:
        sim = "SIM + eSIM"
    aliases = _aliases()
    variants_words = {
        aliases.get(word, word) for word in _WORD.findall(normalize(
            " ".join([*colors, country or "", "sim esim только физической", *COLORS.keys()])
        ))
    }
    model_tokens = [word for word in tokens if word not in variants_words or word in _QUALIFIERS]
    listed = title_match(items, _SIM_PHYS.sub(" ", _SIM_COMBO.sub(" ", anchor or "")), vocab, index)
    model_has_number = any(any(ch.isdigit() for ch in word) for word in model_tokens)
    same_model_words = listed and set(model_tokens) < set(title_words(family_name(listed)))
    if same_model_words and not (model_has_number or _QUALIFIERS.intersection(model_tokens)):
        # «Этот iPhone» — ссылка на объявление, а не другая модель.
        explicit = listed
    else:
        explicit = title_match(items, " ".join(model_tokens), vocab, index) if model_tokens else None
    # Если в ответе есть номер модели («16 Pro»), дополняем его маркой из объявления.
    if listed and model_tokens and explicit is None and any(word.isdigit() for word in model_tokens):
        brand = title_words(family_name(listed))[0]
        explicit = title_match(items, " ".join([brand, *model_tokens]), vocab, index)
    if explicit is None and (_TITLE_WORDS.search(specs) or any(
        any(ch.isdigit() for ch in word) or word in _QUALIFIERS for word in model_tokens
    )):
        return []
    candidate = explicit or listed
    if candidate is None:
        return []
    family = family_name(candidate)
    same_listing = listed is not None and family_name(listed) == family
    scope = [item for item in items if family_name(item) == family and (item.stock > 0 or item.preorder)]
    capacities = {_capacity(m) for m in _CAPACITY.finditer(text)}
    if not capacities and same_listing:
        capacities = {_capacity(m) for m in _CAPACITY.finditer(anchor or "")}
    if len(capacities) > 1 or (filter_color and len(colors) > 1):
        return []
    if capacities:
        ram, size = next(iter(capacities))
        scope = [item for item in scope if any(
            size == storage and (ram is None or ram == memory)
            for memory, storage in map(_capacity, _CAPACITY.finditer(item_storage(item) or ""))
        )]
    if filter_color:
        anchor_colors = _variant_colors(anchor or "") if same_listing else set()
        same_options = same_listing and not (
            (colors and anchor_colors and colors.isdisjoint(anchor_colors)) or _CAPACITY.search(text)
        )
        colors = colors or anchor_colors
        if colors:
            scope = [item for item in scope if colors & _color_canonicals([item])]
        country = country or (_line_country(anchor or "") if same_options else None)
        sim = sim or (_reply_sim_label(anchor or "") if same_options else None)
        scope = [
            item for item in scope
            if (country is None or item.attributes.get("country") == country)
            and (sim is None or item.attributes.get("sim") == sim)
        ]
        # Например, комплектация пылесоса может менять цену при той же модели и цвете.
        features: dict[str, set[str]] = {}
        fallback_features: dict[str, set[str]] = {}
        phrase = f" {normalize(text)} "
        fallback = f" {normalize(anchor or '')} " if same_listing else ""
        model = f" {normalize(family)} "
        for item in scope:
            for key, value in item.attributes.get("catalog_attributes", {}).items():
                if key in ("color", "sim", "region", "ram_gb", "storage_gb") or not isinstance(value, str):
                    continue
                token = f" {value} "
                if token in model:
                    continue
                if token in phrase:
                    features.setdefault(key, set()).add(value)
                if token in fallback:
                    fallback_features.setdefault(key, set()).add(value)
        features = {**fallback_features, **features}
        if features:
            scope = [item for item in scope if all(
                len(values) == 1 and item.attributes.get("catalog_attributes", {}).get(key) in values
                for key, values in features.items()
            )]
    return scope


def listing_price_item(items: Sequence[CatalogItem], title: str | None, vocab: set[str],
                       index: SearchIndex | None) -> CatalogItem | None:
    hit = title_match(items, title, vocab, index)
    matches = _price_variants(items, "", title, vocab, index)
    if hit in matches:
        return hit
    return min(matches, key=lambda item: item.price, default=None)


def exact_variant_price(items: Sequence[CatalogItem], title: str, vocab: set[str],
                        index: SearchIndex | None, *, options: str = "") -> int | None:
    prices = {int(round(item.price)) for item in _price_variants(items, options, title, vocab, index)}
    return next(iter(prices)) if len(prices) == 1 else None


def is_own_repeat(reply: str, ctx: "ChatContext") -> bool:
    """Ответ дословно повторяет наше прошлое сообщение в этом диалоге — дубль не шлём."""
    norm = normalize(reply)
    return bool(norm) and any(
        author in ("bot", "staff") and normalize(text) == norm for author, text in ctx.history)


# ── Ответ про цвета без модели ───────────────────────────────────────────────

_COLOR_ASK = re.compile(r"есть|нужн\w*|хочу|интересу\w*|ищу|смотр\w*|выбра\w*|выбер\w*|цвет|цвета", re.IGNORECASE)
_TRADE_IN_HINT = re.compile(r"трейд|trade|зач[её]т|сдать|обмен|оцен\w*|аккумулятор", re.IGNORECASE)
_RU_COLOR = {"burgundy": "бордовый", "orange": "оранжевый", "blue": "голубой", "white": "белый",
             "black": "черный", "silver": "серебристый", "gold": "золотой", "pink": "розовый",
             "teal": "бирюзовый", "lavender": "лавандовый", "purple": "фиолетовый", "green": "зеленый",
             "yellow": "желтый", "gray": "серый", "titanium": "титановый", "desert": "песочный",
             "cosmic": "космический"}


def color_offer_reply(pending: str, anchor: str | None, items: Sequence["CatalogItem"],
                      vocab: set[str], index: "SearchIndex | None", max_variants: int = 3) -> str | None:
    """Покупатель спрашивает цвет, которого нет у этой модели в прайсе, — отвечаем сами,
    без модели: какие цвета этой модели и объёма реально есть, с ценами из прайса.
    None — не наш случай (цвет есть, вопрос не про цвет или модель неясна): отвечает модель."""
    if not items or _TRADE_IN_HINT.search(pending or ""):
        return None
    asked = asserted_colors(pending)
    if not asked or not _COLOR_ASK.search(normalize(pending)):
        return None
    same = _price_variants(items, _REPLY_MONEY.sub(" ", pending), anchor, vocab, index, filter_color=False)
    available = _color_canonicals(same)
    if not available:
        return None
    missing = [c for c in asked if c not in available]
    if not missing:
        return None                      # спрошенный цвет есть — пусть отвечает модель
    variants: list[str] = []
    for it in same:
        a = it.attributes or {}
        canon = _canonical_color(normalize(str(a.get("color") or ""))) or str(a.get("color") or "")
        color_ru = str(a.get("color_ru") or "") or _RU_COLOR.get(canon, canon)
        extra = ", ".join(str(a[k]) for k in ("country", "sim") if a.get(k))
        variants.append(f"{color_ru} — {format_price(int(round(it.price)))} ₽" + (f" ({extra})" if extra else ""))
    variants = variants[:max_variants]
    offer = " и ".join([", ".join(variants[:-1]), variants[-1]]) if len(variants) > 1 else variants[0]
    word = next(w for w, c in _asked_color_words(pending) if c in missing)
    return (f"Цвета «{word}» у этой модели сейчас нет, но есть {offer}. Какой подойдёт?")


def _asked_color_words(text: str) -> list[tuple[str, str]]:
    """(слово как написал покупатель, канонический цвет) по тексту."""
    out: list[tuple[str, str]] = []
    for token in normalize(text).split():
        canon = _canonical_color(token.strip(",:()«»\"'—–-"))
        if canon:
            out.append((token, canon))
    return out


def sanitize_reply(text: str) -> tuple[str, bool]:
    """Страховка поверх инструкции: формулы, код, заголовки разметки или простыня текста — это не
    ответ продавца. Возвращает (текст, был ли ответ подменён)."""
    if not text:
        return text, False
    if _FORMULAS.search(text) or len(text) > MAX_REPLY_CHARS:
        return OFF_TOPIC_REPLY, True
    return text.replace("**", "").replace("__", ""), False


# ── Прайс для бота (вкладка «Прайс») ─────────────────────────────────────────

_NO_STOCK = {"нет", "0", "нет в наличии", "-", "закончился", "под заказ"}


# Флажок страны → страна (версия устройства)
COUNTRIES = {
    "IN": "Индия", "JP": "Япония", "KR": "Корея", "US": "США", "HK": "Гонконг", "AE": "ОАЭ", "MX": "Мексика",
    "CN": "Китай", "EU": "Европа", "GB": "Великобритания", "CA": "Канада", "SG": "Сингапур", "AU": "Австралия",
    "RU": "Россия", "KZ": "Казахстан", "TH": "Таиланд", "VN": "Вьетнам", "MY": "Малайзия", "ID": "Индонезия",
    "TW": "Тайвань", "DE": "Германия", "FR": "Франция", "IT": "Италия", "ES": "Испания", "TR": "Турция",
    "PA": "Панама", "ZA": "ЮАР", "CL": "Чили", "SO": "Сомали",
}
# Цвет как пишут в прайсе (и с опечатками) → (как называется, по-русски)
COLORS = {
    "black": ("Black", "чёрный"), "white": ("White", "белый"), "while": ("White", "белый"),
    "blue": ("Blue", "синий"), "silver": ("Silver", "серебристый"), "orange": ("Orange", "оранжевый"),
    "gold": ("Gold", "золотой"), "pink": ("Pink", "розовый"), "teal": ("Teal", "бирюзовый"),
    "ultramarine": ("Ultramarine", "ультрамарин"), "lavender": ("Lavender", "лавандовый"), "sage": ("Sage", "шалфей, зелёный"),
    "yellow": ("Yellow", "жёлтый"), "desert": ("Desert", "песочный"), "natural": ("Natural", "натуральный титан"),
    "night sky": ("Night Sky", "ночное небо, тёмно-синий"), "nightsky": ("Night Sky", "ночное небо, тёмно-синий"),
    "burg": ("Burgundy", "бордовый"), "burgundy": ("Burgundy", "бордовый"), "green": ("Green", "зелёный"),
    "purple": ("Purple", "фиолетовый"), "red": ("Red", "красный"), "gray": ("Gray", "серый"), "grey": ("Gray", "серый"),
    "space gray": ("Space Gray", "серый космос"), "space grey": ("Space Gray", "серый космос"),
    "space black": ("Space Black", "чёрный космос"), "starlight": ("Starlight", "сияющая звезда"),
    "midnight": ("Midnight", "тёмная ночь"), "titanium": ("Titanium", "титан"), "graphite": ("Graphite", "графит"),
    "glacier": ("Glacier", "ледник, голубой"), "cream": ("Cream", "кремовый"), "pistachio": ("Pistachio", "фисташковый"),
    "violet": ("Violet", "фиолетовый"), "cobalt violet": ("Cobalt Violet", "фиолетовый"),
    "light violet": ("Light Violet", "светло-фиолетовый"), "light pink": ("Light Pink", "светло-розовый"),
    "l.blue": ("Light Blue", "голубой"), "sky blue": ("Sky Blue", "небесно-голубой"), "jet black": ("Jet Black", "чёрный"),
    "jetblack": ("Jet Black", "чёрный"), "rose gold": ("Rose Gold", "розовое золото"), "bronze": ("Bronze", "бронзовый"),
    "indigo": ("Indigo", "индиго"), "blush": ("Blush", "нежно-розовый"), "citrus": ("Citrus", "цитрусовый, жёлтый"),
    "obsidian": ("Obsidian", "чёрный"), "snow": ("Snow", "белый"), "frost": ("Frost", "голубой"),
    "hibiscus": ("Hibiscus", "красный"), "fog": ("Fog", "серо-зелёный"), "canyon": ("Canyon", "терракотовый"),
    "olive": ("Olive", "оливковый"), "berry": ("Berry", "ягодный"), "mint": ("Mint", "мятный"), "navy": ("Navy", "тёмно-синий"),
    "silver shadow": ("Silver Shadow", "серебристый"), "icyblue": ("Icy Blue", "голубой"), "lilac": ("Lilac", "сиреневый"),
    "blueberry": ("Blueberry", "синий"), "a.gray": ("Gray", "серый"), "a.black": ("Black", "чёрный"),
    "a.icyblue": ("Icy Blue", "голубой"), "a.lilac": ("Lilac", "сиреневый"), "a.navy": ("Navy", "тёмно-синий"),
    "titanium black": ("Titanium Black", "чёрный титан"), "titanium gray": ("Titanium Gray", "серый титан"),
    "titanium silverblue": ("Titanium SilverBlue", "серо-голубой титан"),
    "titanium whitesilver": ("Titanium WhiteSilver", "бело-серебристый титан"),
    "cosmic orange": ("Orange", "оранжевый"), "deep blue": ("Blue", "синий"), "cloud white": ("White", "белый"),
    "mist blue": ("Mist Blue", "голубой"), "light gold": ("Light Gold", "золотой"),
    "ceramic pink": ("Ceramic Pink", "розовый"), "jasper plum": ("Jasper Plum", "сливовый"),
    "apricot topaz": ("Apricot Topaz", "абрикосовый"), "prussian blue": ("Prussian Blue", "синий"),
    "черный": ("Black", "чёрный"), "чёрный": ("Black", "чёрный"), "белый": ("White", "белый"),
    "фиолетовый": ("Violet", "фиолетовый"), "синий": ("Blue", "синий"), "серый": ("Gray", "серый"),
}
# С этих слов начинается строка «только цвет — цена»: модель берётся из заголовка над ней
_BARE_STARTS = {k.split()[0] for k in COLORS} | {"space", "jet", "sky", "ceramic", "jasper", "apricot", "prussian",
                                                  "rose", "light", "cobalt", "night", "cosmic", "deep", "cloud", "mist"}
_MODEL_WORDS = {"pro": "Pro", "max": "Max", "air": "Air", "plus": "Plus", "duo": "Duo", "mini": "mini", "ultra": "Ultra",
                "neo": "Neo", "iphone": "iPhone", "ipad": "iPad", "macbook": "MacBook"}
_LOOKALIKE = str.maketrans("аеорсухкмтнвіАЕОРСУХКМТНВІ", "aeopcyxkmthbiAEOPCYXKMTHBI")
_FLAG = re.compile("([\U0001F1E6-\U0001F1FF])([\U0001F1E6-\U0001F1FF])")

# «56 990», «124  990», «38.800», «91500»
_NUM = r"(?:\d{1,3}(?:[.\s]+\d{3})+|\d{4,7})"
_DASH_PRICE = re.compile(rf"[-—–=:]\s*({_NUM})(?!\d|[A-ZА-Я]\b)")
_END_PRICE = re.compile(rf"(?<![\w./])(\d{{5,7}}|\d{{1,3}}[.\s]+(?:000|490|500|900|990))(?=\W*$)")
_RUB_PRICE = re.compile(rf"(?<![\w.])({_NUM})\s*(?:₽|руб|[рР](?![а-яёa-z]))")

_ESIM_WORD = r"(?:e\s*-?\s*sim|[еe]\s*-?\s*с(?:ч)?им)"
_SIM_COMBO = re.compile(rf"(?:(?<![a-zа-я\d])[12]\s*)?(?:i?sim|ism|сим)\s*\+\s*{_ESIM_WORD}", re.IGNORECASE)
_SIM_PHYS = re.compile(
    r"(?<!\w)([12]|две)\s*(?:физическ\w+\s+)?(?:i\s*)?(?:sim|ism|sm|сим)(?![a-zа-я])", re.IGNORECASE,
)
_ONE_PHYSICAL_SIM = re.compile(r"(?<!\w)(?:1|одна)\s+физическ\w+\s+(?:sim|сим)\b", re.IGNORECASE)
_ESIM = re.compile(rf"(?<![a-zа-я])(?:(?:только|only)\s+)?{_ESIM_WORD}", re.IGNORECASE)

# Память: «8/256», «16GB / 512GB», «36/1TB», «256», «1ТБ». «M2/M3» и «40/60w» — не память.
# Через пробел или запятую — только если у ОЗУ написано «GB»: в «iPhone 16 128GB» 16 — модель
_RAM_STORAGE = re.compile(
    r"(?<![\w.])(4|6|8|12|16|18|24|32|36|48|64|96|128)\s*(?:gb|гб)?(?:\s*/\s*|(?<=gb)(?:\s*,\s*|\s+)|(?<=гб)(?:\s*,\s*|\s+))"
    r"(?:(64|128|256|512|1024)\s*(?:gb|гб)?|([1248])\s*(?:tb|тб))(?!\w)", re.IGNORECASE)
_ONE_STORAGE = re.compile(r"(?<![\w./])(?:(32|64|128|256|512|825|1024)\s*(?:gb|гб)?|([1248])\s*(?:tb|тб))(?![\w/])",
                          re.IGNORECASE)
_SKU = re.compile(r"\b(?:SM-[A-Z0-9]+|Z1[A-Z0-9]{3,9}|M[A-Z0-9]{3}\d[A-Z]?)\b")
_STOCK_LEFT = re.compile(r"/?\s*\d+\s*шт\b\.?", re.IGNORECASE)
_NET = {"wi-fi": "Wi-Fi", "wifi": "Wi-Fi", "lte": "LTE", "nano": "Nano"}
# Заголовок, называющий товар: под ним идут строки «цвет — цена»
_TITLE_WORDS = re.compile(
    r"iphone|ipad|macbook|mac\s*mini|mac\s*studio|imac|watch|airpods|galaxy|z\s*fold|z\s*flip|pixel|dyson|playstation|"
    r"go\s*pro|dji|magic|nothing|блоки", re.IGNORECASE)
_SPEC_HEADER = re.compile(r"^\d+\s*(?:[»”\"″]|/|gb|гб|tb|тб)", re.IGNORECASE)


# Страна словом: «(Индия)», «Япония:», «Japan»
_COUNTRY_NAMES = {name.lower(): name for name in COUNTRIES.values()} | {
    "japan": "Япония", "india": "Индия", "usa": "США", "korea": "Корея", "china": "Китай", "europe": "Европа",
    "uae": "ОАЭ", "dubai": "ОАЭ", "дубай": "ОАЭ", "эмираты": "ОАЭ", "hong kong": "Гонконг"}
_COUNTRY_WORD = re.compile(r"(?<![\w-])(" + "|".join(sorted(map(re.escape, _COUNTRY_NAMES), key=len, reverse=True))
                           + r")(?![\w-])", re.IGNORECASE)


def _word_country(line: str) -> str | None:
    m = _COUNTRY_WORD.search(line)
    return _COUNTRY_NAMES[m.group(1).lower()] if m else None


def _line_country(line: str) -> str | None:
    """Страна строки — по флажку или словом. Если названы две («Индия / США»), берётся первая."""
    return _flag_country(line) or _word_country(line)


def _flag_country(line: str) -> str | None:
    m = _FLAG.search(line)
    if not m:
        return None
    code = "".join(chr(ord(ch) - 0x1F1E6 + ord("A")) for ch in m.groups())
    return COUNTRIES.get(code, code)


def _sim_label(line: str) -> str | None:
    if _SIM_COMBO.search(line):
        return "SIM + eSIM"
    m = _SIM_PHYS.search(line)
    if m:
        return "SIM + eSIM" if m.group(1) == "1" else "2 SIM"
    if _ESIM.search(line):
        return "только eSIM"
    return None


def _reply_sim_label(text: str) -> str | None:
    if _ONE_PHYSICAL_SIM.search(text) and not _ESIM.search(text):
        return "1 SIM"
    if m := _SIM_PHYS.search(text):
        if m.group(1) == "1" and not _ESIM.search(text) and not re.search(r"\biphone\b", text, re.IGNORECASE):
            return "1 SIM"
    return _sim_label(text)


def _fix_word(word: str) -> str:
    """Русские буквы-двойники внутри латиницы («Bluе», «М5») → латинские; русские слова не трогаем."""
    if re.search(r"[A-Za-z0-9]", word) and not re.search(r"[бгдёжзийлпфцчшщъыьэюяБГДЁЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯ]", word):
        return word.translate(_LOOKALIKE)
    return word


def _color(tokens: list[str]) -> tuple[str, str | None]:
    raw = " ".join(tokens).strip()
    fixed = raw.lower()
    if fixed in COLORS:
        return COLORS[fixed]
    for i in range(len(tokens), 0, -1):          # «Space Gray Titan» → самое длинное известное начало
        head = " ".join(tokens[:i]).lower()
        if head in COLORS:
            en, ru = COLORS[head]
            rest = " ".join(tokens[i:])
            return (f"{en} {rest}".strip(), ru)
    return (raw.title() if raw.islower() else raw), None


def _find_color(tokens: list[str]) -> tuple[list[str], list[str]]:
    """Известный цвет в середине названия («Air 15 Midnight M5»). Забираем, только если он один —
    у часов «Black Black Alpine Loop» цветов несколько, их не разрываем."""
    found: list[tuple[int, int]] = []
    i = 1
    while i < len(tokens):
        for size in (2, 1):
            if i + size <= len(tokens) and " ".join(tokens[i:i + size]).lower() in COLORS:
                found.append((i, size))
                i += size
                break
        else:
            i += 1
    if len(found) != 1:
        return tokens, []
    start, size = found[0]
    return tokens[:start] + tokens[start + size:], tokens[start:start + size]


def _expand_model(text: str) -> str:
    """Сокращения поставщиков → полное название, по которому ищут покупатели."""
    text = re.sub(r"^iPro\b", "iPad Pro", text)
    # «Apple iPhone», «Samsung S26», «Galaxy S26» у разных поставщиков — одно и то же название
    text = re.sub(r"^Apple\s+(?=iPhone|iPad|MacBook|AirPods|iMac)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^(?:Samsung\s+)?(?:Galaxy\s+)?(?=(?:[AS]\d{2}[a-z]?\+?\s|Z\s*(?:Fold|Flip)))(?=.*\d\s*(?:gb)?\s*/\s*\d)",
                  "Samsung Galaxy ", text, flags=re.IGNORECASE)
    text = re.sub(r"(\d)(pro|air|plus|duo|max|mini)\b", r"\1 \2", text, flags=re.IGNORECASE)
    if re.match(r"^1[1-9]e?(?:\s|$)", text):
        text = f"iPhone {text}"
    # «18 Max» у поставщиков — это Pro Max
    text = re.sub(r"^(iPhone 1[1-9]) max\b", r"\1 Pro Max", text, flags=re.IGNORECASE)
    if re.match(r"^5\s+(?:slim|portal|vr2|pro|дисковод|digital)\b", text, re.IGNORECASE):
        text = f"PlayStation {text}"
    elif re.match(r"^(?:pro|air)\s+1[3-6]\b|^neo\b", text, re.IGNORECASE):
        text = f"MacBook {text}"
    elif re.match(r"^S\d{1,2}\s+(?:38|40|41|42|44|45|46|49)\b", text):
        text = "Apple Watch Series " + text[1:]
    elif re.match(r"^(?:SE\s+(?:\d\s+)?(?:40|44)|Ultra\s+\d\s+49)\b", text):
        text = f"Apple Watch {text}"
    elif re.match(r"^pixel\b", text, re.IGNORECASE):
        text = f"Google {text}"
    elif re.match(r"^\d+(?:/\d+)?\s*w\b", text, re.IGNORECASE):
        text = f"Блок Apple {text}"
    return re.sub(r"(\d)\+(?=\s|$)", r"\1 Plus", text)


def _clean_text(text: str) -> str:
    """Название без эмодзи, артикулов, пометок о количестве и внутренних примечаний."""
    text = _FLAG.sub(" ", text)
    text = re.sub("\\d\ufe0f?\u20e3", " ", text)       # эмодзи-цифры «2️⃣» — не часть названия
    text = _STOCK_LEFT.sub(" ", text)
    text = re.sub(r"\(\s*наша[^)]*\)", " ", text, flags=re.IGNORECASE)
    text = " ".join(_fix_word(w) for w in text.split())
    text = _SKU.sub(" ", text)
    text = _SIM_COMBO.sub(" ", text)
    text = _SIM_PHYS.sub(" ", text)
    text = _ESIM.sub(" ", text)
    text = re.sub(r"\bA1\d Pro\b", " ", text)           # чип A18 Pro — не модель «Pro»
    text = re.sub(r"[^\w\s\-/.,+]", " ", text)
    return " ".join(text.split()).strip(" -.,/")


def _priced(line: str) -> tuple[float, int, int] | None:
    """Цена строки: (сумма, где кончается название, где кончается цена)."""
    plain = _FLAG.sub("  ", line)       # флажок занимает 2 символа — позиции не сдвигаются
    for pattern in (_DASH_PRICE, _RUB_PRICE, _END_PRICE):
        found = [m for m in pattern.finditer(plain) if int(re.sub(r"\D", "", m.group(1))) >= 1000]
        # «2024–2026» в названии — годы, а не цена
        found = [m for m in found if not (re.fullmatch(r"(?:19|20)\d\d", m.group(1))
                                          and re.search(r"(?:19|20)\d\d\s*[-—–]\s*$", plain[:m.start(1)]))]
        if found:
            m = found[-1]
            return float(re.sub(r"\D", "", m.group(1))), m.start(), m.end()
    return None


def _split_items(line: str) -> list[str]:
    """«… Black — 110 990 iPro 11 … Silver — 111 990» (две колонки в одной строке) → две позиции."""
    cuts = [m for m in _DASH_PRICE.finditer(line) if re.search(r"\d[.\s]+\d{3}|\d{5}", m.group(1))]
    parts, start = [], 0
    for cur, nxt in zip(cuts, cuts[1:]):
        between = line[cur.end():nxt.start()]
        if len(re.findall(r"[A-Za-zА-Яа-я]", _SIM_COMBO.sub("", _ESIM.sub("", between)))) >= 5:
            tail = re.match(r"\s*(?:₽|руб\.?)?", between).end()
            parts.append(line[start:cur.end() + tail])
            start = cur.end() + tail
    parts.append(line[start:])
    return [p.strip() for p in parts if p.strip()]


@dataclass
class _PriceContext:
    """Что сказано в заголовках над строкой."""
    title: str = ""
    spec: str = ""
    sim: str | None = None
    country: str | None = None
    pending: bool = False      # страна/SIM из заголовка, под которым ещё не было позиций
    last_model: str = ""
    watch_se: str = ""

    def refine(self, text: str) -> str:
        """Дописывает то, что названо только в заголовке: поколение SE и чип MacBook."""
        if self.watch_se:
            text = re.sub(r"^(Apple Watch SE) (?=4[04]\b)", rf"\1 {self.watch_se} ", text)
        m = re.match(r"^(MacBook (?:Air|Pro) 1[3-6])(?!.*\bM\d)", text, re.IGNORECASE)
        if m:
            chip = re.search(rf"{m.group(1)} (M\d(?: (?:Pro|Max))?)\b", self.title, re.IGNORECASE)
            if chip:
                text = f"{m.group(1)} {chip.group(1).title()}{text[m.end():]}"
        return text

    def header(self, line: str) -> None:
        text = _clean_text(line)
        sim = _sim_label(line)
        raw = _FLAG.sub(" ", line).strip(" •*:➖━-—–\t")
        if re.fullmatch(r"SE\s*\d", text, re.IGNORECASE):
            self.watch_se = text.split()[-1][-1]
        phone = re.fullmatch(r"(?:iphone\s*)?(1[1-9]\s*(?:e|pro|air|plus|duo)?(?:\s*max)?)", text, re.IGNORECASE)
        flag = _line_country(line)
        if text and (_TITLE_WORDS.search(text) or phone):
            title = f"iPhone {phone.group(1)}" if phone else text
            keep = self.pending                    # «🇯🇵 Япония:» стоит над названием модели
            self.sim = sim or (self.sim if keep else None)
            self.country = flag or (self.country if keep else None)
            self.title, self.spec, self.pending = title, "", bool(self.sim or self.country)
            return
        if _SPEC_HEADER.match(raw):
            self.spec = text
        if sim:
            self.sim, self.pending = sim, True
        # «🇯🇵 Япония:» или «Япония» — страна всех строк ниже; «1 Ревизия 🇯🇵» — просто приписка
        start = line.strip(" •*:➖━-—–(\t")
        if flag and (_FLAG.match(start) or _COUNTRY_WORD.match(start)):
            self.country, self.pending = flag, True


def _parse_free_line(line: str, n: int, ctx: _PriceContext) -> CatalogItem | str | None:
    """«17Pro Max 256 Orange - 103000🇰🇷1SIM.», «15 256 Black 🇮🇳 - 61.100», «Cream — 109 990₽» под заголовком.
    None — заголовок или разделитель, str — ошибка."""
    low = line.lower()
    if re.search(r"\[\d{1,2}\s*\w+\.?\s*\d{4}", line):
        return None
    priced = _priced(line)
    if priced is None:
        if "прайс" in low:
            return None
        tail = re.sub(r"[^\w\-—–]+$", "", line)
        has_color = any(w.strip("().,").lower() in COLORS for w in line.split())
        if re.search(r"\w", line) and (tail.endswith(("-", "—", "–")) and re.search(r"\w\s*[-—–]$", tail)
                                       or has_color and re.search(r"\d", line)):
            return f"Строка {n}: не нашёл цену"
        ctx.header(line)
        return None
    price, name_end, price_end = priced
    left, right = line[:name_end], line[price_end:]
    country = _line_country(line)
    sim = _sim_label(line)
    few = "\U0001F3CE" in line or bool(_STOCK_LEFT.search(line))   # 🏎️ или «/1шт» — осталось мало
    activated = bool(re.search(r"\(\s*актив", line, re.IGNORECASE))
    if activated:
        left, right = (re.sub(r"\(\s*актив[^)]*\)?", " ", x, flags=re.IGNORECASE) for x in (left, right))
    text = _clean_text(_COUNTRY_WORD.sub(" ", left))
    if not text:
        return f"Строка {n}: не понял модель"
    bare = False
    first = text.split()[0].lower()
    if first in _BARE_STARTS or re.match(r"^\d+\s*(?:gb|гб)?\s*/\s*\d+(?!\d*\s*w)|^\d+\s*(?:gb|гб|tb|тб)\b"
                                          r"|^(?:64|128|256|512|1024)\b", text, re.IGNORECASE):
        if not ctx.title:
            return f"Строка {n}: не понял, к какой модели относится «{text}»"
        bare = True
        # объём из подзаголовка не дублируем, если он уже есть в самой строке
        spec = "" if _RAM_STORAGE.search(text) or _ONE_STORAGE.search(text) else ctx.spec
        title = ctx.title
        if spec and (_RAM_STORAGE.search(spec) or _ONE_STORAGE.search(spec)):
            title = _ONE_STORAGE.sub(" ", _RAM_STORAGE.sub(" ", title))
        text = " ".join(x for x in (title, spec, text) if x)
    elif not re.search(r"[A-Za-z]", text) and not re.match(r"^\d", text):
        # «Надорвана коробка — 54 990»: уточнение к товару строкой выше
        if not ctx.last_model:
            return f"Строка {n}: не понял модель"
        text = f"{ctx.last_model} ({text.lower()})"
    text = re.sub(r"^(?=.*\b(?:samsung|galaxy|[as]\d{2})\b)(.*?\b)(8|12|16|24)\s+(128|256|512|1024)\b",
                  r"\1\2/\3", text, flags=re.IGNORECASE)
    text = ctx.refine(" ".join(_expand_model(text).split()))
    # страну и SIM из заголовка получают телефоны под ним и строки «цвет — цена»; не AirPods ниже
    phone = bool(re.match(r"(?:iPhone|Samsung Galaxy [ASZ]|Google Pixel)", text, re.IGNORECASE))
    if bare or phone:
        country = country or ctx.country
    if phone:
        sim = sim or ctx.sim
    physical = _SIM_PHYS.search(line)
    if physical and physical.group(1) == "1" and not _SIM_COMBO.search(line) and not text.lower().startswith("iphone"):
        sim = "1 SIM"

    storage, head, tail = "", text, ""
    m = _RAM_STORAGE.search(text)
    if m:
        ram, gb, tb = m.groups()
        storage = f"{ram}/{tb} ТБ" if tb else f"{ram}/{gb} ГБ"
    else:
        m = _ONE_STORAGE.search(text)
        if m:
            gb, tb = m.groups()
            storage = f"{tb} ТБ" if tb else ("1 ТБ" if gb == "1024" else f"{gb} ГБ")
    if m:
        head, tail = text[:m.start()], text[m.end():]

    def words_of(chunk: str) -> list[str]:
        return [w for w in (t.strip("-.,/+") for t in re.split(r"[\s,]+", chunk)) if w]

    head_words, tail_words = words_of(head), words_of(tail)
    if storage and not head_words:
        return f"Строка {n}: не понял модель"
    nets = [_NET[w.lower()] for w in head_words + tail_words if w.lower() in _NET]
    head_words = [w for w in head_words if w.lower() not in _NET]
    tail_words = [w for w in tail_words if w.lower() not in _NET]
    rest, color_tokens = _find_color(["", *tail_words])
    if color_tokens:                       # цвет один — всё остальное («70W», «Touch ID», «Рус») в название
        head_words += rest[1:]
    elif " ".join(tail_words).lower().startswith(tuple(COLORS)):
        color_tokens = tail_words
    else:
        head_words += tail_words
    if not color_tokens:
        head_words, color_tokens = _find_color(head_words)
    model = " ".join(_MODEL_WORDS.get(w.lower(), w) for w in head_words)
    model = " ".join([model, *dict.fromkeys(nets)] + (["(актив)"] if activated else []))
    if not model:
        return f"Строка {n}: не понял модель"
    color_en, color_ru = _color(color_tokens) if color_tokens else ("", None)
    attrs: dict[str, Any] = {}
    if storage:
        attrs["storage"] = storage
    if color_en:
        attrs["color"] = color_en
    if color_ru:
        attrs["color_ru"] = color_ru
    if country:
        attrs["country"] = country
    if sim:
        attrs["sim"] = sim
    if few:
        attrs["few"] = "осталось мало"
    name = " ".join(x for x in (model, storage) if x) + (f", {color_en}" if color_en else "")
    ctx.last_model, ctx.pending = model, False
    return CatalogItem(name=name, category="Прайс", price=price, stock=1, attributes=attrs, key=f"price:{n}")


def _parse_table_line(line: str, n: int) -> CatalogItem | str:
    sep = "\t" if "\t" in line else ("|" if "|" in line else ";")
    cols = [c.strip() for c in line.split(sep)]
    if len(cols) < 2:
        return f"Строка {n}: нужны хотя бы модель и цена"
    if len(cols) == 2:                       # «Модель; Цена»
        model, storage, color, price_s, stock_s = cols[0], "", "", cols[1], ""
    else:                                    # «Модель; Память; Цвет; Цена; Наличие»
        cols += [""] * (5 - len(cols))
        model, storage, color, price_s, stock_s = cols[:5]
    digits = re.sub(r"\D", "", price_s)
    if not model or not digits:
        return f"Строка {n}: не понял цену «{price_s or '—'}»"
    storage_label = f"{storage} ГБ" if storage.isdigit() else storage
    name = model + (f" {storage_label}" if storage_label else "") + (f", {color}" if color else "")
    attrs = {k: v for k, v in (("storage", storage_label), ("color", color)) if v}
    in_stock = stock_s.lower() not in _NO_STOCK
    return CatalogItem(name=name, category="Прайс", price=float(digits), stock=1 if in_stock else 0,
                       attributes=attrs, key=f"price:{n}")



def _parse_explicit_line(line: str, number: int) -> CatalogItem | str:
    try:
        _, brand, category, model, price, stock, raw_attributes = line.split("|", 6)
        brand, category, model, stock = (value.strip() for value in (brand, category, model, stock))
        features = json.loads(raw_attributes)
        price_value = float(int(price.strip()))
        if (not all((brand, category, model)) or not 0 < price_value < 10**10 or not isinstance(features, dict)
                or any(type(value) not in (str, int, bool, type(None)) for value in features.values())):
            raise ValueError
    except (ValueError, TypeError, OverflowError):
        return f"Строка {number}: ожидается !|Производитель|Тип|Модель|Цена|Наличие|{{характеристики JSON}}"
    attrs = {"catalog_brand": brand, "catalog_category": category, "catalog_model": model,
             "catalog_attributes": features}
    name = model if normalize(model).startswith(normalize(brand)) else f"{brand} {model}"
    return CatalogItem(name, category, price_value, stock=int(stock.lower() not in _NO_STOCK),
                       attributes=attrs, key=f"price:{number}")

def words_without_years(name: str) -> tuple[str, ...]:
    """Слова названия без года выпуска и без учёта порядка: «Air 15 M5 2026» = «Air 15 M5»."""
    return tuple(sorted(w for w in _WORD.findall(normalize(_split_units(name))) if not re.fullmatch(r"20[12]\d", w)))


def position_key(it: CatalogItem) -> tuple:
    """Одна и та же позиция: модель, объём и цвет (всё в названии), страна и SIM."""
    a = it.attributes or {}
    extended = (a.get("catalog_brand"), a.get("catalog_category"), a.get("catalog_model"),
                json.dumps(a.get("catalog_attributes", {}), sort_keys=True, ensure_ascii=False))
    parts = tuple(sorted(_WORD.findall(normalize(_split_units(it.name)))))
    return parts, a.get("country"), a.get("sim"), extended


def _parse_stored_line(line: str, n: int) -> CatalogItem | str:
    """Строка базы после обновления: «@|цена|название|объём|цвет|цвет по-русски|страна|SIM|мало|наличие»."""
    cells = [c.strip() for c in line.split("|", 10)[1:]]
    cells += [""] * (9 - len(cells))
    price, name, storage, color, color_ru, country, sim, few, stock = cells[:9]
    price = re.sub(r"\D", "", price)
    if not price or not name:
        return f"Строка {n}: не понял цену или название"
    attrs = {k: v for k, v in (("storage", storage), ("color", color), ("color_ru", color_ru), ("country", country),
                               ("sim", sim), ("few", few)) if v}
    if len(cells) > 9 and cells[9]:
        try:
            extra = json.loads(cells[9])
            if not isinstance(extra, dict):
                raise ValueError
            attrs.update(extra)
        except ValueError:
            return f"Строка {n}: не прочитаны дополнительные параметры"
    return CatalogItem(name=name, category="Прайс", price=float(price), stock=0 if stock.lower() in _NO_STOCK else 1,
                       attributes=attrs, key=f"price:{n}")


def parse_price_list(text: str) -> tuple[list[CatalogItem], list[str]]:
    items, errors, _ = parse_price_list_full(text)
    return items, errors


def parse_price_list_full(text: str, *, deduplicate: bool = True) -> tuple[list[CatalogItem], list[str], list[str]]:
    """Позиции, ошибки и список повторов (повтор — берём меньшую цену).

    Прайс для бота. Два формата, можно вперемешку:
      • как присылают поставщики: «17Pro Max 256 Orange - 103000🇰🇷1SIM.», «15 256 Black 🇮🇳 - 61.100» —
        модель, объём, цвет, цена, флажок страны (версия) и SIM. Заголовок («iPad Air 13 M4 128GB»,
        «1TB:») относится к строкам «цвет — цена» под ним;
      • таблицей: «Модель; Память; Цвет; Цена; Наличие» (через ; Tab или |), «нет» в наличии — нет.
    # — комментарий."""
    found: list[CatalogItem] = []
    errors: list[str] = []
    ctx = _PriceContext()
    for n, raw in enumerate((text or "").splitlines(), 1):
        line = raw.strip().strip("•").strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(("@|", "!|")):
            stored = _parse_stored_line(line, n) if line.startswith("@|") else _parse_explicit_line(line, n)
            if isinstance(stored, CatalogItem):
                stored.attributes.setdefault("source_line", raw)
            (errors if isinstance(stored, str) else found).append(stored)
            continue
        if ";" in line or "|" in line or ("\t" in line and not _DASH_PRICE.search(line)):
            result = _parse_table_line(line, n)
            if isinstance(result, str):
                errors.append(result)
            else:
                result.attributes["source_line"] = raw
                found.append(result)
            continue
        for k, part in enumerate(_split_items(line)):
            result = _parse_free_line(part.strip("• "), n, ctx)
            if isinstance(result, str):
                errors.append(result)
            elif result is not None:
                result.attributes["source_line"] = part
                if k:
                    result.key = f"price:{n}.{k}"
                found.append(result)
    if not deduplicate:
        return found, errors, []
    # Старый интерфейс разбора прайса показывает один результат на позицию.
    best: dict[tuple, CatalogItem] = {}
    repeats: dict[tuple, list[float]] = {}
    for it in found:
        key = position_key(it)
        old = best.get(key)
        if old is None:
            best[key] = it
            continue
        repeats.setdefault(key, [old.price]).append(it.price)
        if (it.stock <= 0, it.price) < (old.stock <= 0, old.price):
            best[key] = it
    duplicates = [f"{best[k].name}: " + ", ".join(_rub_short(p) for p in prices) + f" → оставил {_rub_short(best[k].price)}"
                  for k, prices in repeats.items() if len(set(prices)) > 1]
    return list(best.values()), errors, duplicates


def price_storage_gb(it: CatalogItem) -> int:
    st = (it.attributes or {}).get("storage", "") or ""
    m = re.search(r"(\d+)\D*$", st)
    if not m:
        return 0
    return int(m.group(1)) * (1024 if "ТБ" in st or "TB" in st.upper() else 1)


def price_lines(items: Sequence[CatalogItem]) -> list[str]:
    """Каждая позиция прайса отдельной строкой — со страной и SIM: модели нужно различать версии."""
    out = []
    for it in sorted(items, key=lambda x: (family_name(x).lower(), price_storage_gb(x),
                                           (x.attributes or {}).get("color", ""), x.price)):
        if it.stock <= 0:
            continue
        a = it.attributes or {}
        color = a.get("color", "")
        if a.get("color_ru"):
            color = f"{color} ({a['color_ru']})"
        extra = ", ".join(x for x in (a.get("country"), a.get("sim")) if x)
        out.append("- " + " ".join(x for x in (family_name(it), a.get("storage"), color) if x)
                   + (f" — {extra}" if extra else "") + f" — {_rub_short(it.price)} ₽"
                   + (" — осталось мало" if a.get("few") else ""))
    return out


DEFAULT_TRADE_IN_PRICES = """iPhone 13 — 8 000–13 000 ₽
iPhone 13 Pro — 10 000–15 000 ₽
iPhone 13 Pro Max — 10 000–15 000 ₽
iPhone 14 — 10 000–15 000 ₽
iPhone 14 Pro — 17 000–20 000 ₽
iPhone 14 Pro Max — 22 000–27 000 ₽
iPhone 15 — 17 000–20 000 ₽
iPhone 15 Pro — 25 000–30 000 ₽
iPhone 15 Pro Max — 35 000–40 000 ₽
iPhone 16 — 25 000–30 000 ₽
iPhone 16 Pro — 40 000–45 000 ₽
iPhone 16 Pro Max — 45 000–50 000 ₽
iPhone 17 — 50 000–55 000 ₽
iPhone 17 Pro — 60 000–65 000 ₽
iPhone 17 Pro Max — 65 000–70 000 ₽ (цвет Orange — до 65 000 ₽)

Правила оценки:
- В trade-in принимаем СТРОГО модели из этого списка. Всё остальное (любые Android, Samsung, Xiaomi, iPad, MacBook, часы, iPhone 12 и старше) не берём.
- Это предварительная вилка «до»; итоговую сумму называет менеджер после осмотра.
- 16 Pro и новее с аккумулятором выше 98% — ближе к верхней границе.
- Слабое состояние — ещё дешевле нижней границы.
- 512 ГБ и больше — согласовать с менеджером (handoff=true).
- Разбита задняя крышка или дефект/пятна на дисплее — не берём.
- Если что-то менялось (экран, аккумулятор, корпус, камеры) — согласовать с менеджером (handoff=true)."""
