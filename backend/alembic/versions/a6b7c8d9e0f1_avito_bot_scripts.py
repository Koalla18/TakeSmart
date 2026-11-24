"""Авито-бот: имя «Илья», шаблон первого сообщения, база знаний и скрипты магазина

Разовая правка настроек бота по скриптам менеджеров:
  • имя менеджера «Илья» и первое сообщение с розничной ценой;
  • база знаний: trade-in только iPhone 13+, Samsung S23+, MacBook 2020+; доставка по Москве
    и СДЭК, перевод +3%, условия брони, гарантия на заводской брак;
  • автоответы-скрипты дословно. Правило с теми же ключевыми словами обновляется,
    недостающие добавляются, остальные правила не трогаются.

Прежние настройки и автоответы сохраняются (site_settings.avito_bot_config_backup_20261124,
таблица avito_bot_rules_backup_20261124) — откат миграции возвращает их как было.

Revision ID: a6b7c8d9e0f1
Revises: f5a6b7c8d9e0
"""
import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a6b7c8d9e0f1"
down_revision: Union[str, None] = "f5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONFIG_BACKUP_KEY = "avito_bot_config_backup_20261124"
RULES_BACKUP = "avito_bot_rules_backup_20261124"

PERSONA = "Илья"

FIRST_MESSAGE = (
    "Здравствуйте! Меня зовут {name}, я ваш менеджер.\n\n"
    "Указанная в объявлении цена является максимальной суммой доплаты в рамках программы trade-in.\n\n"
    "✨ Розничная стоимость без участия в программе - {price}"
)

KNOWLEDGE = """ЦЕНЫ НА АВИТО И TRADE-IN
Цена в объявлении на Авито — это максимальная сумма доплаты при сдаче старого устройства по программе trade-in, а не розничная цена. Розничная цена без trade-in — как в каталоге магазина и обычно выше цены в объявлении. Если товара нет в каталоге или цену не видно — скажи, что уточнишь, и позови менеджера.

TRADE-IN
В trade-in принимаем ТОЛЬКО:
• iPhone — модели 13 и новее;
• Samsung — модели S23 и новее;
• MacBook — от 2020 года выпуска и новее.
Всё остальное в trade-in НЕ принимаем: другие Android (Xiaomi, Honor, Huawei, Google Pixel и любые другие), iPhone 12 и старше, Samsung старше S23 и другие серии Samsung, iPad, часы, наушники, ноутбуки других брендов. На такое вежливо скажи, что в trade-in его не берём, и предложи купить новое устройство без trade-in.
Для оценки попроси данные по скрипту trade-in: текущее устройство (точная модель, память, состояние аккумулятора %, цвет, SIM-конфигурация), его состояние (царапины, сколы, что менялось, во сколько оценивает), и какое устройство хочет купить (модель, память, цвет, конфигурация). Точную сумму оценки не обещай — её называет менеджер после фото или осмотра.
При trade-in в подарок: перенос данных через специальное приложение бесплатно, стекло и чехол к новому устройству.

МАГАЗИН
Москва, ул. Барклая, д. 10, ТЦ «Багратионовский», павильон А60, метро Багратионовская. Работаем ежедневно с 10:30 до 20:30. Телефон +7 (999) 802-10-22. Сайт takesmart.ru.

ОПЛАТА
Наличными — ровно по ценнику. Картой или QR-кодом в магазине — плюс 16% к цене. Переводом — плюс 3% к цене. Рассрочки нет. Кредит — плюс 15% к стоимости. Юрлицам выставляем счёт — через менеджера.

ДОСТАВКА
По Москве — до адреса от 1000 ₽. За доставку оплата сразу переводом, за устройство — курьеру наличными. Попроси точный адрес — менеджер рассчитает стоимость доставки.
В другие регионы — только СДЭК и только по полной оплате. Оплата переводом +3% к стоимости. Попроси адрес ПВЗ СДЭК — менеджер рассчитает стоимость доставки.
Самовывоз из магазина бесплатно.

БРОНЬ
Бронь только день в день — бронируем в день покупки; на завтра и другие дни заранее не бронируем, попроси написать в день покупки.
Бронь до 19:00 бесплатно. После 19:00 — по предоплате 1000 ₽, она входит в стоимость.
Для брони нужно: ко скольки покупателя ожидать, его имя (ФИО) и номер телефона.

ГАРАНТИЯ И ВОЗВРАТ
12 месяцев гарантии от производителя и 14 дней от нашего магазина. Гарантия действует на заводской брак — в случае чего покупатель обращается к нам с гарантийным талоном в течение года. Возврат и обмен — по Закону «О защите прав потребителей»; вопросы о возврате и браке — сразу к менеджеру."""

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
• Примерно во сколько оцениваете своё устройство?

📲 Устройство, которое хотите приобрести:
• Точная модель
• Объём памяти
• Цвет
• Конфигурация: SIM + eSIM / только eSIM

