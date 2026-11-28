"""Распознавание коротких запросов цены и ответы по найденным строкам прайса."""
from __future__ import annotations

import re
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
_PRODUCT_CATEGORY = re.compile(r"\b(?:планшет\w*|смартфон\w*|ноутбук\w*|наушник\w*|пылесос\w*|приставк\w*)\b", re.IGNORECASE)
_SUPPLEMENT_CLAUSE = re.compile(
    r"(?<=[.!?;])\s+|\n+|,\s*(?=(?:(?:а|и|по)\s+)*(?:гарант|достав|самовывоз|цена|стоимост|ценник))",
    re.IGNORECASE,
)
_SERVICE_FEE = re.compile(r"\b(?:достав\w*|предоплат\w*|пвз|сдэк|курьер\w*)\b", re.IGNORECASE)
_PRICE_CLAUSE = re.compile(r"\b(?:цен[аыуеой]*|ценник\w*|стоимост\w*|прайс\w*|по\s*ч[её]м)\b", re.IGNORECASE)
_TRANSFER = re.compile(r"\b(?:перевод\w*|безнал\w*|реквизит\w*|бик|(?:расч[её]тн\w*|номер)\s+сч[её]т\w*)\b", re.IGNORECASE)
_CARD = re.compile(r"\b(?:(?:по|оплата)\s+карт\w*|картой|qr|куар)\b", re.IGNORECASE)
_CARD_FOLLOWUP = re.compile(r"\s*(?:а\s+)?(?:по карте|картой|qr|куар)\s*\?*\s*", re.IGNORECASE)
_SUPPLEMENT = re.compile(
    r"\b(?:достав\w*|отправ\w*|брон\w*|отлож\w*|заброниру\w*|беру|"
    r"гарант\w*|где|адрес\w*|самовывоз\w*|рассроч\w*|кредит\w*|скид\w*|уступ\w*)\b", re.IGNORECASE,
)
_IPHONE = re.compile(
    r"\b(?:(?:iphone|айфон\w*)\s*(?P<version>\d{2}(?:e|с)?|duo|дуо|air|эйр|se|x[rs]?)|(?P<duo>duo|дуо))"
    r"(?:(?:\s*)(?P<trim>pro\s*max|про\s*макс|pro|про|plus|плюс|max|макс|mini|мини|air|эйр)|(?P<plus>\+))?"
    r"(?![\w+])", re.IGNORECASE,
)
_SAMSUNG = re.compile(
    r"\b(?:(?:samsung|самсунг|galaxy|галакси)\s+)*(?P<version>[сsаa]\s*\d{2}[eе]?)"
    r"(?:(?:\s*)(?P<trim>ultra|ультр[ау]|plus|плюс|fe)|(?P<plus>\+))?(?![\w+])", re.IGNORECASE,
)
_SAMSUNG_RADIO = re.compile(r"\b([45]\s*g|lte)\b", re.IGNORECASE)
_TRIMS = {
    "про": "Pro", "промакс": "Pro Max", "promax": "Pro Max", "плюс": "Plus",
    "макс": "Max", "мини": "Mini", "эйр": "Air", "ультра": "Ultra", "ультру": "Ultra", "fe": "FE",
}
_OTHER_PRODUCT = re.compile(
    r"\b(?:iphone|айфон\w*|samsung|самсунг|galaxy|галакси|pixel|пиксел\w*|xiaomi|redmi|poco|"
    r"dyson|дайсон|(?:hs|ht)\d{2}|macbook|макбук\w*|ipad|ipod|айпад\w*|airpods|apple watch|playstation|ps5)\b", re.IGNORECASE,
)
_TERABYTE = re.compile(r"\b(?:(1|2|4|8)\s*)?терабайт\w*\b", re.IGNORECASE)
_BARE_RAM = re.compile(r"(?<![\w/])(4|6|8|12|16|18|24)\s+(?=(?:128|256|512|1024)\b)")
_SENT_PRICE = re.compile(r"^(?P<title>.+?)\s+—\s+\d[\d\s]*\s*₽(?:\s+без trade-in)?(?:\s+\(картой — [\d\s]+₽\))?\.?\s*$")
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
    if country := _line_country(text):
        attrs["region"] = attribute_value("region", country)
    if brand == "Samsung" and len(capacities) == 1 and not capacities[0][0] and (ram := _BARE_RAM.search(text)):
        capacities = [(ram[1], capacities[0][1])]
    return attrs, capacities, colors


def _with_capacity(attrs: dict[str, Scalar], ram: str | None, size: int) -> dict[str, Scalar]:
    return {**attrs, "storage_gb": size, **({"ram_gb": int(ram)} if ram else {})}


