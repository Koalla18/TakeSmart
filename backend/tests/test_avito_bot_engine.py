"""Тесты решения Авито-бота без базы и сети: python -m pytest tests/ (или python tests/test_avito_bot_engine.py)."""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.app.core.avito_bot_engine import (  # noqa: E402
    MSK, ChatContext, PromptConfig, build_messages, build_system_prompt, catalog_tokens, keyword_matches,
    match_rule, normalize, parse_llm_answer, rule_in_schedule, starts_with_refusal,
)


@dataclass
class R:
    id: str
    keywords: list[str]
    answer: str
    verbatim: bool = True
    time_from: str = "00:00"
    time_to: str = "23:59"
    days: list[int] = field(default_factory=lambda: list(range(7)))
    delay_seconds: int = 1
    max_per_chat: int = 1
    is_active: bool = True
    sort: int = 0


NOW = datetime(2026, 11, 24, 13, 0, tzinfo=MSK)  # вторник
RULES = [
    R("addr", ["адрес", "как вас найти", "где вы находитесь"], "ТЦ Багратионовский, павильон А60"),
    R("thanks", ["спасибо", "ок"], "Желаете оформить доставку или забронировать товар?", delay_seconds=5),
    R("warranty", ["гарантия", "гарантии"], "Гарантия 12 месяцев"),
    R("pay", ["оплата", "картой"], "Наличными без %, картой +16%"),
    R("credit", ["рассроч*", "кредит"], "Рассрочки нет, только кредит"),
]


def test_normalize_and_keywords():
    assert normalize("  Где ВЫ находитесь?! ") == "где вы находитесь"
    assert keyword_matches("как вас найти", normalize("Подскажите, как вас найти?"))
    assert not keyword_matches("ок", normalize("покупаю"))           # не кусок слова
    assert keyword_matches("рассроч*", normalize("А рассрочка есть?"))
    assert keyword_matches("ещё", normalize("еще"))                  # ё = е


def test_match_rule_longest_phrase_and_limits():
    m = match_rule(RULES, "Добрый день, где вы находитесь?", {}, NOW)
    assert m and m.rule.id == "addr" and m.keyword == "где вы находитесь"
    assert match_rule(RULES, "где вы находитесь", {"addr": 1}, NOW) is None  # лимит 1× на диалог
    assert match_rule(RULES, "а гарантии какие?", {}, NOW).rule.id == "warranty"
    assert match_rule(RULES, "цена актуальна?", {}, NOW) is None


def test_schedule():
    night = R("n", ["x"], "y", time_from="22:00", time_to="09:00")
    assert rule_in_schedule(night, datetime(2026, 11, 24, 23, 30, tzinfo=MSK))
    assert rule_in_schedule(night, datetime(2026, 11, 24, 8, 0, tzinfo=MSK))
    assert not rule_in_schedule(night, NOW)
    weekend = R("w", ["x"], "y", days=[5, 6])
    assert not rule_in_schedule(weekend, NOW)


def test_refusal_detection():
    # Случай со скриншота: «Нет, спасибо» не должно получать «Желаете оформить доставку?»
    assert starts_with_refusal("Нет, спасибо")
    assert starts_with_refusal("не надо, уже купил")
    assert not starts_with_refusal("А гарантии нет?")
    assert not starts_with_refusal("Спасибо!")


def test_rule_covers():
    from src.app.core.avito_bot_engine import rule_covers
    assert rule_covers("Где вы находитесь?")
    assert not rule_covers("Где вы находитесь?\nи цена актуальная?")
    assert not rule_covers("Подскажите пожалуйста где вы находитесь и можно ли приехать сегодня вечером")


def test_parse_llm_answer():
    v = parse_llm_answer('```json\n{"reply": "Да, в наличии", "handoff": false, "reason": ""}\n```')
    assert v.reply == "Да, в наличии" and not v.handoff
    v = parse_llm_answer('Вот: {"reply": "", "handoff": true, "reason": "торг"}')
    assert v.handoff and v.reason == "торг" and v.reply == ""
    v = parse_llm_answer("Здравствуйте! Да, актуально.")
    assert v.reply.startswith("Здравствуйте") and not v.handoff


def test_prompt_and_messages():
    ctx = ChatContext("iPhone 17 Pro 256", "135 990 ₽", "Алексей",
                      [("client", "Цена актуальная?"), ("bot", "Да"), ("client", "Нет, спасибо"), ("client", "Пока")])
    system = build_system_prompt(PromptConfig("Дарья", "коротко", "Самовывоз до 21:00", "торг"), RULES, ctx,
                                 ["• iPhone 17 Pro 256GB — 147 990 ₽, в наличии 3 шт."], NOW)
    assert "Дарья" in system and "виртуальный помощник" in system and "147 990" in system
    assert "Гарантия 12 месяцев" in system and "вторник" in system
    msgs = build_messages(system, ctx)
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert msgs[-1]["content"] == "Нет, спасибо\nПока"   # подряд идущие сообщения покупателя склеены


def test_catalog_tokens():
    assert catalog_tokens("iPhone 17 Pro 256 ГБ", "есть в наличии?") == ["iphone", "17", "pro", "256"]
    assert catalog_tokens(None, "А скинете 3 тысячи?") == []
    assert catalog_tokens(None, "а airpods pro 3 есть?") == ["airpods", "pro"]


def test_rules_import_parser():
    from src.app.api.routers.avito_bot import parse_rules_text
    text = (
        "адрес, как вас найти\nТЦ Багратионовский\nпавильон А60\n\n"
        "оплата | Наличными без %\n"
        "картой | Картой +16%\n\n"
        "одна строка без ответа"
    )
    rules, errors = parse_rules_text(text)
    assert [r.keywords for r in rules] == [["адрес", "как вас найти"], ["оплата"], ["картой"]]
    assert rules[0].answer == "ТЦ Багратионовский\nпавильон А60"
    assert len(errors) == 1


def test_pii_masking_roundtrip():
    from src.app.core.avito_bot_engine import PiiMasker
    m = PiiMasker()
    text = "Мой номер +7 (999) 802-10-22, карта 2202 2061 2345 6789, почта ivan@mail.ru. Цена 147 990 ₽"
    masked = m.mask(text)
    assert "802-10-22" not in masked and "6789" not in masked and "ivan@" not in masked
    assert "[телефон 1]" in masked and "[карта 1]" in masked and "[почта 1]" in masked
    assert "147 990" in masked                       # цены не трогаем
    assert m.mask("звоните 8 999 802 10 22") == "звоните [телефон 2]"
    assert m.mask("+7 (999) 802-10-22") == "[телефон 1]"   # тот же номер — та же метка
    assert m.unmask("Записала ваш [телефон 1]") == "Записала ваш +7 (999) 802-10-22"


def test_pick_examples():
    from src.app.core.avito_bot_engine import pick_examples
    ex = [("Можно ли забрать сегодня вечером?", "Да, до 21:00"), ("Есть ли рассрочка?", "Только кредит"),
          ("Какая гарантия на айфон?", "12 месяцев")]
    got = pick_examples("а забрать сегодня можно?", ex)
    assert got and got[0][1] == "Да, до 21:00"
    assert pick_examples("привет", ex) == []


def test_parse_order():
    v = parse_llm_answer('{"reply": "Забронировала!", "handoff": false, "order": {"item": 1, "method": "pickup"}}')
    assert v.order == {"item": 1, "method": "pickup"}
    assert parse_llm_answer('{"reply": "Ок", "order": {}}').order is None


def test_prompt_with_orders_and_examples():
    ctx = ChatContext("iPhone 17 Pro", None, None, [("client", "Беру, забронируйте")])
    system = build_system_prompt(PromptConfig("Дарья", "", "", "торг"), [], ctx, ["• iPhone 17 Pro — 1 ₽, в наличии 1 шт."], NOW,
                                 examples=[("Забрать сегодня?", "Да, до 21:00")], orders_enabled=True, pickup_address="А60")
    assert "[1] iPhone 17 Pro" in system and '"order"' in system and "А60" in system
    assert "Сотрудник: Да, до 21:00" in system
    no_orders = build_system_prompt(PromptConfig("Дарья", "", "", "торг"), [], ctx, ["• x"], NOW)
    assert '"order"' not in no_orders


def test_reminder_template_and_window():
    from src.app.core.avito_bot_engine import in_window, render_reminder
    t = "Здравствуйте, {name}! Остался ли вопрос по {item}? {unknown}"
    assert render_reminder(t, "iPhone 17 Pro", "Алексей") == "Здравствуйте, Алексей! Остался ли вопрос по iPhone 17 Pro? {unknown}"
    assert render_reminder("Здравствуйте, {name}! По {item}?", None, None) == "Здравствуйте! По товару?"
    assert in_window(NOW, "10:00", "20:00")                    # 13:00
    assert not in_window(NOW, "14:00", "20:00")
    assert in_window(datetime(2026, 11, 24, 23, 0, tzinfo=MSK), "22:00", "02:00")


def test_reminder_messages_end_with_nudge():
    from src.app.core.avito_bot_engine import build_reminder_messages
    ctx = ChatContext("iPhone", None, None, [("client", "Цена?"), ("bot", "147 990 ₽, забронировать?")])
    msgs = build_reminder_messages(PromptConfig("Дарья", "коротко", "", ""), ctx, [], NOW)
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert "напоминание" in msgs[0]["content"] and "молчит" in msgs[-1]["content"]


