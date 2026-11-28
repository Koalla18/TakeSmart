"""Распознавание коротких запросов цены и ответы по найденным строкам прайса."""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from src.app.core.avito_catalog import Match, ProductQuery, Scalar, SearchResult, attribute_value, listing_query, model_key
from src.app.core.avito_bot_engine import (
    COLORS, ChatContext, _CAPACITY, _capacity, _line_country, _reply_sim_label, _variant_colors, format_price, normalize,
    MIN_QUOTED_PRICE, quoted_prices, trade_in_amounts,
)

_PRICE_WORD = re.compile(r"\b(?:цен[ауые]|ценник|по\s*ч[её]м|стоимост\w*|сколько стоит)\b", re.IGNORECASE)
_HOW_MUCH = re.compile(r"\b(?:сколько|скока)\b", re.IGNORECASE)
_NON_PRODUCT_AMOUNT = re.compile(
    r"\b(?:цен[ауые]|стоимост\w*)\s+доставк\w*\b|"
    r"\bсколько\s+(?:(?:будет|у вас)\s+)?(?:ждать|времени|остал\w*|штук|сим|симок|занима\w*|ид[её]т|"
    r"(?:стоит\s+)?доставк\w*)\b", re.IGNORECASE,
)
_TRADE_IN_AMOUNT = re.compile(
    r"\b(?:оцен\w*|примете|выкуп\w*|сдать|сдам|доплат\w*|сколько (?:дадите|за мой)|"
    r"(?:с|по)\s+(?:trade[\s-]*in|трейд[\s-]*ин\w*)|с обменом)\b", re.IGNORECASE,
)
_RETAIL_QUESTION = re.compile(r"\b(?:без\s+(?:trade[\s-]*in|трейд[\s-]*ин\w*|обмена)|в розницу|наличными)\b", re.IGNORECASE)
_TRADE_CONJUNCTION = re.compile(r"(?:[?!.\n;,]+|\bи\s+(?:хочу\s+|ещ[её]\s+|можно\s+)?)\s*(?=(?:trade[\s-]*in|трейд[\s-]*ин|сдать|сдам|примете|выкуп))", re.IGNORECASE)
_DEPENDENT_PRODUCT = re.compile(r"\b(?:чехол\w*|стекл\w*|кабел\w*|адаптер\w*|зарядк\w*|ремонт\w*|замен\w*)\b", re.IGNORECASE)
_COMPARISON = re.compile(r"\b(?:сравн\w*|кажд\w*|только не|кроме|или|не\s+ч[её]рн\w*)\b", re.IGNORECASE)
_BARE_TRADE_IN = re.compile(r"\b(?:trade[\s-]*in|трейд[\s-]*ин|сдать|сдам)\b", re.IGNORECASE)
_TRADE_CONTEXT = re.compile(
    r"\b(?:trade[\s-]*in|трейд[\s-]*ин|сда(ть|ете|ёте|ваем\w*)|сдам|не\s+(?:можем\s+)?прин(?:ять|имаем))\b",
    re.IGNORECASE,
)
_TRADE_DEVICE_REQUEST = re.compile(
    r"(?:для\s+оценки|что\s+(?:вы\s+)?(?:сда[её]те|хотите\s+сдать)|"
    r"(?:напишите|укажите|подскажите)\b[^.!?\n]*(?:модел|устройств|телефон))",
    re.IGNORECASE,
)
_OWN_DEVICE = re.compile(r"\b(?:у меня|мой|моя|мо[её]|свой|могу сдать)\b", re.IGNORECASE)
_OFFER_DEVICE = re.compile(r"\b(?:сдать|сдам|примете|выкуп\w*|сколько\s+дадите)\b", re.IGNORECASE)
_BUY_DEVICE = re.compile(r"\b(?:купить|куплю|покупаю|беру|заберу)\b", re.IGNORECASE)
_NO_TRADE_DEVICE = re.compile(r"\b(?:не (?:хочу|буду|планирую) сда(?:ть|вать)|не сдаю)\b", re.IGNORECASE)
_KEEP_ITEM = re.compile(
    r"(?:нет )?(?:я |мне )?(?:(?:хочу|нужен|нужна|надо) )?(?:только|именно) "
    r"(?:этот|эту|это)(?: вариант| модель| товар)?(?: из объявления)?(?: хочу| нужен| нужна)?"
)
_PRODUCT_CATEGORY = re.compile(r"\b(?:планшет\w*|смартфон\w*|ноутбук\w*|наушник\w*|пылесос\w*|приставк\w*)\b", re.IGNORECASE)
_PHYSICAL_SIM = re.compile(r"\bфизическ\w*\s+(?:sim|сим)(?:[- ]карт\w*)?\b", re.IGNORECASE)
_ORDINAL_OPTION = re.compile(
    r"(?:а |и )?(?:(?:у|на|за) )?(перв\w+|втор\w+|трет\w+|четверт\w+|[1-4])"
    r"(?: вариант\w*)?(?: сколько(?: стоит)?| по чем| цена)?$"
)
_SUPPLEMENT_CLAUSE = re.compile(
    r"(?<=[.!?;])\s+|\n+|,\s*(?=(?:(?:а|и|по)\s+)*(?:гарант|достав|самовывоз|цена|стоимост|ценник))",
    re.IGNORECASE,
)
_SERVICE_FEE = re.compile(r"\b(?:достав\w*|предоплат\w*|пвз|сдэк|курьер\w*)\b", re.IGNORECASE)
_PRICE_CLAUSE = re.compile(r"\b(?:цен[аыуеой]*|ценник\w*|стоимост\w*|прайс\w*|по\s*ч[её]м)\b", re.IGNORECASE)
_VARIANT_FILLER = re.compile(
    r"\b(?:а|и|да|мне|вам|у|вас|нужен|нужна|нужно|нужны|надо|хочу|хотел|хотела|"
    r"бы|можно|есть|имеется|бывает|в|на|цвет|цвете|цвета|вариант|памяти|только|пожалуйста|подскажите)\b"
)
_AVAILABILITY_TURN = re.compile(
    r"(?:(?:а|подскажите|пожалуйста) )*"
    r"(?:(?:еще )?(?:в наличии|продается)|(?:еще )?есть(?: в наличии)?|наличие|товар еще есть)"
)
_COLOR_TURN = re.compile(r"(?:(?:а|подскажите|пожалуйста) )*(?:какие цвета(?: есть| в наличии)?|в каких цветах(?: есть)?)")
_TRANSFER = re.compile(r"\b(?:перевод\w*|безнал\w*|реквизит\w*|бик|(?:расч[её]тн\w*|номер)\s+сч[её]т\w*)\b", re.IGNORECASE)
_CARD = re.compile(r"\b(?:(?:по|оплата)\s+карт\w*|картой|qr|куар)\b", re.IGNORECASE)
_CARD_FOLLOWUP = re.compile(r"\s*(?:а\s+)?(?:по карте|картой|qr|куар)\s*\?*\s*", re.IGNORECASE)
_SUPPLEMENT = re.compile(
    r"\b(?:достав\w*|отправ\w*|брон\w*|отлож\w*|заброниру\w*|беру|"
    r"гарант\w*|где|адрес\w*|самовывоз\w*|рассроч\w*|кредит\w*|скид\w*|уступ\w*)\b", re.IGNORECASE,
)
_IPHONE = re.compile(
    r"\b(?:(?:iphone|айфон\w*)\s*(?P<version>\d{2}(?:e|с)?|duo|дуо|air|эйр|se|x[rs]?)|(?P<duo>duo|дуо))"
    r"(?:(?:\s*)(?P<trim>pro\s*max|про\s*макс|pro|про|plus|плюс|max|макс|mini|мини|air|эйр|duo|дуо)|(?P<plus>\+))?"
    r"(?![\w+])", re.IGNORECASE,
)
_SAMSUNG = re.compile(
    r"\b(?:(?:samsung|самсунг|galaxy|галакси)\s+)*(?P<version>[сsаa]\s*\d{2}[eе]?)"
    r"(?:(?:\s*)(?P<trim>ultra|ультр[ау]|plus|плюс|fe)|(?P<plus>\+))?(?![\w+])", re.IGNORECASE,
)
_SAMSUNG_RADIO = re.compile(r"\b([45]\s*g|lte)\b", re.IGNORECASE)
_TRIMS = {
    "про": "Pro", "промакс": "Pro Max", "promax": "Pro Max", "плюс": "Plus",
    "макс": "Max", "мини": "Mini", "эйр": "Air", "дуо": "Duo", "ультра": "Ultra", "ультру": "Ultra", "fe": "FE",
}
_OTHER_PRODUCT = re.compile(
    r"\b(?:iphone|айфон\w*|samsung|самсунг|galaxy|галакси|pixel|пиксел\w*|xiaomi|redmi|poco|"
    r"dyson|дайсон|(?:hs|ht)\d{2}|macbook|макбук\w*|ipad|ipod|айпад\w*|airpods|apple watch|playstation|ps5)\b", re.IGNORECASE,
)
_TERABYTE = re.compile(r"\b(?:(1|2|4|8)\s*)?терабайт\w*\b", re.IGNORECASE)
_BARE_RAM = re.compile(r"(?<![\w/])(4|6|8|12|16|18|24)\s+(?=(?:128|256|512|1024)\b)")
_SENT_PRICE = re.compile(r"^(?P<title>.+?)\s+—\s+\d[\d\s]*\s*₽(?:\s+без trade-in)?(?:\s+\(картой — [\d\s]+₽\))?\.?\s*$")
_rendered_colors: dict[str, set[str]] = defaultdict(set)
for _official_color, _translated_color in COLORS.values():
    _rendered_colors[_translated_color.casefold()].add(_official_color)
