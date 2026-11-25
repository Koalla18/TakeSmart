"""Авито-бот: trade-in строго iPhone 13–17, новый базовый текст trade-in, без дублей шаблона

  • В базе знаний раздел TRADE-IN заменяется: принимаем только модели из списка оценок
    (поле «Оценка trade-in» в настройках), остальное не берём. Остальной текст базы не трогается.
  • Автоответ trade-in — новый базовый текст (текущее устройство и его состояние).
  • Автоответ «какие модели принимаете» — список iPhone 13–17.
  • Автоответы, повторяющие шаблон первого сообщения (про доплату по trade-in), выключаются:
    после шаблона они давали второе «Здравствуйте!» и повтор того же текста.

Прежние настройки и автоответы — в site_settings.avito_bot_config_backup_20261125 и таблице
avito_bot_rules_backup_20261125; откат миграции возвращает их.

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
"""
import json
import re
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "a6b7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONFIG_BACKUP_KEY = "avito_bot_config_backup_20261125"
RULES_BACKUP = "avito_bot_rules_backup_20261125"

TRADE_IN_SECTION = """TRADE-IN
В trade-in принимаем СТРОГО iPhone из списка «Оценка trade-in»: 13, 13 Pro, 13 Pro Max, 14, 14 Pro, 14 Pro Max, 15, 15 Pro, 15 Pro Max, 16, 16 Pro, 16 Pro Max, 17, 17 Pro, 17 Pro Max. Всё остальное не берём: любые Android (Samsung, Xiaomi, Honor и другие), iPhone 12 и старше, iPad, MacBook, часы, наушники. На такое вежливо скажи, что в trade-in его не берём, и предложи купить новое устройство без trade-in.
Для оценки попроси данные по базовому скрипту trade-in. Называй только предварительную вилку «до …» из списка оценок; итоговую сумму называет менеджер после осмотра. 512 ГБ и больше, а также устройства, в которых что-то меняли, — согласовать с менеджером. Разбитую заднюю крышку и дефекты дисплея не берём."""

TRADE_IN_SCRIPT = """Если вы рассматриваете трейд-ин, пожалуйста, напишите:

📱 Ваше текущее устройство:
• Точная модель
• Объём памяти
• Состояние аккумулятора (%)
• Цвет
• Конфигурация: SIM + eSIM / только eSIM / 2 физические SIM

🛠 Состояние устройства:
• Опишите внешнее состояние (царапины, сколы, потёртости и т.д.)
• Менялось ли что-нибудь в телефоне (экран, аккумулятор, корпус, камеры и т.д.)
• Примерно во сколько оцениваете своё устройство?"""

ACCEPTED_MODELS = """Принимаем в трейд-ин только iPhone:

· 13, 13 Pro, 13 Pro Max
· 14, 14 Pro, 14 Pro Max
· 15, 15 Pro, 15 Pro Max
· 16, 16 Pro, 16 Pro Max
· 17, 17 Pro, 17 Pro Max

Другие устройства в трейд-ин не принимаем."""

RULES = [
    (["трейд ин", "трейд-ин", "трейдин", "трейд", "trade-in", "trade in", "tradein", "обмен", "сдать телефон",
      "сдать свой", "в зачет", "в зачёт"], TRADE_IN_SCRIPT),
    (["какие модели принимаете", "какие принимаете", "что принимаете", "принимаете ли", "какие телефоны принимаете",
      "принимаете в трейд"], ACCEPTED_MODELS),
]


def _replace_trade_in(knowledge: str) -> str:
    # Заголовок раздела — отдельная строка «TRADE-IN» (не «ЦЕНЫ НА АВИТО И TRADE-IN»), до следующего заголовка
    pattern = re.compile(r"^TRADE-IN\n.*?(?=\n\n[A-ZА-ЯЁ][A-ZА-ЯЁ \-]+\n|\Z)", re.DOTALL | re.MULTILINE)
    if pattern.search(knowledge):
        return pattern.sub(TRADE_IN_SECTION, knowledge, count=1)
    return (knowledge.rstrip() + "\n\n" + TRADE_IN_SECTION).strip()


def upgrade() -> None:
    bind = op.get_bind()
    old = bind.execute(sa.text("SELECT value FROM site_settings WHERE key = 'avito_bot_config'")).scalar()
    if old is not None:
        bind.execute(sa.text(
            "INSERT INTO site_settings (key, value) VALUES (:k, CAST(:v AS jsonb)) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
        ), {"k": CONFIG_BACKUP_KEY, "v": json.dumps(old, ensure_ascii=False)})
        knowledge = _replace_trade_in(str(old.get("knowledge") or ""))
        bind.execute(sa.text("UPDATE site_settings SET value = value || CAST(:v AS jsonb) WHERE key = 'avito_bot_config'"),
                     {"v": json.dumps({"knowledge": knowledge}, ensure_ascii=False)})
    op.execute(f"CREATE TABLE {RULES_BACKUP} AS SELECT * FROM avito_bot_rules")

    # Автоответы, повторяющие шаблон первого сообщения, — выключить
    op.execute("UPDATE avito_bot_rules SET is_active = false, updated_at = now() "
               "WHERE lower(answer) LIKE '%доплат%' AND lower(answer) LIKE '%trade-in%'")

    sort_base = bind.execute(sa.text("SELECT coalesce(max(sort), 0) FROM avito_bot_rules")).scalar() or 0
    for i, (keywords, answer) in enumerate(RULES, 1):
        low = [k.lower() for k in keywords]
        existing = bind.execute(sa.text(
            "SELECT id, keywords FROM avito_bot_rules WHERE EXISTS ("
            " SELECT 1 FROM jsonb_array_elements_text(keywords) k WHERE lower(k) = ANY(:kws)) "
            "ORDER BY sort, created_at LIMIT 1"
        ), {"kws": low}).first()
        if existing is not None:
            merged = list(keywords) + [k for k in existing.keywords if k.lower() not in low]
            bind.execute(sa.text(
                "UPDATE avito_bot_rules SET keywords = CAST(:kw AS jsonb), answer = :a, verbatim = true, "
                "is_active = true, updated_at = now() WHERE id = :id"
            ), {"kw": json.dumps(merged, ensure_ascii=False), "a": answer, "id": existing.id})
        else:
            bind.execute(sa.text(
                "INSERT INTO avito_bot_rules (id, keywords, answer, verbatim, sort) "
                "VALUES (:id, CAST(:kw AS jsonb), :a, true, :s)"
            ), {"id": uuid.uuid4(), "kw": json.dumps(keywords, ensure_ascii=False), "a": answer, "s": sort_base + i})


def downgrade() -> None:
    bind = op.get_bind()
    old = bind.execute(sa.text("SELECT value FROM site_settings WHERE key = :k"), {"k": CONFIG_BACKUP_KEY}).scalar()
    if old is not None:
        bind.execute(sa.text("UPDATE site_settings SET value = value || CAST(:v AS jsonb) WHERE key = 'avito_bot_config'"),
                     {"v": json.dumps({"knowledge": old.get("knowledge", "")}, ensure_ascii=False)})
        bind.execute(sa.text("DELETE FROM site_settings WHERE key = :k"), {"k": CONFIG_BACKUP_KEY})
    op.execute("DELETE FROM avito_bot_rules")
    op.execute(f"INSERT INTO avito_bot_rules SELECT * FROM {RULES_BACKUP}")
    op.execute(f"DROP TABLE {RULES_BACKUP}")