def test_opt_out():
    from src.app.core.avito_bot_engine import wants_opt_out
    for t in ["Не пишите мне больше", "отпишите меня", "Хватит писать!", "стоп", "Это спам", "уберите меня из рассылки",
              "не надо мне рассылки"]:
        assert wants_opt_out(t), t
    for t in ["Нет, спасибо", "не надо, уже купил", "Стоп, а гарантия какая?", "напишите цену", "Пишите в любое время"]:
        assert not wants_opt_out(t), t


def test_llm_provider_urls():
    from src.app.core.llm_client import LlmSettings
    q = LlmSettings("qwen", "", "", "sk-1", "", 0.4)
    assert q.ready and q.resolved_model == "qwen3.7-plus"
    assert q.resolved_base_url == "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    q.folder_id = "ws-123"
    assert q.resolved_base_url == "https://ws-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
    q.base_url = "https://ws-123.us-east-1.maas.aliyuncs.com/compatible-mode/v1/"
    assert q.resolved_base_url.endswith("us-east-1.maas.aliyuncs.com/compatible-mode/v1")
    y = LlmSettings("yandex", "", "qwen3.6-35b-a3b", "key", "b1gfolder", 0.4)
    assert y.ready and y.resolved_model == "gpt://b1gfolder/qwen3.6-35b-a3b"
    assert not LlmSettings("yandex", "", "", "key", "", 0.4).ready   # без каталога нельзя
    t = LlmSettings("timeweb", "", "", "token", "620888ae-d3cb", 0.4)
    assert t.ready and t.resolved_base_url == "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/620888ae-d3cb/v1"
    assert not LlmSettings("timeweb", "", "", "token", "", 0.4).ready   # нужен Access ID или OpenAI URL
    pasted = LlmSettings("timeweb", "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/abc/v1/chat/completions", "", "token", "", 0.4)
    assert pasted.ready and pasted.resolved_base_url == "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/abc/v1"


def test_greeting_and_tone():
    from src.app.core.avito_bot_engine import is_first_reply, with_greeting
    hello = "Здравствуйте! Меня зовут {name}, я менеджер магазина TakeSmart."
    assert with_greeting("ТЦ Багратионовский, павильон А60.", hello, "Дарья") == \
        "Здравствуйте! Меня зовут Дарья, я менеджер магазина TakeSmart.\nТЦ Багратионовский, павильон А60."
    assert with_greeting("Добрый день! Да, есть.", hello, "Дарья") == "Добрый день! Да, есть."   # уже поздоровались
    assert with_greeting("Да, есть.", "", "Дарья") == "Да, есть."                                   # приветствие выключено
    first = ChatContext(None, None, None, [("client", "Цена актуальная?")])
    later = ChatContext(None, None, None, [("client", "Цена?"), ("bot", "Здравствуйте! 147 990 ₽"), ("client", "А гарантия?")])
    assert is_first_reply(first) and not is_first_reply(later)
    cfg = PromptConfig("Дарья", "коротко", "", "торг", hello)
    p1 = build_system_prompt(cfg, [], first, [], NOW)
    assert "ПЕРВОЕ сообщение" in p1 and "Меня зовут Дарья" in p1 and "Вежливо, тепло" in p1
    p2 = build_system_prompt(cfg, [], later, [], NOW)
    assert "НЕ здоровайся" in p2 and "ПЕРВОЕ" not in p2


def test_human_mode_split_and_typing():
    import random as _r
    from src.app.core.avito_bot_engine import split_reply, typing_delay, with_greeting
    assert split_reply("Здравствуйте!\n\nДа, есть в наличии.") == ["Здравствуйте!", "Да, есть в наличии."]
    assert split_reply("Одно сообщение\nс переносом") == ["Одно сообщение\nс переносом"]
    assert split_reply("a\n\nb\n\nc\n\nd") == ["a", "b", "c\nd"]          # не больше трёх
    assert split_reply("  ") == []
    rng = _r.Random(1)
    short, long_ = typing_delay("Да, есть!", 3, 30, rng), typing_delay("x" * 180, 3, 30, rng)
    assert 3 <= short < long_ <= 30                                            # длиннее — дольше печатает
    assert typing_delay("x" * 5000, 3, 30, rng) == 30 and typing_delay("", 5, 30, rng) == 5
    hello = "Здравствуйте! Меня зовут {name}."
    assert split_reply(with_greeting("Адрес: А60.", hello, "Дарья", "\n\n")) == ["Здравствуйте! Меня зовут Дарья.", "Адрес: А60."]


def test_prompt_human_mode():
    ctx = ChatContext("iPhone", None, "Алексей", [("client", "Цена?")])
    on = build_system_prompt(PromptConfig("Дарья", "", "", "торг", "Здравствуйте!", True, False), [], ctx, [], NOW)
    assert "двумя короткими сообщениями" in on and "Без эмодзи" in on and "Алексей" in on and "сейчас гляну" in on
    assert "Одно сообщение" not in on
    off = build_system_prompt(PromptConfig("Дарья", "", "", "торг", "", False, True), [], ctx, [], NOW)
    assert "Одно сообщение" in off and "двумя короткими" not in off and "Эмодзи — изредка" in off


def test_avito_system_messages():
    from src.app.core.avito_bot_engine import classify_avito_message
    from src.app.schemas.avito_bot import DEFAULT_SYSTEM_PATTERNS
    pats = DEFAULT_SYSTEM_PATTERNS.splitlines()
    msg = lambda **kw: {"type": "text", "author_id": 222, "content": {"text": "Цена актуальна?"}, **kw}
    assert classify_avito_message(msg(), 111, pats) == ("message", "Цена актуальна?")
    assert classify_avito_message(msg(type="system", content={"text": "Покупатель оформил заказ"}), 111, pats)[0] == "system"
    assert classify_avito_message(msg(author_id=0), 111, pats)[0] == "system"
    assert classify_avito_message(msg(author_id=None), 111, pats)[0] == "system"
    assert classify_avito_message(msg(content={"text": "x", "flow_id": "delivery"}), 111, pats)[0] == "system"
    assert classify_avito_message(msg(content={"text": "[Системное сообщение] Покупатель посмотрел ваш номер"}), 111, pats)[0] == "system"
    assert classify_avito_message(msg(content={"text": "Можно с Авито Доставкой?"}), 111, pats)[0] == "system"
    assert classify_avito_message(msg(type="deleted"), 111, pats) is None
    assert classify_avito_message(msg(type="image", content={}), 111, pats) == ("message", "[фото]")
    assert classify_avito_message(msg(content={"text": "Можно с Авито Доставкой?"}), 111, [])[0] == "message"   # без фраз — обычное


def test_booking_contacts():
    from src.app.core.avito_bot_engine import normalize_phone, valid_email, valid_full_name
    assert valid_full_name("Иванов Иван Петрович") and valid_full_name("Анна Смирнова") and valid_full_name("Ivanov Ivan")
    assert not valid_full_name("Алексей") and not valid_full_name("") and not valid_full_name("Иван 123")
    assert normalize_phone("8 (999) 802-10-22") == "+79998021022" == normalize_phone("+7 999 802 10 22") == normalize_phone("9998021022")
    assert normalize_phone("12345") is None and normalize_phone("[телефон 1]") is None
    assert valid_email("ivan@mail.ru") and not valid_email("ivan@") and not valid_email("")
    ctx = ChatContext("iPhone", None, None, [("client", "Беру")])
    p = build_system_prompt(PromptConfig("Дарья", "", "", ""), [], ctx, ["• iPhone — 1 ₽, в наличии 1 шт."], NOW, orders_enabled=True)
    assert "ОБЯЗАТЕЛЬНЫ ФИО" in p and '"email"' in p and "почта — по желанию" in p


def test_cancel_detection():
    from src.app.core.avito_bot_engine import order_note_for_prompt, wants_cancel
    for t in ["Отменяю бронь", "отмените заказ пожалуйста", "Я передумал", "уже не актуально", "не приеду, извините",
              "снимите бронь", "Не буду брать", "Отмени заказ", "Отмена", "хочу отменить", "отказываюсь, спасибо",
              "заказ уже не нужен", "Я передумала", "отменяю заказ, спасибо", "не нужна бронь"]:
        assert wants_cancel(t), t
    for t in ["Не надо отменять, приеду", "а можно потом отменить, если что?", "Беру", "не отменяйте", "спасибо",
              "отменить доставку можно будет?"]:
        assert not wants_cancel(t), t
    assert parse_llm_answer('{"reply": "Отменила", "cancel_order": true}').cancel_order
    assert not parse_llm_answer('{"reply": "Ок", "cancel_order": "yes"}').cancel_order
    assert "cancel_order" in order_note_for_prompt("TM-1", "pending")
    assert "отменена" in order_note_for_prompt("TM-1", "cancelled")


def test_avito_ids_and_chat_meta():
    from src.app.core.avito_client import chat_meta, same_id
    assert same_id(111, "111") and same_id("111", 111) and not same_id(None, None) and not same_id(111, 222)
    chat = {"context": {"value": {"id": "555", "title": "Samsung Galaxy S26", "price_string": "63 990 ₽", "url": "https://avito.ru/x"}},
            "users": [{"id": "111", "name": "TakeSmart"}, {"id": 222, "name": "Александр"}]}
    meta = chat_meta(chat, 111)                       # свой ID числом, в ответе строкой
    assert meta["client_name"] == "Александр" and meta["client_avito_id"] == 222
    assert meta["item_id"] == 555 and meta["item_title"] == "Samsung Galaxy S26"