_QUOTE_COLORS = {label: next(iter(names)) for label, names in _rendered_colors.items() if len(names) == 1}
_QUOTE_COLOR = re.compile(
    r",\s*(" + "|".join(re.escape(label) for label in sorted(_QUOTE_COLORS, key=len, reverse=True)) + r")(?=\s*(?:,|$))",
    re.IGNORECASE,
)
_BUYER_VOICE = re.compile(
    r"^\s*(?:(?:[А-ЯЁ][а-яё-]+),\s*)?(?:(?:добрый (?:день|вечер)|доброе утро|здравствуйте|привет)[!.,\s]+)?"
    r"(?:подскажите(?:, пожалуйста)?,?\s+(?:есть ли|можно ли|сколько стоит|какая цена|"
    r"какие у вас|где вы|принимаете ли|вы\s+(?:принимаете|прода[её]те))|"
    r"(?:могу ли я|могу я|можно ли)\s+(?:вам\s+)?(?:оплатить|купить|приехать|перевести|сделать перевод)|"
    r"(?:хочу|хотел[аи] бы)\s+(?:у вас\s+)?(?:купить|узнать цену|заказать))\b", re.IGNORECASE,
)


@dataclass
class QuoteRequest:
    queries: list[ProductQuery]
    payment: Literal["card", "transfer"] | None = None
    supplement: bool = False
    trade_in: bool = False
    has_separate_product: bool = False
    variant_choice: bool = False
    clarification: str | None = None