(Специальное приложение для трейд-ин перенос данных бесплатно, стекло и чехол к новому устройству в подарок 🎁)"""

RULES = [
    (["трейд ин", "трейд-ин", "трейдин", "трейд", "trade-in", "trade in", "tradein", "обмен", "сдать телефон",
      "сдать свой", "в зачет", "в зачёт"], TRADE_IN_SCRIPT),
    (["какие модели принимаете", "какие принимаете", "что принимаете", "принимаете ли", "какие телефоны принимаете",
      "принимаете в трейд"],
     "Трейд-ин позволяет сдать старое устройство и получить скидку на новое устройство, экономя время и деньги.\n\n"
     "Принимаем в Трейд-ин:\n\n"
     "· iPhone: модели 13 и новее.\n"
     "· Samsung: модели S23 и новее.\n"
     "· MacBook: от 2020 года выпуска и новее."),
    (["в регион", "в регионы", "по россии", "сдэк", "в другой город", "в другой регион", "отправите", "отправка",
      "отправить"],
     "В другие регионы доставка по СДЭК по полной оплате\n"
     "Оплату принимаем переводом +3% к стоимости\n"
     "напишите пожалуйста адрес пвз СДЭКа, рассчитаю стоимость доставки"),
    (["доставка", "доставите", "доставку", "курьер", "курьером", "привезти", "привезете", "привезёте"],
     "Доставка до вашего адреса по Москве от 1000 рублей\n"
     "За доставку сразу оплачиваете переводом, за устройство курьеру наличными\n\n"
     "Напишите пожалуйста точный адрес, рассчитаю стоимость доставки"),
    (["бронь", "забронировать", "забронируйте", "отложить", "отложите", "бронирование", "забронирую"],
     "Если планируете покупку сегодня, напишите, пожалуйста ко скольки вас ожидать, ваше имя и номер телефона для брони"),
    (["до скольки бронь", "бронь бесплатно", "предоплата", "предоплату", "бронь платная", "сколько держите"],
     "Бронь до 19:00 бесплатно.\nПосле по предоплате 1000 рублей\nВ стоимость входит"),
    (["на завтра", "заранее", "бронь на завтра", "на другой день", "на послезавтра"],
     "Бронь у нас день в день, напишите пожалуйста в день покупки заранее для бронирования"),
    (["гарантия", "гарантии", "гарантийный", "гарантию"],
     "Гарантия:\n12 месяцев от производителя\n14 дней от нашего магазина\n\n"
     "Гарантия действует на заводской брак, в случае чего обращайтесь к нам с гарантийным талоном в течение года"),
    (["оплата", "картой", "как оплатить", "переводом", "оплатить"],
     "Наличными — по ценнику, без надбавки.\nКартой или QR в магазине — плюс 16% к цене.\nПереводом — плюс 3% к цене."),
]


def upgrade() -> None:
    bind = op.get_bind()

    # ── Резервные копии ──
    old = bind.execute(sa.text("SELECT value FROM site_settings WHERE key = 'avito_bot_config'")).scalar()
    if old is not None:
        bind.execute(sa.text(
            "INSERT INTO site_settings (key, value) VALUES (:k, CAST(:v AS jsonb)) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
        ), {"k": CONFIG_BACKUP_KEY, "v": json.dumps(old, ensure_ascii=False)})
    op.execute(f"CREATE TABLE {RULES_BACKUP} AS SELECT * FROM avito_bot_rules")

    # ── Настройки: имя, первое сообщение, база знаний (ключи и остальное не трогаем) ──
    patch = json.dumps({"persona_name": PERSONA, "first_message": FIRST_MESSAGE, "knowledge": KNOWLEDGE},
                       ensure_ascii=False)
    if old is None:
        bind.execute(sa.text("INSERT INTO site_settings (key, value) VALUES ('avito_bot_config', CAST(:v AS jsonb))"),
                     {"v": patch})
    else:
        bind.execute(sa.text("UPDATE site_settings SET value = value || CAST(:v AS jsonb) WHERE key = 'avito_bot_config'"),
                     {"v": patch})

    # ── Автоответы: обновить совпадающие по ключевым словам, добавить недостающие ──
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
        # секреты могли смениться после миграции — возвращаем только то, что меняли
        restore = {k: old.get(k) for k in ("persona_name", "first_message", "knowledge") if k in old}
        drop = [k for k in ("persona_name", "first_message", "knowledge") if k not in old]
        bind.execute(sa.text("UPDATE site_settings SET value = (value - CAST(:drop AS text[])) || CAST(:v AS jsonb) "
                             "WHERE key = 'avito_bot_config'"),
                     {"v": json.dumps(restore, ensure_ascii=False), "drop": drop})
        bind.execute(sa.text("DELETE FROM site_settings WHERE key = :k"), {"k": CONFIG_BACKUP_KEY})
    op.execute("DELETE FROM avito_bot_rules")
    op.execute(f"INSERT INTO avito_bot_rules SELECT * FROM {RULES_BACKUP}")
    op.execute(f"DROP TABLE {RULES_BACKUP}")