def _demo_catalog():
    from src.app.core.avito_bot_engine import CatalogItem as C
    a = lambda storage, color: {"storage": storage, "color": color}
    return [
        C("iPad 11 A16 2025 128 ГБ Wi-Fi, Синий", "Планшеты", 40990, stock=2, attributes=a("128 ГБ", "Синий")),
        C("iPad 11 A16 2025 128 ГБ Wi-Fi, Розовый", "Планшеты", 40990, stock=1, attributes=a("128 ГБ", "Розовый")),
        C("iPhone 17 256 ГБ, Белый", "Смартфоны", 79990, stock=3, attributes=a("256 ГБ", "Белый")),
        C("iPhone 17 256 ГБ, Чёрный", "Смартфоны", 79990, stock=0, attributes=a("256 ГБ", "Чёрный")),
        C("iPhone 17 512 ГБ, Белый", "Смартфоны", 99990, stock=1, attributes=a("512 ГБ", "Белый")),
        C("iPhone 17 Pro 256 ГБ, Белый титан", "Смартфоны", 129990, stock=2, attributes=a("256 ГБ", "Белый титан")),
        C("Samsung Galaxy S26 Ultra 512 ГБ, Чёрный", "Смартфоны", 119990, stock=1, attributes=a("512 ГБ", "Чёрный")),
        C("AirPods Pro 3", "Наушники", 24990, stock=5),
    ]


def test_catalog_overview_and_search():
    from src.app.core.avito_bot_engine import build_overview, catalog_vocab, family_name, query_segments, search_catalog
    cat = _demo_catalog()
    assert family_name(cat[2]) == "iPhone 17" and family_name(cat[5]) == "iPhone 17 Pro" and family_name(cat[0]) == "iPad 11 A16 2025 Wi-Fi"
    ov = build_overview(cat)
    assert "## Смартфоны" in ov and "- iPhone 17: 256 ГБ — 79 990 ₽ (Белый); 512 ГБ — 99 990 ₽ (Белый)" in ov
    assert not any("Чёрный" in ln and "iPhone 17:" in ln for ln in ov)          # нет в наличии — не в справочнике
    assert "- AirPods Pro 3: 24 990 ₽" in ov
    # Вопрос со скриншота: два товара в одном сообщении, по-русски
    q = "Здравствуйте! А цена на айпад 11 128 гб и айфон 17 базовый белый 256 гб та же?"
    assert len(query_segments(q)) == 2
    found = [it.name for it in search_catalog(cat, query_segments(q), catalog_vocab(cat))]
    assert "iPhone 17 256 ГБ, Белый" in found and any(n.startswith("iPad 11") for n in found)
    assert found.index("iPhone 17 256 ГБ, Белый") < (found.index("iPhone 17 Pro 256 ГБ, Белый титан")
                                                       if "iPhone 17 Pro 256 ГБ, Белый титан" in found else 99)
    assert [it.name for it in search_catalog(cat, ["самсунг s26 ультра"], catalog_vocab(cat))][0].startswith("Samsung Galaxy S26")


def test_storage_from_name():
    from src.app.core.avito_bot_engine import CatalogItem, family_name, item_storage
    mb = CatalogItem("Ноутбук Apple MacBook Pro 14 (M5, 10C CPU, 10C GPU, 16ГБ, 512ГБ SSD), Серебристый (Silver)", "Ноутбуки", 1)
    assert item_storage(mb) == "16ГБ/512ГБ"
    assert family_name(mb) == "Ноутбук Apple MacBook Pro 14 (M5, 10C CPU, 10C GPU, SSD)"


def test_first_message_price():
    from src.app.core.avito_bot_engine import DEFAULT_FIRST_MESSAGE, catalog_vocab, render_first_message, title_match
    cat = _demo_catalog()
    v = catalog_vocab(cat)
    assert title_match(cat, "Apple iPhone 17 256 ГБ белый, новый", v).name == "iPhone 17 256 ГБ, Белый"
    assert title_match(cat, "iPhone 17 512gb", v).name == "iPhone 17 512 ГБ, Белый"
    assert title_match(cat, "iPhone 15 128 ГБ", v) is None            # такой модели нет — цену не выдумываем
    assert title_match(cat, "Чехол прозрачный", v) is None
    msg = render_first_message(DEFAULT_FIRST_MESSAGE, "Илья", "79 990 ₽")
    assert msg == ("Здравствуйте! Меня зовут Илья, я ваш менеджер.\n\n"
                   "Указанная в объявлении цена является максимальной суммой доплаты в рамках программы trade-in.\n\n"
                   "✨ Розничная стоимость без участия в программе - 79 990 ₽")
    no_price = render_first_message(DEFAULT_FIRST_MESSAGE, "Илья", None)
    assert "{price}" not in no_price and "Розничная стоимость" not in no_price and no_price.endswith("trade-in.")


def test_refusal_anywhere_and_greeting_strip():
    from src.app.core.avito_bot_engine import is_refusal, strip_greeting
    for t in ["Спасибо не интересует", "Нет", "нет, спасибо", "Уже не актуально", "спасибо, не надо", "не подходит"]:
        assert is_refusal(t), t
    for t in ["Спасибо!", "Есть в наличии 16/128?", "А не подскажете цену?", "Белый"]:
        assert not is_refusal(t), t
    assert strip_greeting("Здравствуйте! Цена в объявлении — это доплата.") == "Цена в объявлении — это доплата."
    assert strip_greeting("Добрый вечер! Меня зовут Илья, я менеджер. Есть белый 128 ГБ.") == "Есть белый 128 ГБ."
    assert strip_greeting("Есть в наличии.") == "Есть в наличии."


def test_sanitize_reply_off_topic():
    from src.app.core.avito_bot_engine import OFF_TOPIC_REPLY, sanitize_reply
    math = "## Шаг 1: Раскрываем скобки $$\\left(x + \\frac{1}{y}\\right)$$"
    assert sanitize_reply(math) == (OFF_TOPIC_REPLY, True)
    assert sanitize_reply("x" * 1500) == (OFF_TOPIC_REPLY, True)
    assert sanitize_reply("Да, есть **белый** 128 ГБ — 62 990 ₽") == ("Да, есть белый 128 ГБ — 62 990 ₽", False)


def test_price_list_parse_and_priority():
    from src.app.core.avito_bot_engine import build_overview, catalog_vocab, parse_price_list, title_match
    text = ("# прайс\niPhone 16; 128; Белый; 62 990\niPhone 16\t128\tЧёрный\t62990\n"
            "iPhone 16 | 256 | Ультрамарин | 72990 | нет\nGalaxy Z Fold8; 12/256; Серый; 118 990 ₽\n"
            "AirPods Pro 3; 24990\nплохая строка\n17 Pro 256 Orange")
    items, errors = parse_price_list(text)
    assert [it.name for it in items] == ["iPhone 16 128 ГБ, Белый", "iPhone 16 128 ГБ, Чёрный", "iPhone 16 256 ГБ, Ультрамарин",
                                         "Galaxy Z Fold8 12/256, Серый", "AirPods Pro 3"]
    assert items[0].price == 62990 and items[2].stock == 0 and items[3].price == 118990
    assert len(errors) == 1
    v = catalog_vocab(items)
    assert title_match(items, "Apple iPhone 16 128GB Белый", v).price == 62990
    assert title_match(items, "Samsung Galaxy Z Fold8 12/256", v).price == 118990
    ov = build_overview(items)
    assert any("iPhone 16: 128 ГБ — 62 990 ₽ (Белый, Чёрный)" in ln for ln in ov)
    assert not any("Ультрамарин" in ln for ln in ov)                      # нет в наличии — не предлагаем


def test_prompt_scope_and_trade_in():
    from src.app.core.avito_bot_engine import DEFAULT_TRADE_IN_PRICES
    ctx = ChatContext("iPhone 16 128", None, None, [("client", "16/128 белый есть?")])
    p = build_system_prompt(PromptConfig("Илья", "", "", ""), [], ctx, [], NOW, greet=False,
                            price_overview=["- iPhone 16: 128 ГБ — 62 990 ₽ (Белый)"], trade_in=DEFAULT_TRADE_IN_PRICES)
    assert "Говори ТОЛЬКО о магазине" in p and "математика" in p
    assert "Не переспрашивай" in p and "относится к товару ИЗ ОБЪЯВЛЕНИЯ" in p
    assert "АКТУАЛЬНЫЙ ПРАЙС" in p and "iPhone 17 Pro Max — 65 000–70 000 ₽" in p
    assert "НЕ здоровайся" in p and "ПЕРВОЕ сообщение" not in p


def test_overview_line_limit():
    from src.app.core.avito_bot_engine import CatalogItem, build_overview
    many = [CatalogItem(f"Model {i}", "Смартфоны", 1000 + i, stock=1) for i in range(400)]
    ov = build_overview(many, max_lines=50)
    assert len(ov) == 51 and ov[-1].startswith("… и ещё")