def retail_part(pending: str) -> str:
    return _TRADE_CONJUNCTION.split(pending, maxsplit=1)[0] if _BARE_TRADE_IN.search(pending) else pending


def can_resolve_from_words(pending: str) -> bool:
    return not (_DEPENDENT_PRODUCT.search(pending) or _COMPARISON.search(pending))


def query_from_words(subject: ProductQuery, text: str) -> ProductQuery:
    attrs, sizes, _ = _options(text, subject.brand)
    if len(sizes) == 1:
        attrs = _with_capacity(attrs, *sizes[0])
    return subject.model_copy(update={"attributes": attrs})


def _named_phone(text: str) -> tuple[ProductQuery | None, str]:
    matches = [(match, brand) for pattern, brand in ((_IPHONE, "Apple"), (_SAMSUNG, "Samsung"))
               for match in pattern.finditer(text)]
    if len(matches) != 1:
        return None, text
    match, brand = matches[0]
    version = normalize(match["version"] or "duo").replace(" ", "")
    version = {"дуо": "duo", "эйр": "air"}.get(version, version)
    if brand == "Samsung":
        version = version.translate(str.maketrans("сае", "sae"))
    trim = normalize(match["trim"] or ("plus" if match["plus"] else "")).replace(" ", "")
    suffix = _TRIMS.get(trim, trim.title())
    model = f"{'iPhone' if brand == 'Apple' else 'Galaxy'} {version.title() if brand == 'Apple' else version.upper()}"
    if suffix:
        model += f" {suffix}"
    remainder = text[:match.start()] + " " + text[match.end():]
    if brand == "Samsung" and (radio := _SAMSUNG_RADIO.search(remainder)):
        model += f" {normalize(radio[1]).replace(' ', '').upper()}"
    return ProductQuery(brand=brand, category="smartphone", model=model), remainder


