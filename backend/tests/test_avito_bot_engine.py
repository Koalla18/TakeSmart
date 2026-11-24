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
    assert "не здоровайся заново" in p2 and "ПЕРВОЕ" not in p2


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


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