def test_free_price_list_format():
    from src.app.core.avito_bot_engine import parse_price_list, price_lines, catalog_vocab, search_catalog, query_tokens
    text = """ПРАЙС iPhone 17 TakeSmart, [24 ноя. 2026 в 11:02]
15 256 Black 🇮🇳 - 61.100
17Pro 256 Orange -     94000🇰🇷1SIM.
17Pro 256 Orange -     91500🇯🇵eSIM.
17Pro 256 Orange -     91200🇯🇵eSIM.
17 Air 512 Blue eSIM 🇯🇵 - 76.500
18 Duo 512 While - 216000🇯🇵.
------
"""
    items, errors = parse_price_list(text)
    assert errors == []
    assert len(items) == 5                                                # дубль японского 17 Pro — последний
    by = {(it.name, it.attributes.get("country"), it.attributes.get("sim")): it.price for it in items}
    assert by[("iPhone 15 256 ГБ, Black", "Индия", None)] == 61100
    assert by[("iPhone 17 Pro 256 ГБ, Orange", "Корея", "SIM + eSIM")] == 94000
    assert by[("iPhone 17 Pro 256 ГБ, Orange", "Япония", "только eSIM")] == 91200
    assert by[("iPhone 17 Air 512 ГБ, Blue", "Япония", "только eSIM")] == 76500
    assert any(n.startswith("iPhone 18 Duo 512 ГБ, White") for n, _, _ in by)   # опечатка «While»
    lines = price_lines(items)
    assert "- iPhone 17 Pro 256 ГБ Orange (оранжевый) — Япония, только eSIM — 91 200 ₽" in lines
    v = catalog_vocab(items)
    assert query_tokens("японец 17 про 256 оранж", v) == ["япония", "17", "pro", "256", "orange"]
    assert search_catalog(items, ["японец 17 про 256 оранж"], v)[0].price == 91200
    assert search_catalog(items, ["17 про 256 оранжевый с симкой"], v)[0].price == 94000
    assert search_catalog(items, ["эйр 512 голубой"], v)[0].price == 76500
    few, _ = parse_price_list("17 256 Black -             73500🇮🇳1SIM.🏎️\n17 256 White - 73500🇮🇳1SIM.")
    assert few[0].attributes.get("few") and not few[1].attributes.get("few")
    assert price_lines(few)[0].endswith("73 500 ₽ — осталось мало") and not price_lines(few)[1].endswith("мало")


def test_search_specificity_and_index():
    from src.app.core.avito_bot_engine import CatalogItem, SearchIndex, catalog_vocab, search_catalog, title_match
    items = [CatalogItem("iPhone 17 Pro Max 256 ГБ, Orange", "Смартфоны", 103000, stock=5),
             CatalogItem("iPhone 17 Pro 256 ГБ, Orange", "Смартфоны", 94000, stock=5),
             CatalogItem("iPhone 17 256 ГБ, Black", "Смартфоны", 73500, stock=5),
             CatalogItem("iPhone 16 Pro 256 ГБ, Orange", "Смартфоны", 90000, stock=0)]
    v = catalog_vocab(items)
    idx = SearchIndex(items)
    # «17 про 256» — точный 17 Pro раньше Pro Max, хотя Pro Max не дороже ранжируется
    assert search_catalog(items, ["17 про 256"], v, index=idx)[0].name.startswith("iPhone 17 Pro 256")
    assert [i.name for i in search_catalog(items, ["17 про 256"], v)] == [i.name for i in search_catalog(items, ["17 про 256"], v, index=idx)]
    assert title_match(items, "iPhone 17 Pro 256GB", v, idx).price == 94000      # не Pro Max
    assert title_match(items, "iPhone 17 256GB Black", v, idx).price == 73500
    assert title_match(items, "iPhone 15 256GB", v, idx) is None                  # чужой модели нет


def test_off_topic_silent_prompt_and_verdict():
    ctx = ChatContext("iPhone 16 128", None, None, [("client", "реши уравнение 2x+3=11")])
    on = build_system_prompt(PromptConfig("Илья", "", "", "", off_topic_silent=True), [], ctx, [], NOW, greet=False)
    off = build_system_prompt(PromptConfig("Илья", "", "", "", off_topic_silent=False), [], ctx, [], NOW, greet=False)
    assert '"off_topic": true' in on and "ЦЕЛИКОМ не про магазин" in on and "«спасибо», «ок»" in on
    assert "ЦЕЛИКОМ не про магазин" not in off and "одной фразой вежливо скажи" in off
    v = parse_llm_answer('{"reply": "", "handoff": false, "reason": "", "off_topic": true}')
    assert v.off_topic and not v.reply
    assert not parse_llm_answer('{"reply": "Да, есть", "handoff": false}').off_topic
    assert not parse_llm_answer("просто текст").off_topic


def test_farewell_phones_only_from_price():
    from datetime import datetime, timezone
    from src.app.core.avito_bot_engine import farewell_wish, is_phone_item
    assert "дня" in farewell_wish(datetime(2026, 11, 25, 9, 0, tzinfo=timezone.utc))      # 12:00 МСК
    assert "вечера" in farewell_wish(datetime(2026, 11, 25, 16, 0, tzinfo=timezone.utc))  # 19:00 МСК
    assert "ночи" in farewell_wish(datetime(2026, 11, 25, 22, 0, tzinfo=timezone.utc))    # 01:00 МСК
    assert is_phone_item("Смартфоны", "Samsung Galaxy S25 256 ГБ")
    assert is_phone_item("Другое", "Apple iPhone 16 128GB")
    assert is_phone_item(None, "Samsung Galaxy S25 Ultra")
    assert not is_phone_item("Наушники", "AirPods Pro 3")
    assert not is_phone_item("Планшеты", "Galaxy Tab S10")
    ctx = ChatContext("Samsung Galaxy S25", None, None, [("client", "Спасибо, до свидания")])
    p = build_system_prompt(PromptConfig("Илья", "", "", ""), [], ctx, [], NOW, greet=False)
    assert "ТОЛЬКО из прайса магазина" in p and "ничего не обещай" in p
    assert "тепло попрощайся" in p and "пожелай" in p


def test_title_match_foreign_words_do_not_match():
    from src.app.core.avito_bot_engine import catalog_vocab, parse_price_list, title_match
    items, _ = parse_price_list("17e 256 Black 1Sim 🇮🇳 - 60.900\n17Pro 256 Orange - 91500🇯🇵eSIM.\n"
                                "16 Pro Max 256 White 🇺🇸 - 91.700")
    v = catalog_vocab(items)
    assert title_match(items, "Samsung Galaxy S25 256 ГБ", v) is None          # не iPhone 256 ГБ
    assert title_match(items, "AirPods Max", v) is None                         # не iPhone Pro Max
    assert title_match(items, "Новый Apple iPhone 17 Pro 256 ГБ Orange", v).price == 91500
    assert title_match(items, "iPhone 17 Pro 256GB", v).price == 91500


def test_price_list_headers_and_supplier_formats():
    from src.app.core.avito_bot_engine import parse_price_list
    text = """18 Pro 256GB Black eSim - 114 990
18 Max 256GB Black 1Sim+eSim - 127 990
17Pro 256 Orange -     97 990 сим+есим
17Pro 256 Orange -     94 990 есим
A57 5G 12/256GB A.Navy — 42 990₽
❤️ iPHONE DUO ❤️
E-SIM НЕ АКТИВ
━━━━━
1TB:
White - 264 990🇯🇵
Прайс Samsung Z Fold8
Z Fold8 12/256GB
Cream — 109 990₽ •
💻 MACBOOK AIR
13» M5 • 16GB / 512GB
• Silver (MDH74) - 104 990🇮🇳
MacBook Air 15 M4
MW1K3 Air 15 Starlight (16GB, 512GB) — 140 990
SE 3
SE 44 Starlight M/L MEHJ4 — 25 990
Magic Keyboard 2024–2026
AirPods Pro 3 — 17 990
iPro 11 M5 256 Black Wi-Fi — 110 990\tiPro 11 M5 256 Silver LTE — 125 990
📱5 Portal White - 24 990
GO Pro Mission 1 PRO- 52.000
Надорвана коробка или помятая - 54 990
iPad Air 13 M4 128 Wi-Fi Starlight — 🚗
"""
    items, errors = parse_price_list(text)
    by = {(it.name, it.attributes.get("sim")): it.price for it in items}
    assert errors == ["Строка 27: не нашёл цену"]
    assert by == {
        ("iPhone 18 Pro 256 ГБ, Black", "только eSIM"): 114990,
        ("iPhone 18 Pro Max 256 ГБ, Black", "SIM + eSIM"): 127990,
        ("iPhone 17 Pro 256 ГБ, Orange", "SIM + eSIM"): 97990,
        ("iPhone 17 Pro 256 ГБ, Orange", "только eSIM"): 94990,
        ("Samsung Galaxy A57 5G 12/256 ГБ, Navy", None): 42990,
        ("iPhone Duo 1 ТБ, White", "только eSIM"): 264990,
        ("Samsung Galaxy Z Fold8 12/256 ГБ, Cream", None): 109990,
        ("MacBook Air 13 M5 16/512 ГБ, Silver", None): 104990,
        ("MacBook Air 15 M4 16/512 ГБ, Starlight", None): 140990,
        ("Apple Watch SE 3 44 M/L, Starlight", None): 25990,
        ("AirPods Pro 3", None): 17990,
        ("iPad Pro 11 M5 Wi-Fi 256 ГБ, Black", None): 110990,
        ("iPad Pro 11 M5 LTE 256 ГБ, Silver", None): 125990,
        ("PlayStation 5 Portal, White", None): 24990,
        ("GO Pro Mission 1 Pro", None): 52000,
        ("GO Pro Mission 1 Pro (надорвана коробка или помятая)", None): 54990,
    }
    _, lost = parse_price_list("Cream — 109 990")
    assert len(lost) == 1                                   # без заголовка модель не выдумываем