def _options(text: str, brand: str | None) -> tuple[dict[str, Scalar], list[tuple[str | None, int]], set[str]]:
    capacities = list(dict.fromkeys(
        _capacity(match) for match in _CAPACITY.finditer(_TERABYTE.sub(lambda m: f"{m[1] or '1'} ТБ", text))
    ))
    colors = _variant_colors(text)
    if "burgundy" in colors and re.search(r"\bкрасн\w*\b", text, re.IGNORECASE):
        colors = colors - {"burgundy"} | {"red"}
    attrs: dict[str, Scalar] = {}
    if len(colors) == 1:
        attrs["color"] = next(iter(colors))
    if sim := _reply_sim_label(("iPhone " if brand == "Apple" else "") + text):
        attrs["sim"] = attribute_value("sim", sim)
    elif _PHYSICAL_SIM.search(text):
        attrs["sim"] = "has_physical"
    if country := _line_country(text):
        attrs["region"] = attribute_value("region", country)
    if brand == "Samsung" and len(capacities) == 1 and not capacities[0][0] and (ram := _BARE_RAM.search(text)):
        capacities = [(ram[1], capacities[0][1])]
    return attrs, capacities, colors


def _with_capacity(attrs: dict[str, Scalar], ram: str | None, size: int) -> dict[str, Scalar]:
    return {**attrs, "storage_gb": size, **({"ram_gb": int(ram)} if ram else {})}


def trade_in_followup(history: list[tuple[str, str]]) -> bool:
    """Recognize a reply giving the old device after the store asked about an exchange."""
    for author, message in reversed(history[-10:]):
        if author == "client":
            if retail_part(message) == message and not _TRADE_CONTEXT.search(message) and _PRICE_WORD.search(message):
                return False
            if _TRADE_CONTEXT.search(message) and not re.search(r"\bбез\s+(?:trade|трейд|обмена)", message, re.I):
                return True
        elif _TRADE_CONTEXT.search(message) and (
            _TRADE_DEVICE_REQUEST.search(message) or re.search(r"\bне\s+(?:можем\s+)?прин", message, re.I)
        ):
            return True
    return False


def trade_in_phone(history: list[tuple[str, str]], pending: str) -> ProductQuery | None:
    retail = retail_part(pending)
    separate = retail != pending
    offer = pending[len(retail):] if separate else pending
    if _NO_TRADE_DEVICE.search(offer):
        return None
    if not separate and (_PRICE_WORD.search(offer) or _HOW_MUCH.search(offer) or _BUY_DEVICE.search(offer)):
        if not (_OWN_DEVICE.search(offer) or _OFFER_DEVICE.search(offer)):
            return None
    if not separate and not (_TRADE_CONTEXT.search(offer) or _OFFER_DEVICE.search(offer)):
        if (_PRICE_WORD.search(offer) or _HOW_MUCH.search(offer) or _SUPPLEMENT.search(offer)
                or not trade_in_followup(history)):
            return None
    if re.search(r"\bбез\s+(?:trade|трейд|обмена)", offer, re.I) and not _OWN_DEVICE.search(offer):
        return None
    named, remainder = _named_phone(offer)
    if not named:
        return None
    phone = query_from_words(named, remainder)
    if "storage_gb" in phone.attributes:
        return phone
    for index, (author, message) in reversed(list(enumerate(history))[-10:]):
        if author != "client":
            continue
        old = retail_part(message)
        if old != message:
            old = message[len(old):]
        elif not (_TRADE_CONTEXT.search(message) or _OWN_DEVICE.search(message)
                  or (not _PRICE_WORD.search(message) and trade_in_followup(history[:index]))):
            continue
        previous, remainder = _named_phone(old)
        if previous and previous.model == named.model:
            prior = query_from_words(previous, remainder)
            if "storage_gb" in prior.attributes:
                return phone.model_copy(update={"attributes": {**prior.attributes, **phone.attributes}})
    return phone