def conversation_subject(ctx: ChatContext) -> tuple[ProductQuery | None, bool]:
    """Последний товар по уже отправленным предложениям и явным репликам покупателя."""
    if ctx.quoted_subject is not None:
        return (ProductQuery.model_validate(ctx.quoted_subject) if ctx.quoted_subject else None), True
    history = list(ctx.history)
    while history and history[-1][0] == "client":
        history.pop()
    for author, message in reversed(history):
        if author != "client":
            quoted = [listing_query(match["title"].lstrip("• -")) for line in message.splitlines()
                      if (match := _SENT_PRICE.fullmatch(line))]
            quoted = [query for query in quoted if query and query.brand]
            if quoted:
                subject = quoted[0]
                if any(model_key(query.model or "", query.brand or "") !=
                       model_key(subject.model or "", subject.brand or "") for query in quoted):
                    return None, True
                common = {k: v for k, v in subject.attributes.items() if all(q.attributes.get(k) == v for q in quoted)}
                return subject.model_copy(update={"attributes": common, "reference": "conversation"}), True
        elif _TRADE_IN_AMOUNT.search(message) and not _RETAIL_QUESTION.search(message):
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
    """Контекст только по вариантам, для которых покупатель получил подтверждённую цену."""
    exact = [(result["query"], match) for result in search for match in result["matches"] if match["relation"] == "exact"]
    if not exact:
        return {}
    first_query, first_match = exact[0]
    if any(other.get("model_id") != first_match.get("model_id") for _, other in exact):
        return {}
    shared = {key: value for key, value in first_match["attributes"].items()
              if key != "few" and all(other["attributes"].get(key) == value for _, other in exact)}
    return {**first_query, "model": first_match.get("model") or first_query.get("model"),
            "attributes": shared, "required": [], "reference": "conversation",
            "model_id": first_match.get("model_id")}


def price_request(ctx: ChatContext, pending: str) -> QuoteRequest | None:
    purchase = retail_part(pending)
    subject, discussed = conversation_subject(ctx)
    listing = listing_query(ctx.item_title)
    named, remainder = _named_phone(purchase)
    payment = "transfer" if _TRANSFER.search(pending) else "card" if _CARD.search(pending) else None
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
    extra, capacities, colors = _options(remainder, source.brand if source else None) if explicit or follow_up or payment else ({}, [], set())
    changed_options = bool(extra or capacities or colors)
    wants_price = explicit or (follow_up and changed_options) or (payment == "card" and _CARD_FOLLOWUP.fullmatch(pending))
    trade_in = bool(_BARE_TRADE_IN.search(pending) and not (_RETAIL_QUESTION.search(pending) and purchase == pending))
    if not wants_price or (_TRADE_IN_AMOUNT.search(purchase) and not _RETAIL_QUESTION.search(purchase)):
        return None

    supplement = bool(_SUPPLEMENT.search(pending))
    if not source or requires_interpretation or len(colors) > 1:
        return QuoteRequest([], payment, supplement, trade_in, not can_resolve_from_words(purchase))
    attrs = dict(source.attributes)
    if named:
        reference = subject if discussed else listing
        if reference and model_key(reference.model or "", reference.brand or "") == model_key(named.model or "", named.brand or ""):
            attrs.update({k: v for k, v in reference.attributes.items() if k in ("sim", "region")})
    elif not discussed and colors and not capacities:
        attrs.pop("storage_gb", None)
        attrs.pop("ram_gb", None)
    attrs.update(extra)
    options = [_with_capacity(attrs, *capacity) for capacity in capacities] if capacities else [attrs]
    required = []
    if re.search(r"\b(?:только|обязательно|строго)\b", pending, re.IGNORECASE):
        required.extend(extra)
        if capacities:
            required.append("storage_gb")
    queries = [source.model_copy(update={"attributes": attrs_, "required": required}) for attrs_ in options[:6]]
    return QuoteRequest(queries, payment, supplement, trade_in)


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
    exact = [match for match in result.matches if match.relation == "exact"]
    candidates = exact or result.matches
    if not exact:
        return candidates[:2]
    storage = {m.item.attributes.get("storage") for m in exact}
    if "storage_gb" not in result.query.attributes and len(storage) > 1:
        first_by_storage = {}
        for match in exact:
            first_by_storage.setdefault(match.item.attributes.get("storage"), match)
        candidates = list(first_by_storage.values())
    return candidates[:4]


def format_quote(results: list[SearchResult], card_markup: Decimal | None = None) -> str:
    if not results or all(r.status == "ambiguous" for r in results):
        return "Подскажите, пожалуйста, какую модель вы имеете в виду?"
    lines = []
    seen = set()
    for result in results:
        matches = _shown_matches(result)
        if result.status != "exact":
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