def test_title_match_never_quotes_another_model():
    from src.app.core.avito_bot_engine import catalog_vocab, parse_price_list, title_match
    items, _ = parse_price_list(
        "18 Pro 256GB Black eSim - 114 990\n18 Max 256GB Black eSim - 117 990\n"
        "Magic Keyboard Black iPad Pro 11 — 30 990\niPad Pro 11 M5 256 Black Wi-Fi — 110 990\n"
        "[MDE34] Pro 14 (M5 24/1TB) Black — 194 990\n[MGDR4] Pro 14 (M5 Pro 24/1TB) Black — 225 990\n"
        "S26 12/256Gb Black - 64 990₽\nS26+ 12/256Gb White - 72 990₽\n📱5 💿 Дисковод - 10 990")
    v = catalog_vocab(items)

    def price(title):
        hit = title_match(items, title, v)
        return hit.price if hit else None

    assert price("iPhone 18 Pro Max 256 ГБ") == 117990 and price("iPhone 18 Max 256") == 117990
    assert price("iPhone 18 Pro 256GB") == 114990 and price("iPhone 18 256") is None
    assert price("iPad Pro 11") == 110990 and price("Magic Keyboard iPad Pro 11") == 30990
    assert price("MacBook Pro 14 M5 24/1TB") == 194990 and price("MacBook Pro 14 M5 Pro 24/1TB") == 225990
    assert price("Samsung Galaxy S26 256") == 64990 and price("Samsung Galaxy S26+ 256") == 72990
    assert price("PlayStation 5") is None and price("Чехол iPhone 18 Pro") is None


def test_price_list_duplicates_keep_lowest_price():
    from src.app.core.avito_bot_engine import parse_price_list_full
    items, errors, repeats = parse_price_list_full(
        "17Pro 256 Orange - 104 990 есим\n17Pro 256 Orange - 98 990 есим\n17Pro 256 Orange - 99 990 есим\n"
        "17Pro 256 Orange - 90 000🇯🇵 есим\nMDVQ4 Air 15 M5 16GB 512 2026 Sky Blue - 124 990\n"
        "MacBook Air 15 M5 16/512 Sky Blue — 126 990")
    assert not errors and len(items) == 3 and len(repeats) == 2
    assert sorted(i.price for i in items) == [90000, 98990, 124990]


def test_price_update_changes_only_pasted_models():
    from src.app.core.avito_bot_engine import parse_price_list
    from src.app.core.avito_price_update import apply_changes, compare, dump_price_list
    base = ("17Pro 256 Orange - 94 990🇯🇵 eSIM\n17Pro 256 Silver - 99 990🇯🇵 eSIM\n17Pro 256 Orange - 96 000🇮🇳 eSIM\n"
            "16 128 Black 🇮🇳 - 62 990\niPad 11 128 Pink Wi-Fi — 44 990 🏎️\nAirPods Pro 3 — 17 990")
    items, _ = parse_price_list(base)
    stored = dump_price_list(items)
    again, errors = parse_price_list(stored)                      # сохранённая база читается без потерь
    assert not errors and dump_price_list(again) == stored
    assert {(i.name, i.price, str(i.attributes)) for i in again} == {(i.name, i.price, str(i.attributes)) for i in items}

    new = "🇯🇵 Япония eSIM:\niPhone 17 Pro 256\nOrange - 96 990\nBlue - 98 990"
    diff = compare(stored, new)
    got = {(c.kind, c.item.name, c.item.price) for c in diff.changes}
    assert got == {("changed", "iPhone 17 Pro 256 ГБ, Orange", 96990), ("added", "iPhone 17 Pro 256 ГБ, Blue", 98990),
                   ("removed", "iPhone 17 Pro 256 ГБ, Silver", 99990)}      # индийский, iPhone 16, iPad — не тронуты
    assert diff.unchanged == 4
    mixed, _ = parse_price_list("🇯🇵 eSIM\n17Pro 256 Orange - 96 990\nAirPods Pro 3 - 16 990")
    assert [(i.attributes.get("country"), i.attributes.get("sim")) for i in mixed] == [("Япония", "только eSIM"), (None, None)]
    text, applied = apply_changes(stored, diff, {c.id for c in diff.changes if c.kind == "removed"})
    result = {(i.name, i.attributes.get("country")): i.price for i in parse_price_list(text)[0]}
    assert applied == 2 and result[("iPhone 17 Pro 256 ГБ, Silver", "Япония")] == 99990
    assert result[("iPhone 17 Pro 256 ГБ, Orange", "Япония")] == 96990
    assert result[("iPhone 17 Pro 256 ГБ, Orange", "Индия")] == 96000 and len(result) == 7

    assert len([c for c in compare(stored, new, "add").changes if c.kind == "removed"]) == 0
    assert len([c for c in compare(stored, new, "full").changes if c.kind == "removed"]) == 5
    assert compare(stored, "привет, цены позже", "full").changes == []      # пустое сообщение базу не стирает
    assert compare(stored, base).changes == []
    # разные поставщики пишут одно и то же по-разному
    names = {i.name for i in parse_price_list("S26 12/256 Black - 60 000\nSamsung S26 12/256 Black - 61 000\n"
                                              "Samsung Galaxy S26 12/256GB Black - 62 000р\nApple iPhone 16 128 Black - 60 000")[0]}
    assert names == {"Samsung Galaxy S26 12/256 ГБ, Black", "iPhone 16 128 ГБ, Black"}

    # без флажка и SIM — вариант один, значит это он; резкое падение помечаем
    cheap = compare(stored, "iPad 11 128 Pink Wi-Fi - 34.800", "add").changes
    assert len(cheap) == 1 and cheap[0].kind == "changed" and cheap[0].warning


def test_price_list_country_words():
    from src.app.core.avito_bot_engine import parse_price_list
    items, errors = parse_price_list(
        "iPhone\niPhone 16 128 ГБ, Teal (Индия) — 62 990\niPhone 17 Pro 256 ГБ, Orange (Индия / США, eSIM) — 94 990\n"
        "Mac mini M4 16/512 ГБ (Гонконг) — 77 990\nЯпония:\niPhone 17 Pro 256\nBlue - 98 990\n"
        "AirPods Pro 3 — 17 990")
    assert not errors
    got = [(i.name, i.attributes.get("country"), i.attributes.get("sim")) for i in items]
    assert got == [("iPhone 16 128 ГБ, Teal", "Индия", None),
                   ("iPhone 17 Pro 256 ГБ, Orange", "Индия", "только eSIM"),
                   ("Mac mini M4 16/512 ГБ", "Гонконг", None),
                   ("iPhone 17 Pro 256 ГБ, Blue", "Япония", None),
                   ("AirPods Pro 3", None, None)]
    flag, _ = parse_price_list("16 128 Teal 🇮🇳 - 62 990")
    assert (flag[0].name, flag[0].attributes["country"]) == (got[0][0], "Индия")   # словом и флажком — одно и то же
    names = [i.name for i in parse_price_list(
        "iPhone 16 128GB Black - 62 990\niPhone 12 256 ГБ White - 40 000\n18 256GB Black - 90 000\n"
        "MacBook Neo 8GB 256GB Silver - 64 990\nAir 15 Silver (M5, 16GB, 1TB) - 156 990")[0]]
    assert names == ["iPhone 16 128 ГБ, Black", "iPhone 12 256 ГБ, White", "iPhone 18 256 ГБ, Black",
                     "MacBook Neo 8/256 ГБ, Silver", "MacBook Air 15 M5 16/1 ТБ, Silver"]


def test_quoted_prices():
    from src.app.core.avito_bot_engine import quoted_prices
    assert quoted_prices("Бордовый есть — 127 990 ₽, отложить?") == [127990]
    assert quoted_prices("91500 руб") == [91500]
    assert quoted_prices("доставка 1000 рублей, предоплата 1000 ₽") == []        # меньше 10 000 — не цена товара
    assert quoted_prices("256 ГБ, 17 Pro") == []                                 # объём и модель — не цена
    assert quoted_prices("131 990 ₽ или 129 990 ₽") == [131990, 129990]