def trade_in_rejection(phone: ProductQuery | None, policy: str) -> str | None:
    if not phone or not phone.model:
        return None
    accepted = set()
    for line in policy.splitlines():
        parts = re.split(r"\s+[—–-]\s+|:\s+", line.lstrip(" \t•-·"), maxsplit=1)
        if len(parts) != 2 or not trade_in_amounts(parts[1]):
            continue
        model, remainder = _named_phone(parts[0])
        if model and not normalize(remainder).strip():
            accepted.add((model.brand, model.model))
    if not accepted or (phone.brand, phone.model) in accepted:
        return None
    size = phone.attributes.get("storage_gb")
    device = phone.model + (f" на {size // 1024} ТБ" if isinstance(size, int) and size % 1024 == 0
                           else f" на {size} ГБ" if isinstance(size, int) else "")
    return f"Понял, вы хотите сдать {device}. К сожалению, эту модель мы сейчас не принимаем по trade-in."


def _short_variant_choice(text: str, sizes: list[tuple[str | None, int]], colors: set[str]) -> bool:
    if not (sizes or colors):
        return False
    value = normalize(_CAPACITY.sub(" ", _TERABYTE.sub(" ", text)))
    value = " ".join(_VARIANT_FILLER.sub(" ", value).split())
    if not value:
        return bool(sizes)
    return bool(colors and (value in COLORS or len(value.split()) == 1 and _variant_colors(value) == colors))


def _sent_subject(title: str) -> ProductQuery | None:
    title = _QUOTE_COLOR.sub(lambda match: ", " + _QUOTE_COLORS[match[1].casefold()], title)
    parsed = listing_query(title)
    named, remainder = _named_phone(title)
    if not parsed or not named or parsed.brand != named.brand:
        return parsed
    # A localized color in a rendered older quote may not be understood by the import parser.
    # The phone's actual family is still identifiable without taking the color as part of its name.
    return parsed.model_copy(update={"model": named.model, "attributes": {
        **parsed.attributes, **query_from_words(named, remainder).attributes,
    }})


def conversation_subject(ctx: ChatContext) -> tuple[ProductQuery | None, bool]:
    """Последний товар по уже отправленным предложениям и явным репликам покупателя."""
    if ctx.quoted_subject is not None:
        return (ProductQuery.model_validate(ctx.quoted_subject) if ctx.quoted_subject.get("model")
                or ctx.quoted_subject.get("model_id") else None), True
    history = list(ctx.history)
    while history and history[-1][0] == "client":
        history.pop()
    for index, (author, message) in reversed(list(enumerate(history))):
        if author != "client":
            quoted = [_sent_subject(match["title"].lstrip("• -")) for line in message.splitlines()
                      if (match := _SENT_PRICE.fullmatch(line))]
            quoted = [query for query in quoted if query and query.brand]
            if quoted:
                subject = quoted[0]
                if any(model_key(query.model or "", query.brand or "") !=
                       model_key(subject.model or "", subject.brand or "") for query in quoted):
                    return None, True
                common = {k: v for k, v in subject.attributes.items() if all(q.attributes.get(k) == v for q in quoted)}
                return subject.model_copy(update={"attributes": common, "reference": "conversation"}), True
        else:
            purchase = retail_part(message)
            if purchase != message:
                message = purchase
            elif trade_in_phone(history[:index], message) or (
                _TRADE_IN_AMOUNT.search(message) and not _RETAIL_QUESTION.search(message)
            ):
                continue
        named, remainder = _named_phone(message)
        if named:
            attrs, sizes, _ = _options(remainder, named.brand)
            if len(sizes) == 1:
                attrs = _with_capacity(attrs, *sizes[0])
            return named.model_copy(update={"attributes": attrs, "reference": "conversation"}), True
        if author == "client" and _OTHER_PRODUCT.search(message):
            return None, True
    return None, False


