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


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