def test_audit_reply_prices_fixes_stale_quote():
    from src.app.core.avito_bot_engine import audit_reply_prices, parse_price_list, catalog_vocab, SearchIndex
    items, errors = parse_price_list(
        "iPhone 17 Pro Max 256 Burgundy 🇯🇵 SIM+eSIM - 131 990\niPhone 17 Pro Max 256 Orange 🇰🇷 - 129 990")
    assert not errors
    vocab, index = catalog_vocab(items), SearchIndex(items)
    anchor = "iPhone 17 Pro Max 256"
    # Устаревшая цена той же позиции — заменяем на актуальную из прайса
    fixed, unknown, replaced = audit_reply_prices(
        "Красного в этой модели нет, зато есть бордовый с физической SIM — 127 990 ₽, отложить на вас?",
        items, vocab, index, [], anchor=anchor)
    assert replaced and not unknown and "131 990 ₽" in fixed
    # Актуальная цена — не трогаем
    ok, unknown, replaced = audit_reply_prices("Бордовый есть — 131 990 ₽", items, vocab, index, [], anchor=anchor)
    assert not replaced and not unknown and "131 990 ₽" in ok
    # Перечисление вариантов: обе цены из прайса — не трогаем
    multi, unknown, replaced = audit_reply_prices(
        "Бордовый — 131 990 ₽, оранжевый — 129 990 ₽", items, vocab, index, [], anchor=anchor)
    assert not unknown and not replaced and "129 990 ₽" in multi
    # Цена, которой нет нигде, и позицию не определить — не отправляем
    _, unknown, replaced = audit_reply_prices("Есть бордовый — 99 990 ₽", [], set(), None, [])
    assert unknown == [99990] and not replaced
    # Привязка к обоим вариантам однозначна, исправляем и неправильные цены в списке.
    fixed, unknown, replaced = audit_reply_prices(
        "Бордовый — 129 990 ₽, оранжевый — 131 990 ₽", items, vocab, index, [], anchor=anchor)
    assert replaced and not unknown and fixed == "Бордовый — 131 990 ₽, оранжевый — 129 990 ₽"
    # Trade-in вилка из настроек — разрешённая цена, не ругаемся
    ok, unknown, _ = audit_reply_prices("За ваш 15 Pro дадим до 30 000 ₽", items, vocab, index,
                                        [30000], anchor=anchor)
    assert not unknown and "30 000 ₽" in ok


def test_red_maps_to_burgundy():
    from src.app.core.avito_bot_engine import query_tokens, parse_price_list, catalog_vocab
    items, _ = parse_price_list("iPhone 17 Pro Max 256 Burgundy 🇯🇵 SIM+eSIM - 131 990")
    vocab = catalog_vocab(items)
    assert "burgundy" in query_tokens("есть красный?", vocab)
    assert "burgundy" in query_tokens("бордовый", vocab)


# ── decide(): полный пайплайн решения с подставной моделью, без базы и сети ──

DECIDE_PRICE = ("iPhone 17 Pro Max 256 Burgundy 🇯🇵 SIM+eSIM - 131 990\n"
                "iPhone 17 Pro Max 256 Orange 🇰🇷 SIM+eSIM - 129 990\n"
                "iPhone 16 128 White 🇮🇳 SIM+eSIM - 62 990")


class _FakeProduct:
    """Минимум полей товара для product_line и оформления брони."""
    def __init__(self, name="iPhone 17 Pro Max 256 Burgundy", price=16990, stock=5):
        import uuid
        self.id, self.name = uuid.uuid4(), name
        self.price, self.discount_price = price, None
        self.is_preorder, self.preorder_note = False, None
        self.stock_quantity, self.condition = stock, "new"
        self.attributes, self.color = {}, None


def _decide_cfg(**kw):
    from src.app.schemas.avito_bot import AvitoBotConfig
    base = dict(enabled=True, mode="auto", persona_name="Илья",
                greeting="Здравствуйте! Меня зовут {name}, я менеджер магазина TakeSmart.",
                first_message="", price_list=DECIDE_PRICE, use_catalog=True, orders_enabled=True,
                trade_in_prices="iPhone 15 Pro — 25 000–30 000 ₽",
                llm_provider="deepseek", llm_model="test-model", llm_api_key="test-key")
    base.update(kw)
    return AvitoBotConfig(**base)


def _run_decide(model_answer: str, text: str, cfg, ctx=None, rules=None, products=(), **kw):
    """Прогон decide() с подставной моделью и без базы: DB-helpers заменены заглушками."""
    import asyncio
    from src.app.core import avito_bot_service as svc

    async def active_rules(session):
        return list(rules or [])

    from unittest.mock import AsyncMock, patch
    from src.app.core import avito_catalog
    from src.app.core.avito_bot_engine import exact_variant_price

    async def staff_examples(session, limit=300):
        return []

    async def llm_call(cfg_, messages):
        return model_answer

    items, _ = avito_catalog.parse_price_list_full(cfg.price_list)[:2]
    snapshot = svc.CatalogContext(avito_catalog.SearchIntent(queries=[]), [], items)
    bookable = (list(products), {
        product.id: price for product in products
        if (price := exact_variant_price(items, product.name, svc.catalog_vocab(items), svc.SearchIndex(items))) is not None
    })
    with (patch.object(svc, "active_rules", new=active_rules),
          patch.object(svc, "staff_examples", new=staff_examples),
          patch.object(svc, "llm_call", new=llm_call),
          patch.object(svc, "bookable_products", new=AsyncMock(return_value=bookable)),
          patch.object(avito_catalog, "active_import", new=AsyncMock(return_value=None)),
          patch.object(avito_catalog, "listing_items", new=AsyncMock(return_value=items))):
        return asyncio.run(svc.decide(None, cfg, ctx or ChatContext("iPhone 17 Pro Max 256", None, "Алексей", []),
                                      text, {}, requested=snapshot, **kw))


def test_decide_replies_normally_with_off_topic_silent_on():
    """off_topic_silent включён по умолчанию — обычные ответы НЕ должны превращаться в молчание
    (регрессия: return silent выполнялся на каждом непустом ответе модели)."""
    cfg = _decide_cfg()  # off_topic_silent=True по умолчанию
    d = _run_decide('{"reply": "Да, бордовый есть в наличии — 131 990 ₽, отложить на вас?", "handoff": false}',
                    "есть красный?", cfg, greet=False)
    assert d.action == "reply" and "131 990" in d.text


def test_decide_fixes_stale_price_before_sending():
    """Модель назвала устаревшую цену узнаваемой позиции — уходит актуальная из прайса."""
    d = _run_decide('{"reply": "Бордовый есть, физическая SIM — 127 990 ₽", "handoff": false}',
                    "а с физической симкой есть?", _decide_cfg(), greet=False)
    assert d.action == "reply" and "131 990" in d.text and "127 990" not in d.text


def test_decide_unknown_price_goes_to_manager_not_to_client():
    """Выдуманная цена покупателю НЕ отправляется — молчание и handoff сотруднику."""
    no_anchor = ChatContext(None, None, "Алексей", [])
    d = _run_decide('{"reply": "Есть такой — 99 990 ₽", "handoff": false}',
                    "почём?", _decide_cfg(), ctx=no_anchor, greet=False)
    assert d.action == "handoff" and d.text is None and "не из прайса" in d.reason


def test_decide_wrong_price_of_known_item_is_corrected():
    """А вот цену узнаваемой позиции чиним, а не зовём человека: покупатель получает ответ."""
    burgundy = ChatContext("iPhone 17 Pro Max 256 Burgundy", None, "Алексей", [])
    d = _run_decide('{"reply": "Есть такой — 99 990 ₽", "handoff": false}',
                    "почём?", _decide_cfg(), ctx=burgundy, greet=False)
    assert d.action == "reply" and "131 990" in d.text and "99 990" not in d.text


def test_decide_order_survives_price_audit():
    """Бронь от модели не затирается контролем цен: payload с ФИО и телефоном доезжает до Decision
    (регрессия: verdict.order = None выполнялся на каждом ответе)."""
    answer = ('{"reply": "Оформила бронь на сегодня, ждём к семи!", "handoff": false, '
              '"order": {"item": 1, "method": "pickup", "address": "", "name": "Иванов Иван", '
              '"phone": "+79990000001", "email": "", "comment": "к 19:00"}}')
    d = _run_decide(answer, "беру, бронь. Иванов Иван +79990000001, подъеду к семи", _decide_cfg(),
                    products=[_FakeProduct()], greet=False)
    assert d.action == "reply" and d.order is not None
    assert d.order["name"] == "Иванов Иван" and d.order["phone"] == "+79990000001"
    assert d.order["price"] == 131990


def test_decide_asks_contacts_and_does_not_book_without_them():
    """Нет ФИО/телефона — бот вежливо просит их и НЕ оформляет бронь."""
    answer = ('{"reply": "Забронировала!", "handoff": false, "order": {"item": 1, "method": "pickup", '
              '"address": "", "name": "", "phone": "", "email": "", "comment": ""}}')
    d = _run_decide(answer, "забронируйте, подъеду к семи", _decide_cfg(),
                    products=[_FakeProduct()], greet=False)
    assert d.action == "reply" and d.order is None
    assert "ФИО" in d.text and "телефон" in d.text and "оформлена" not in d.text.lower()


def test_decide_second_reply_of_the_day_has_no_greeting():
    """Сегодня уже общались — приветствие из ответа модели вырезается."""
    d = _run_decide('{"reply": "Здравствуйте! Бордовый есть — 131 990 ₽", "handoff": false}',
                    "есть красный?", _decide_cfg(), greet=False)
    assert d.action == "reply" and "Здравствуй" not in d.text


def test_is_closing_message():
    from src.app.core.avito_bot_engine import is_closing_message, bot_farewelled
    assert is_closing_message("спасибо")
    assert is_closing_message("Спасибо, подумаю до завтра")
    assert is_closing_message("и вам")
    assert is_closing_message("не актуально, спасибо")
    assert not is_closing_message("спасибо, а доставка есть?")     # благодарность + новый вопрос
    assert not is_closing_message("какая цена?")
    assert not is_closing_message("а пока есть в наличии?")        # «пока» = пока что, не прощание
    ctx = ChatContext(None, None, None, [("bot", "Рада помочь! Хорошего вечера и отличного настроения!")])
    assert bot_farewelled(ctx)
    ctx = ChatContext(None, None, None, [("bot", "Бордовый есть — 131 990 ₽")])
    assert not bot_farewelled(ctx)