def quoted_subject(search: list[dict]) -> dict:
    """Храним выбранную комплектацию или однозначный запрос с обязательными условиями."""
    options = []
    seen = set()
    for result in search:
        query = result["query"]
        for match in result["matches"]:
            if not match.get("shown") or match["id"] in seen:
                continue
            seen.add(match["id"])
            attrs = {key: value for key, value in match["attributes"].items() if key != "few"}
            options.append({**query, "model": match["model"], "model_id": match["model_id"],
                            "attributes": attrs, "required": [key for key in query.get("required", []) if key in attrs],
                            "reference": "conversation"})
    context = {"options": options} if len(options) > 1 else {}
    exact = [(result["query"], match) for result in search for match in result["matches"] if match["relation"] == "exact"]
    if not exact:
        if len(search) == 1 and search[0]["status"] in ("same_model", "unavailable"):
            return {**context, **search[0]["query"], "reference": "conversation"}
        return context
    first_query, first_match = exact[0]
    if any(other.get("model_id") != first_match.get("model_id") for _, other in exact):
        return context
    shared = {key: value for key, value in first_match["attributes"].items()
              if key != "few" and all(other["attributes"].get(key) == value for _, other in exact)}
    required = [key for key in first_query.get("required", []) if all(
        key in query.get("required", []) and query["attributes"].get(key) == first_query["attributes"].get(key)
        for query, _ in exact
    )]
    shared.update({key: first_query["attributes"][key] for key in required})
    return {**context, **first_query, "model": first_match.get("model") or first_query.get("model"),
            "attributes": shared, "required": required, "reference": "conversation",
            "model_id": first_match.get("model_id")}


def price_request(ctx: ChatContext, pending: str) -> QuoteRequest | None:
    purchase = retail_part(pending)
    subject, discussed = conversation_subject(ctx)
    listing = listing_query(ctx.item_title)
    named, remainder = _named_phone(purchase)
    payment = "transfer" if _TRANSFER.search(pending) else "card" if _CARD.search(pending) else None
    options = (ctx.quoted_subject or {}).get("options")
    if options and (ordinal := _ORDINAL_OPTION.fullmatch(normalize(purchase))):
        word = ordinal[1]
        number = int(word) if word.isdigit() else next(i for i, stem in enumerate(("перв", "втор", "трет", "четверт"), 1)
                                                       if word.startswith(stem))
        if number <= len(options):
            return QuoteRequest([ProductQuery.model_validate(options[number - 1])], payment)
        return QuoteRequest([], payment, clarification="Подскажите, пожалуйста, какой вариант из списка вы имеете в виду?")
    possible_price = _NON_PRODUCT_AMOUNT.sub(" ", purchase)
    explicit = bool(_PRICE_WORD.search(possible_price) or _HOW_MUCH.search(possible_price))
    last_answer = next((message for author, message in reversed(ctx.history) if author in ("bot", "staff")), "")
    follow_up = bool(discussed and (ctx.quoted_subject or quoted_prices(last_answer))
                     and re.match(r"^\s*(?:а\s+|и\s+)?(?:на\s+)?[\w-]+", pending)
                     and (pending.strip().endswith("?") or re.match(r"^\s*а\s+", pending, re.IGNORECASE))
                     and not re.search(r"\b(?:наличи\w*|есть|остал\w*)\b", pending, re.IGNORECASE))
    requires_interpretation = (
        named is None and any(pattern.search(purchase) for pattern in (_OTHER_PRODUCT, _IPHONE, _SAMSUNG, _PRODUCT_CATEGORY))
    ) or not can_resolve_from_words(purchase)
    source = named or (subject if discussed else listing)
    extra, capacities, colors = _options(remainder, source.brand if source else None)
    short_turn = normalize(purchase)
    keep_item = bool(_KEEP_ITEM.fullmatch(short_turn))
    if keep_item:
        source = (subject if ctx.quoted_subject and "из объявления" not in short_turn else listing) or subject
    color_menu = bool(_COLOR_TURN.fullmatch(short_turn))
    variant_choice = bool(not named and not requires_interpretation and (
        keep_item or color_menu or _AVAILABILITY_TURN.fullmatch(short_turn) or _short_variant_choice(purchase, capacities, colors)
    ))
    changed_options = bool(extra or capacities or colors)
    wants_price = explicit or variant_choice or (follow_up and changed_options) or (payment == "card" and _CARD_FOLLOWUP.fullmatch(pending))
    trade_in = bool(_BARE_TRADE_IN.search(pending) and not (_RETAIL_QUESTION.search(pending) and purchase == pending))
    if not wants_price or (_TRADE_IN_AMOUNT.search(purchase) and not _RETAIL_QUESTION.search(purchase)):
        return None

    supplement = bool(_SUPPLEMENT.search(pending))
    if not source and variant_choice:
        return QuoteRequest([], payment, supplement, trade_in, variant_choice=True,
                            clarification="Подскажите, пожалуйста, какая модель вам нужна?")
    if not source or requires_interpretation or len(colors) > 1:
        return QuoteRequest([], payment, supplement, trade_in, not can_resolve_from_words(purchase))
    attrs = dict(source.attributes)
    if color_menu:
        attrs.pop("color", None)
    if named:
        reference = subject if discussed else listing
        if reference and model_key(reference.model or "", reference.brand or "") == model_key(named.model or "", named.brand or ""):
            attrs.update({k: v for k, v in reference.attributes.items() if k in ("sim", "region")})
    elif not discussed and colors and not capacities and not variant_choice:
        attrs.pop("storage_gb", None)
        attrs.pop("ram_gb", None)
    attrs.update(extra)
    options = [_with_capacity(attrs, *capacity) for capacity in capacities] if capacities else [attrs]
    required = [key for key in source.required if all(key in option for option in options)]
    if re.search(r"\b(?:только|обязательно|строго)\b", pending, re.IGNORECASE):
        required.extend(key for key in extra if key not in required)
        required_size = any(_CAPACITY.search(clause) or _TERABYTE.search(clause) for clause in re.findall(
            r"\b(?:только|обязательно|строго)\b[^.!?\n;]*", pending, re.IGNORECASE))
        if capacities and required_size and "storage_gb" not in required:
            required.append("storage_gb")
    if keep_item:
        required = list(attrs)
    queries = [source.model_copy(update={"attributes": attrs_, "required": required}) for attrs_ in options[:6]]
    return QuoteRequest(queries, payment, supplement, trade_in, variant_choice=variant_choice)


