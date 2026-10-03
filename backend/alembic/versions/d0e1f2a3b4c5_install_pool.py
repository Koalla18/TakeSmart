"""Приложения на iPhone: общий пул приложений (каталог без привязки к Apple ID) и начальный набор

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Начальный каталог: (ключ иконки, название, bundle_id, App Store ID или None, банк?).
# Ключ иконки = файл public/app-icons/<ключ>.png на сайте. bundle_id сверен с российским
# App Store там, где приложение ещё в магазине (Wildberries, Ozon); у остальных он
# приблизительный. Это не мешает: при чтении истории покупок Apple ID салона приложение
# узнаётся по названию и bundle в пуле исправляется на настоящий; поправить можно и в админке.
BANKS = [
    ("sber", "Сбербанк Онлайн", "ru.sberbankmobile", 492224193),
    ("tbank", "Т-Банк", "com.idamob.tinkoff.ios", 455652438),
    ("alfa", "Альфа-Банк", "ru.alfabank.mobile", 407840348),
    ("vtb", "ВТБ Онлайн", "ru.vtb24.mobilebanking.ios", 500852534),
    ("gazprombank", "Газпромбанк", "ru.gazprombank.ios.mobile", 529954040),
    ("sovcombank", "Совкомбанк", "ru.sovcombank.splus", None),
    ("halva", "Халва", "ru.sovcombank.halva", 1161237478),
    ("rshb", "Россельхозбанк", "ru.rshb.dbo", 1073882030),
    ("pochtabank", "Почта Банк", "ru.pochtabank.mobile", None),
    ("mtsbank", "МТС Банк", "ru.mtsbank.mobile", None),
    ("otkritie", "Банк Открытие", "ru.otkritie.mobile", None),
    ("psb", "ПСБ", "ru.psbank.mobileapp", None),
    ("rosbank", "Росбанк", "ru.rosbank.rb", None),
    ("raiffeisen", "Райффайзен", "ru.raiffeisen.mobile", None),
    ("otp", "ОТП Банк", "ru.otpbank.mobile", None),
    ("akbars", "Ак Барс", "ru.akbars.mobile", None),
    ("ubrir", "УБРиР", "ru.ubrir.mobile", None),
    ("uralsib", "Уралсиб", "ru.uralsib.mobile", None),
    ("mkb", "МКБ", "ru.mkb.mobile", None),
    ("bspb", "Банк Санкт-Петербург", "ru.bspb.mobile", None),
    ("homebank", "Хоум Банк", "ru.homecredit.mobile", None),
    ("renaissance", "Ренессанс Банк", "ru.rencredit.mobile", None),
    ("rsb", "Русский Стандарт", "ru.rsb.mobile", None),
    ("zenit", "Банк Зенит", "ru.zenit.mobile", None),
    ("domrf", "Банк ДОМ.РФ", "ru.domrf.mobile", None),
    ("lokobank", "Локо-Банк", "ru.lockobank.mobile", None),
    ("sinara", "Банк Синара", "ru.sinara.mobile", None),
    ("unicredit", "ЮниКредит", "ru.unicredit.mobile", None),
    ("tochka", "Точка", "ru.tochka.mobile", None),
    ("ozonbank", "Ozon Банк", "ru.ozon.bank", None),
    ("yoomoney", "ЮMoney", "ru.yoo.money", None),
]
MARKET = [
    ("wb", "Wildberries", "RU.WILDBERRIES.MOBILEAPP", 597880187),
    ("ozon", "Ozon", "ru.ozon.OzonStore", 407804998),
    ("avito", "Авито", "ru.avito.app", 417281773),
    ("sbermarket", "Купер (СберМаркет)", "ru.instamart.app", None),
    ("samokat", "Самокат", "ru.samokat.ios", None),
    ("lamoda", "Lamoda", "com.lamoda.lamoda", None),
    ("dns", "ДНС", "ru.dns_shop.app", None),
    ("mvideo", "М.Видео", "ru.mvideo.app", None),
    ("dodo", "Додо Пицца", "ru.dodopizza.app", None),
]
TRANSPORT = [
    ("aeroflot", "Аэрофлот", "ru.aeroflot.mobile", 580243869),
    ("s7", "S7 Airlines", "com.s7.s7mobile", None),
    ("pobeda", "Победа", "ru.pobeda.app", None),
    ("utair", "Utair", "ru.utair.mobile", None),
    ("rzd", "РЖД Пассажирам", "ru.rzd.pass", 1028759863),
    ("delimobil", "Делимобиль", "ru.delimobil.ios", None),
    ("citydrive", "Ситидрайв", "ru.citydrive.app", None),
    ("cdek", "СДЭК", "ru.cdek.app", None),
    ("pochta", "Почта России", "ru.russianpost.app", None),
]
SERVICES = [
    ("yandex", "Яндекс", "ru.yandex.mobile", None),
    ("2gis", "2ГИС", "ru.dublgis.mobile", None),
    ("kinopoisk", "Кинопоиск", "ru.kinopoisk.mobile", None),
    ("ivi", "Иви", "ru.ivi.client", None),
    ("okko", "Okko", "ru.okko.tv", None),
    ("kion", "KION", "ru.mts.kion", None),
    ("vk", "ВКонтакте", "com.vk.vkclient", None),
    ("vkvideo", "VK Видео", "ru.vk.video", None),
    ("max", "MAX", "ru.oneme.max", None),
]
TELECOM = [
    ("mts", "Мой МТС", "ru.mts.mymts", None),
    ("megafon", "МегаФон", "ru.megafon.mlk", None),
    ("beeline", "билайн", "ru.beeline.app", None),
    ("tele2", "t2", "ru.tele2.app", None),
]
GOV = [
    ("gosuslugi", "Госуслуги", "ru.rtlabs.gosuslugi", None),
]
GROUPS = [("Банки", BANKS, True), ("Маркетплейсы", MARKET, False), ("Транспорт", TRANSPORT, False),
          ("Сервисы", SERVICES, False), ("Связь", TELECOM, False), ("Госуслуги", GOV, False)]


def upgrade() -> None:
    # account_id становится необязательным: пустой = запись общего пула
    op.alter_column("install_apps", "account_id", existing_type=sa.dialects.postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column("install_apps", sa.Column("category", sa.String(40), nullable=True))
    op.add_column("install_apps", sa.Column("is_bank", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("install_apps", sa.Column("source", sa.String(10), nullable=False, server_default="import"))
    # В пуле bundle_id уникален (записей без аккаунта не должно быть дублей)
    op.create_index("uq_install_pool_bundle", "install_apps", ["bundle_id"], unique=True,
                    postgresql_where=sa.text("account_id IS NULL"))

    rows, sort = [], 0
    seen = set()
    for category, items, is_bank in GROUPS:
        for key, name, bundle, store_id in items:
            if bundle in seen:
                continue
            seen.add(bundle)
            rows.append({
                "id": str(uuid.uuid4()), "account_id": None, "store_id": store_id, "bundle_id": bundle,
                "name": name, "icon_url": f"/app-icons/{key}.png", "category": category, "is_bank": is_bank,
                "source": "seed", "is_active": True, "sort": sort,
            })
            sort += 10
    # Начальный набор ставим только если пула ещё нет (чтобы повторный upgrade не плодил)
    conn = op.get_bind()
    existing = conn.execute(sa.text("SELECT count(*) FROM install_apps WHERE account_id IS NULL")).scalar()
    if not existing:
        for r in rows:
            conn.execute(sa.text(
                "INSERT INTO install_apps (id, account_id, store_id, bundle_id, name, icon_url, category, is_bank, source, is_active, sort)"
                " VALUES (CAST(:id AS uuid), NULL, :store_id, :bundle_id, :name, :icon_url, :category, :is_bank, :source, :is_active, :sort)"
                " ON CONFLICT DO NOTHING"
            ), {k: v for k, v in r.items() if k != "account_id"})


def downgrade() -> None:
    op.execute("DELETE FROM install_apps WHERE account_id IS NULL AND source = 'seed'")
    op.drop_index("uq_install_pool_bundle", table_name="install_apps")
    op.drop_column("install_apps", "source")
    op.drop_column("install_apps", "is_bank")
    op.drop_column("install_apps", "category")
    op.alter_column("install_apps", "account_id", existing_type=sa.dialects.postgresql.UUID(as_uuid=True), nullable=False)