def test_mentions_other_city():
    from src.app.core.avito_bot_engine import mentions_other_city
    assert mentions_other_city("доставите в Питер?")
    assert mentions_other_city("а в Казань отправите?")
    assert mentions_other_city("я в Новосибирске, доставка есть?")
    assert not mentions_other_city("доставка по Москве?")
    assert not mentions_other_city("есть в наличии?")
    assert not mentions_other_city("я из Москвы, привезёте в Подольск?")   # московский скрипт
    assert not mentions_other_city("меня зовут Владимир")                 # имя, а не город
    assert not mentions_other_city("читал отзывы про вас")                # «читал» — не Чита
    assert not mentions_other_city("Иванов Иван, +79990000001")           # фамилия, а не Иваново


def test_decide_moscow_delivery_rule_does_not_hijack_region_question():
    """«Доставите в Питер?» — не дословный московский скрипт, а ответ модели по СДЭК (ТЗ, сценарий 13)."""
    moscow = R("delivery", ["доставка", "доставите"], "Доставка до вашего адреса по Москве от 1000 рублей")
    sdek_answer = ("В другие регионы доставка по СДЭК по полной оплате. "
                   "Оплата переводом +3%. Напишите адрес ПВЗ СДЭК — рассчитаю стоимость.")
    d = _run_decide('{"reply": "' + sdek_answer + '", "handoff": false}',
                    "доставите в Питер?", _decide_cfg(), rules=[moscow], greet=False)
    assert d.action == "reply" and "СДЭК" in d.text and "по Москве" not in d.text
    # А без другого города московский скрипт уходит дословно, как и раньше
    d = _run_decide('{"reply": "неважно", "handoff": false}',
                    "доставите по адресу?", _decide_cfg(), rules=[moscow], greet=False)
    assert d.action == "reply" and d.text.startswith("Доставка до вашего адреса по Москве")
    # Региональное правило (в нём есть СДЭК) другим городом не ломается
    region = R("sdek", ["сдэк", "отправите"], "В другие регионы доставка по СДЭК по полной оплате")
    d = _run_decide('{"reply": "неважно", "handoff": false}',
                    "отправите в Казань?", _decide_cfg(), rules=[region], greet=False)
    assert d.action == "reply" and "СДЭК" in d.text


def test_decide_closing_goes_to_model_not_to_sales_rule():
    """«Спасибо, подумаю до завтра» — не автоответ «Желаете оформить доставку?», а прощание модели (ТЗ §13)."""
    thanks = R("thanks", ["спасибо", "ок"], "Желаете оформить доставку или забронировать товар?")
    d = _run_decide('{"reply": "Хорошо, Алексей! Если что — я на связи. Хорошего вечера!", "handoff": false}',
                    "Спасибо, подумаю до завтра", _decide_cfg(), rules=[thanks], greet=False)
    assert d.action == "reply" and d.source == "llm" and "оформить доставку" not in d.text


def test_decide_silent_after_farewell():
    """После нашего прощания на «спасибо» — молчание, без вызова модели (ТЗ §11, сценарий 14)."""
    thanks = R("thanks", ["спасибо", "ок"], "Желаете оформить доставку или забронировать товар?")
    ctx = ChatContext("iPhone 17 Pro Max 256", None, "Алексей",
                      [("client", "Спасибо, подумаю"), ("bot", "Хорошо! Хорошего вечера и отличного настроения!")])
    d = _run_decide('{"reply": "неважно", "handoff": false}', "спасибо большое!", _decide_cfg(),
                    ctx=ctx, rules=[thanks], greet=False)
    assert d.action == "silent" and d.text is None


def test_decide_silences_off_topic_and_answers_store_questions():
    """Off-topic первым сообщением — молчание, и продающий шаблон не шлём (ТЗ §11, сценарий 6)."""
    d = _run_decide('{"reply": "", "handoff": false, "off_topic": true}',
                    "решите интеграл x^2 dx", _decide_cfg(), greet=True)
    assert d.action == "silent" and not d.text
    d = _run_decide('{"reply": "Бордовый есть — 131 990 ₽", "handoff": false}',
                    "есть красный?", _decide_cfg(), greet=True)


def test_asserted_colors():
    from src.app.core.avito_bot_engine import asserted_colors
    assert asserted_colors("Красного у этой модели нет, зато есть бордовый — 131 990 ₽") == ["burgundy"]
    assert asserted_colors("Есть голубой — 131 990 ₽, отложить?") == ["blue"]
    assert asserted_colors("бордовую отложить на вас?") == ["burgundy"]        # падеж
    assert asserted_colors("цвета: черный и белый") == ["black", "white"]
    assert asserted_colors("не бывает синих, зато есть оранжевый") == ["orange"]
    assert asserted_colors("цена 131 990 ₽, SIM + eSIM") == []                 # без цветов


def test_audit_reply_colors():
    from src.app.core.avito_bot_engine import (audit_reply_colors, parse_price_list, catalog_vocab, SearchIndex)
    items, _ = parse_price_list(
        "iPhone 17 Pro Max 256 Burgundy 🇯🇵 SIM+eSIM - 131 990\n"
        "iPhone 17 Pro Max 256 Orange 🇰🇷 SIM+eSIM - 129 990\n"
        "iPhone 17 Pro Max 512 Orange 🇰🇷 SIM+eSIM - 149 990")
    vocab, index = catalog_vocab(items), SearchIndex(items)
    anchor = "iPhone 17 Pro Max 256"
    assert audit_reply_colors("Есть голубой — 131 990 ₽", items, vocab, index, anchor) == ["blue"]
    assert audit_reply_colors("Есть серебристый — 131 990 ₽", items, vocab, index, anchor) == ["silver"]
    assert audit_reply_colors("Бордовый есть — 131 990 ₽", items, vocab, index, anchor) == []
    # Отрицание не считается выдумкой: красного нет, предлагаем бордовый
    assert audit_reply_colors("Красного нет, зато есть бордовый — 131 990 ₽", items, vocab, index, anchor) == []
    # У 512 ГБ только Orange — бордовый на 512 это выдумка
    assert audit_reply_colors("есть бордовый 512 — 149 990 ₽", items, vocab, index, anchor) == ["burgundy"]
    # Объявление не из прайса — не к чему привязать, не проверяем
    assert audit_reply_colors("есть голубой", items, vocab, index, "Кнопочный Nokia") == []


def test_audit_price_ambiguous_variant_goes_to_handoff_not_to_wrong_price():
    """Неверная цена без цвета в ответе, а у модели цены разных цветов разные — НЕ подставляем
    цену случайного цвета (это сама ошибка), а отдаём человеку."""
    from src.app.core.avito_bot_engine import audit_reply_prices, parse_price_list, catalog_vocab, SearchIndex
    items, _ = parse_price_list(
        "iPhone 17 Pro Max 256 Burgundy 🇯🇵 SIM+eSIM - 131 990\n"
        "iPhone 17 Pro Max 256 Orange 🇰🇷 SIM+eSIM - 129 990")
    vocab, index = catalog_vocab(items), SearchIndex(items)
    anchor = "iPhone 17 Pro Max 256"
    fixed, unknown, replaced = audit_reply_prices("Есть такой — 99 990 ₽", items, vocab, index, [], anchor=anchor)
    assert not replaced and unknown == [99990] and "99 990" in fixed
    # А с цветом в ответе — однозначно, чиним на цену этого цвета
    fixed, unknown, replaced = audit_reply_prices("Бордовый есть — 99 990 ₽", items, vocab, index, [], anchor=anchor)
    assert replaced and "131 990" in fixed and not unknown
    fixed, unknown, replaced = audit_reply_prices("Оранжевый есть — 99 990 ₽", items, vocab, index, [], anchor=anchor)
    assert replaced and "129 990" in fixed and not unknown


def test_decide_invented_color_goes_to_manager_not_to_client():
    """Цвет, которого нет у модели в прайсе, покупателю НЕ отправляется — молчание и handoff."""
    d = _run_decide('{"reply": "Да, есть голубой 17 Pro Max — 131 990 ₽", "handoff": false}',
                    "какие цвета в наличии?", _decide_cfg(), greet=False)
    assert d.action == "handoff" and d.text is None and "цвет" in d.reason
    # Разрешённый цвет проходит без handoff
    d = _run_decide('{"reply": "Да, есть бордовый — 131 990 ₽", "handoff": false}',
                    "есть бордовый?", _decide_cfg(), greet=False)
    assert d.action == "reply" and "131 990" in d.text


def test_decide_own_repeat_is_silenced():
    """Дословный повтор своего же сообщения — не отправляем дубль (ТЗ §12)."""
    ctx = ChatContext("iPhone 17 Pro Max 256", None, "Алексей",
                      [("client", "есть бордовый?"), ("bot", "Бордовый есть — 131 990 ₽, отложить на вас?")])
    d = _run_decide('{"reply": "Бордовый есть — 131 990 ₽, отложить на вас?", "handoff": false}',
                    "а точно есть бордовый?", _decide_cfg(), ctx=ctx, greet=False)
    assert d.action == "silent" and d.text is None
    # Не повтор — проходит
    d = _run_decide('{"reply": "Да, бордовый в наличии, цена та же — 131 990 ₽", "handoff": false}',
                    "а точно есть бордовый?", _decide_cfg(), ctx=ctx, greet=False)
    assert d.action == "reply"