def _line(match: Match, card_markup: Decimal | None = None) -> str:
    item = match.item
    name = item.name
    color = item.attributes.get("color")
    if color and (label := COLORS.get(color)):
        name = re.sub(rf"\b{re.escape(label[0])}\b", label[1], name, flags=re.IGNORECASE)
    details = []
    if storage := item.attributes.get("storage"):
        if normalize(storage) not in normalize(name) and not ("/" in storage and normalize(storage.split("/")[-1]) in normalize(name)):
            size = item.attributes.get("catalog_attributes", {}).get("storage_gb")
            if not (isinstance(size, int) and size % 1024 == 0 and re.search(rf"\b{size // 1024}\s*(?:тб|tb)\b", name, re.I)):
                details.append(storage)
    if color and not any(normalize(label_part) in normalize(name) for label_part in COLORS.get(color, (color,))):
        details.append(COLORS.get(color, (color, color))[1])
    details.extend(item.attributes[key] for key in ("country", "sim") if item.attributes.get(key))
    title = ", ".join([name, *details])
    line = f"{title} — {format_price(int(item.price))} ₽ без trade-in"
    if card_markup is not None:
        card_total = int((Decimal(str(item.price)) * (1 + card_markup / 100)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        line += f" (картой — {format_price(card_total)} ₽)"
    return line


def _shown_matches(result: SearchResult) -> list[Match]:
    if result.status == "same_model":
        sim_unverified = [match for match in result.matches if match.relation == "same_model"
                          and set(match.differences) == {"sim"} and match.differences["sim"]["found"] is None]
        if sim_unverified:
            return sim_unverified[:4]
    exact = [match for match in result.matches if match.relation == "exact"]
    candidates = exact or result.matches
    if not exact:
        if "storage_gb" in result.query.attributes:
            same_storage = [match for match in candidates if "storage_gb" not in match.differences]
            if same_storage:
                return same_storage[:2]
        return candidates[:2]
    storage = {m.item.attributes.get("storage") for m in exact}
    if "storage_gb" not in result.query.attributes and len(storage) > 1:
        first_by_storage = {}
        for match in exact:
            first_by_storage.setdefault(match.item.attributes.get("storage"), match)
        candidates = list(first_by_storage.values())
    return candidates[:4]


def quote_trace(results: list[SearchResult], with_prices: bool) -> list[dict]:
    trace = []
    seen = set()
    for result in results:
        row = result.context()
        shown = {match.item.key: _line(match) for match in _shown_matches(result)} if with_prices else {}
        for match in row["matches"]:
            line = shown.get(match["id"])
            if line and line not in seen:
                match["shown"] = True
                seen.add(line)
        trace.append(row)
    return trace


def format_quote(results: list[SearchResult], card_markup: Decimal | None = None) -> str:
    if not results or all(r.status == "ambiguous" for r in results):
        return "Подскажите, пожалуйста, какую модель вы имеете в виду?"
    lines = []
    seen = set()
    for result in results:
        matches = _shown_matches(result)
        if result.status == "same_model" and matches and set(matches[0].differences) == {"sim"} and matches[0].differences["sim"]["found"] is None:
            # Прайс подтверждает модель, память и цвет. Отдельно обозначаем непроверенную SIM.
            lines.append("Цены по прайсу. Тип SIM у конкретного экземпляра нужно подтвердить.")
        elif result.status != "exact":
            query = result.query
            details = [query.model or query.brand or ""]
            if color := query.attributes.get("color"):
                details.append(COLORS.get(str(color), (str(color), str(color)))[1])
            if size := query.attributes.get("storage_gb"):
                details.append(f"{size // 1024} ТБ" if isinstance(size, int) and size % 1024 == 0 else f"{size} ГБ")
            target = ", ".join(filter(None, details))
            if result.status == "unavailable":
                lines.append(f"{target or 'Запрошенная комплектация'} сейчас отмечена в прайсе как недоступная.")
            else:
                if result.status == "same_model" and target:
                    lines.append(f"В актуальном прайсе нет точной комплектации: {target}.")
                else:
                    lines.append(f"Цену на {target} пока не могу подтвердить." if target else "Пока не могу подтвердить цену.")
            if matches:
                lines.append("Из доступных вариантов:")
        for match in matches:
            line = _line(match, card_markup)
            if line not in seen:
                lines.append(line)
                seen.add(line)
    return "\n".join(lines)


def supplemental_question(text: str) -> str:
    """Keep an independently phrased additional question, with the catalog result as its product context."""
    parts = _SUPPLEMENT_CLAUSE.split(text)
    questions = [part.strip() for part in parts if _SUPPLEMENT.search(part) and not _PRICE_CLAUSE.search(part)]
    return "\n".join(questions)


def without_retail_prices(reply: str) -> str:
    """Leave retail prices to the catalog, including statements about whether they are known."""
    kept = []
    for clause in _SUPPLEMENT_CLAUSE.split(reply):
        amounts = trade_in_amounts(clause)
        service_fee = _SERVICE_FEE.search(clause) and (not amounts or max(amounts) < MIN_QUOTED_PRICE)
        if service_fee or not (amounts or _PRICE_CLAUSE.search(clause)):
            kept.append(clause.strip())
    text = " ".join(part for part in kept if part)
    return text[:1].upper() + text[1:]


def without_trade_in_restatement(reply: str) -> str:
    return " ".join(part.strip() for part in _SUPPLEMENT_CLAUSE.split(reply) if part.strip()
                    and not re.search(r"\b(?:trade[\s-]*in|трейд[\s-]*ин|в зач[её]т)\b", part, re.I))


def remove_buyer_voice(reply: str, pending: str) -> str:
    original = {normalize(line) for line in pending.splitlines() if len(normalize(line)) >= 15}
    blocks = []
    for block in re.split(r"\n\s*\n", reply):
        if normalize(block) in original or _BUYER_VOICE.search(block):
            continue
        sentences = re.split(r"(?<=[.!?])\s+", block.strip())
        kept = []
        for sentence in sentences:
            if normalize(sentence) in original or _BUYER_VOICE.search(sentence):
                break
            kept.append(sentence)
        if kept and (validated := " ".join(kept).strip()):
            blocks.append(validated)
    return "\n\n".join(blocks)