def test_decide_offers_existing_colors_when_asked_color_missing():
    """Спрашивают цвет, которого нет у модели в прайсе — бот САМ предлагает цвета, что есть,
    с ценами из прайса, без вызова модели и без handoff (по просьбе владельца)."""
    d = _run_decide('{"reply": "Голубого сейчас нет. Есть бордовый — 131 990 ₽ и оранжевый — 129 990 ₽. Какой подойдёт?", "handoff": false}',
                    "есть голубой?", _decide_cfg(), greet=False)
    assert d.action == "reply" and "голубого" in d.text.lower()
    assert "бордовый" in d.text and "оранжевый" in d.text
    assert "131 990" in d.text and "129 990" in d.text
    assert "Какой подойдёт?" in d.text


def test_decide_color_that_exists_goes_to_model():
    """Спрошенный цвет есть в прайсе — отвечает модель, детерминированный ответ не вмешивается."""
    d = _run_decide('{"reply": "Да, бордовый есть — 131 990 ₽", "handoff": false}',
                    "есть бордовый?", _decide_cfg(), greet=False)
    assert d.action == "reply" and "131 990" in d.text and "Какой подойдёт" not in d.text


def test_decide_red_question_goes_to_model_when_burgundy_exists():
    """«Красный» при наличии бордового — модель сама предлагает оттенок по промпту (без отказа)."""
    d = _run_decide('{"reply": "Красного нет, зато есть бордовый — 131 990 ₽", "handoff": false}',
                    "есть красный?", _decide_cfg(), greet=False)
    assert d.action == "reply" and "131 990" in d.text


def test_decide_trade_in_color_is_not_color_offer():
    """Цвет СВОЕГО телефона в trade-in — не повод предлагать цвета из прайса."""
    d = _run_decide('{"reply": "Примем: 15 Pro до 30 000 ₽", "handoff": false}',
                    "сдать свой голубой 15 про в трейд", _decide_cfg(), greet=False)
    assert d.action == "reply" and "30 000" in d.text and "Какой подойдёт" not in d.text


def test_price_audit_checks_each_volume_and_named_finish():
    from src.app.core.avito_bot_engine import audit_reply_prices, parse_price_list, catalog_vocab, SearchIndex
    items, errors = parse_price_list(
        DECIDE_PRICE + "\niPhone 17 Pro Max 512 Orange Корея SIM+eSIM - 149 990"
    )
    assert not errors
    vocab, index = catalog_vocab(items), SearchIndex(items)
    anchor = "iPhone 17 Pro Max 256 Burgundy"
    reply, unknown, changed = audit_reply_prices(
        "Оранжевый 512 ГБ — 129 990 ₽, бордовый 256 ГБ — 149 990 ₽.", items, vocab, index, anchor=anchor,
    )
    assert changed and not unknown and reply == "Оранжевый 512 ГБ — 149 990 ₽, бордовый 256 ГБ — 131 990 ₽."
    _, unknown, changed = audit_reply_prices(
        "Бордовый 512 ГБ — 149 990 ₽", items, vocab, index, anchor=anchor,
    )
    assert unknown == [149990] and not changed
    reply, unknown, changed = audit_reply_prices(
        "Оранжевый 512 ГБ стоит 129990.", items, vocab, index, anchor=anchor,
    )
    assert changed and not unknown and reply == "Оранжевый 512 ГБ стоит 149 990."

    reply, unknown, changed = audit_reply_prices(
        "Да, в наличии — 131 990 ₽.", items, vocab, index, anchor=anchor, question="А оранжевый 512 есть?",
    )
    assert changed and not unknown and reply == "Да, в наличии — 149 990 ₽."


def test_listing_price_is_limited_to_unambiguous_database_results():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from src.app.core import avito_bot_service as svc, avito_catalog

    items, _, _ = avito_catalog.parse_price_list_full(DECIDE_PRICE)
    cfg = _decide_cfg()
    with (patch.object(avito_catalog, "active_import", new=AsyncMock(return_value=1)),
          patch.object(avito_catalog, "listing_items", new=AsyncMock(return_value=[items[0]])) as listing):
        assert asyncio.run(svc.listing_price_info(None, cfg, items[0].name))[:2] == ("131 990 ₽", "прайс")
        listing.return_value = items[:2]
        assert asyncio.run(svc.listing_price_info(None, cfg, "iPhone 17 Pro Max 256")) == (None, None, None)
        listing.return_value = []
        assert asyncio.run(svc.listing_price_info(None, cfg, "iPhone 17 Pro Max 256 голубой")) == (None, None, None)


def test_test_chat_uses_outgoing_plan_and_preserves_history():
    import asyncio
    import importlib
    from unittest.mock import AsyncMock, MagicMock, patch
    from src.app.core import avito_bot_service as svc
    from src.app.schemas.avito_bot import TestIn

    router = importlib.import_module("src.app.api.routers.avito_bot")
    cfg = _decide_cfg(first_message="Здравствуйте! Розничная цена {price}")
    title = "iPhone 17 Pro Max 256 Burgundy"
    db = MagicMock()
    db.__aenter__.return_value.commit = AsyncMock()

    async def run():
        decide = AsyncMock(return_value=svc.Decision("silent"))
        with (patch.object(router, "AsyncSessionFactory", return_value=db),
              patch.object(svc, "load_config", new=AsyncMock(return_value=cfg)),
              patch.object(svc, "test_item_id", new=AsyncMock(return_value=29)),
              patch.object(svc, "decide", new=decide)):
            silent = await router.test_chat(TestIn(item_title=title, text="Решите интеграл"))
            assert silent.action == "silent" and silent.first_message is None and not silent.messages

            decide.return_value = svc.Decision("reply", "Да, есть.\n\nМогу отложить.", "llm")
            reply = await router.test_chat(TestIn(item_title=title, text="В наличии?"))
            assert reply.first_message is None and reply.messages
            assert not any("₽" in message.text for message in reply.messages)
            assert decide.await_args.kwargs["item_id"] == 29
            assert decide.await_args.args[2].history[-1] == ("client", "В наличии?")

            decide.return_value = svc.Decision("reply", f"{title} — 131 990 ₽ без trade-in", "catalog", price_reply=True)
            price = await router.test_chat(TestIn(item_title=title, text="Какая цена?"))
            assert price.first_message and len(price.messages) == 1
            assert "Здравствуйте" in price.messages[0].text and "131 990 ₽" in price.messages[0].text

            decide.return_value = svc.Decision("reply", "Да, есть.\n\nМогу отложить.", "llm")
            continued = await router.test_chat(TestIn(
                item_title=title, history=[{"author": "bot", "text": reply.messages[0].text}], text="А сейчас?",
            ))
            assert continued.first_message is None
            assert [message.text for message in continued.messages] == ["Да, есть.", "Могу отложить."]

            parked = await router.test_chat(TestIn(item_title=title, needs_human=True, text="Вы здесь?"))
            assert parked.action == "silent" and not parked.messages
            assert decide.await_count == 4

    asyncio.run(run())


def test_booking_saved_before_confirmation_and_retry():
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, patch
    from uuid import uuid4
    from src.app.core import avito_bot_service as svc

    async def run():
        chat = SimpleNamespace(id=uuid4(), order_id=None, order_number=None, is_simulated=True,
                               needs_human=False, human_reason=None, rule_hits={})
        msg = SimpleNamespace(id=uuid4(), order_payload={"product_name": "Телефон"},
                              status="scheduled", error=None, rule_id=None, text="Заявка оформлена")
        order = SimpleNamespace(id=uuid4(), order_number="TM-TEST", status="pending")
        saved = False

        async def commit():
            nonlocal saved
            saved = True

        async def get(model, key, **kwargs):
            if model is svc.AvitoChat:
                return chat
            if model is svc.AvitoMessage:
                return msg
            return order

        async def send(*args):
            assert saved and chat.order_id == order.id
            return "сеть недоступна"

        session = SimpleNamespace(get=AsyncMock(side_effect=get), commit=AsyncMock(side_effect=commit),
                                  rollback=AsyncMock())
        with (patch.object(svc, "load_config", new=AsyncMock(return_value=_decide_cfg())),
              patch.object(svc, "create_chat_order", new=AsyncMock(return_value=order)) as create,
              patch.object(svc, "_send", new=AsyncMock(side_effect=send))):
            error, created = await svc.deliver_message(session, None, chat, msg)
            assert error and created is order and create.await_count == 1
            error, created = await svc.deliver_message(session, None, chat, msg)
            assert error and created is None and create.await_count == 1

    asyncio.run(run())


def test_booking_failure_does_not_send_confirmation():
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, patch
    from uuid import uuid4
    from src.app.core import avito_bot_service as svc

    async def run():
        chat = SimpleNamespace(id=uuid4(), order_id=None, needs_human=False, human_reason=None, is_simulated=True)
        msg = SimpleNamespace(id=uuid4(), order_payload={"product_name": "Телефон"},
                              status="scheduled", error=None)
        session = SimpleNamespace(get=AsyncMock(return_value=chat), commit=AsyncMock(), rollback=AsyncMock())
        with (patch.object(svc, "create_chat_order", new=AsyncMock(return_value="товар закончился")),
              patch.object(svc, "_send", new=AsyncMock()) as send):
            error, order = await svc.deliver_message(session, None, chat, msg)
            assert error and order is None and chat.needs_human and msg.status == "failed"
            send.assert_not_awaited()

    asyncio.run(run())


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
