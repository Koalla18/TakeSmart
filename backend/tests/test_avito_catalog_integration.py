"""Run after Alembic upgrade against an isolated PostgreSQL database.

The database must be named takesmart_avito_test. Avito and the LLM are stubbed.
"""
from __future__ import annotations

import json
import os
import sys
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.app.core import avito_bot_service as bot, avito_catalog as catalog, avito_client
from src.app.api.routers.avito_bot import (
    PriceApplyIn, PriceUpdateIn, connect, get_settings, list_listings, price_list_apply, price_list_preview, price_list_undo,
    put_settings,
    test_chat as preview_reply,
)
from src.app.database.models.avito_bot import AvitoChat, AvitoItemLink, AvitoMessage
from src.app.database.models.avito_catalog import imports, variants
from src.app.database.models.order import Order
from src.app.database.models.product import Product
from src.app.database.session import AsyncSessionFactory, engine
from src.app.schemas.avito_bot import AvitoBotConfig, AvitoBotConfigIn, TestIn

PRICE = """
Samsung S26 Ultra 16 256 Black 2 SIM — 80 000 ₽
Samsung S26 Ultra 16/256 Silver 2 SIM — 81 000 ₽
Samsung S26 Ultra 12/512 Black SIM + eSIM — 83 000 ₽
iPhone 17 Pro 256 Orange SIM+eSIM — 99 000 ₽
!|Dyson|vacuum|V15 Detect|50000|да|{"color":"yellow","kit":"absolute"}
!|Dyson|vacuum|V15 Detect|45000|да|{"color":"yellow","kit":"animal"}
iPhone Duo 256 GB White eSIM — 219 990 ₽
iPhone Duo 512 GB White eSIM — 239 990 ₽
iPhone Duo 512 GB Black eSIM — 234 990 ₽
iPhone Duo 1 TB White eSIM — 264 990 ₽
iPhone Duo 1 TB Black eSIM — 259 990 ₽
"""
SAMSUNG = "Samsung Galaxy S26 Ultra 16/256 Black 2 SIM"
IPHONE = "iPhone 17 Pro 256 Orange SIM+eSIM"


@unittest.skipUnless(
    os.environ.get("TAKESMART_CATALOG_INTEGRATION") == "1"
    and engine.url.database == "takesmart_avito_test" and engine.url.host in ("127.0.0.1", "localhost"),
    "requires an isolated local PostgreSQL database named takesmart_avito_test",
)
class CatalogIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        await engine.dispose()

    async def save(self, cfg):
        async with AsyncSessionFactory() as session:
            await bot.save_config(session, cfg)
            await session.commit()

    async def test_catalog_and_pilot_through_runtime(self):
        cfg = AvitoBotConfig(
            enabled=True, listing_scope="selected", allowed_listing_ids=[1001], collect_messages_seconds=15,
            mode="auto", human_mode=False, orders_enabled=True, price_list=PRICE,
            llm_provider="deepseek", llm_api_key="fake-test-key",
            first_message="Здравствуйте! Цена по объявлению {price}",
        )
        await self.save(cfg)
        async with AsyncSessionFactory() as session:
            known_old = await catalog.active_import(session, "iPhone 16 128 White — 59 990 ₽")
            self.assertIsNotNone(known_old)
            revision = await catalog.active_import(session, PRICE)
            source = await session.scalar(select(imports.c.source).where(imports.c.id == revision))
            self.assertIn("Samsung S26 Ultra 16 256", source)
            position_count = len((await session.execute(
                select(variants.c.key).where(variants.c.import_id == revision)
            )).all())
            self.assertEqual(position_count, 11)

            query = catalog.ProductQuery(brand="Samsung", category="smartphone", model="С26 ультра",
                attributes={"ram_gb": 16, "storage_gb": 256, "sim": "two_physical", "color": "чёрный"},
                required=["sim"])
            result = await catalog.search(session, revision, query)
            self.assertEqual(result.status, "exact")
            self.assertEqual([m.item.price for m in result.matches], [80000, 81000])
            self.assertEqual(result.matches[1].differences["color"]["found"], "silver")
            result = await catalog.search(session, revision, query.model_copy(update={
                "attributes": {**query.attributes, "color": "blue"},
            }))
            self.assertEqual(result.status, "same_model")
            self.assertEqual({m.item.price for m in result.matches}, {80000, 81000})
            vacuum = await catalog.search(session, revision, catalog.ProductQuery(
                brand="Dyson", category="vacuum", model="V15 Detect", attributes={"kit": "Absolute"},
            ))
            self.assertEqual(vacuum.status, "exact")
            self.assertNotIn("sim", vacuum.context()["matches"][0]["attributes"])
            self.assertEqual(vacuum.matches[1].differences["kit"]["found"], "animal")

            iphone_card = Product(name=IPHONE, slug="avito-integration-iphone", price=1, stock_quantity=3)
            samsung_card = Product(name=SAMSUNG, slug="avito-integration-samsung", price=2, stock_quantity=3)
            session.add_all([iphone_card, samsung_card])
            await session.flush()
            iphone_id, samsung_id = iphone_card.id, samsung_card.id
            session.add(AvitoItemLink(item_id=1001, item_title=SAMSUNG, product_id=samsung_id))
            chats = [
                AvitoChat(avito_chat_id=f"integration-{uuid4()}", item_id=listing_id, item_title=SAMSUNG,
                          client_name="Тестовый Покупатель")
                for listing_id in (1001, 1002, None)
            ]
            session.add_all(chats)
            await session.commit()
            selected_id, excluded_id, unknown_id = [chat.id for chat in chats]
            selected_external, excluded_external, unknown_external = [chat.avito_chat_id for chat in chats]

        update = PriceUpdateIn(text="Samsung S26 Ultra 16/256 Black 2 SIM — 82 000 ₽", mode="add")
        diff = await price_list_preview(update)
        self.assertFalse(diff["errors"])
        self.assertEqual(len(diff["changes"]), 1)
        self.assertEqual(diff["changes"][0]["old_price"], 80000)
        updated = await price_list_apply(PriceApplyIn(**update.model_dump(), base_hash=diff["base_hash"]))
        async with AsyncSessionFactory() as session:
            new_revision = await catalog.active_import(session, updated.price_list)
            self.assertNotEqual(new_revision, revision)
            new_result = await catalog.search(session, new_revision, query)
            self.assertEqual([match.item.price for match in new_result.matches], [82000, 81000])
            self.assertEqual((await catalog.search(session, revision, query)).matches[0].item.price, 80000)
            source = await session.scalar(select(imports.c.source).where(imports.c.id == new_revision))
            self.assertEqual(source, update.text)
        undone = await price_list_undo()
        self.assertEqual(undone.price_list, PRICE)

        listing_id = 9007199254740993
        with patch.object(avito_client, "_request", new=AsyncMock(return_value={"resources": [
            {"id": listing_id, "title": "Активное объявление", "status": "active"},
        ]})) as request:
            listings = await list_listings(page=2, source="avito")
            self.assertEqual(listings["items"][0]["id"], str(listing_id))
            self.assertEqual(request.await_args.args[1:], ("GET", "/core/v1/items"))
            self.assertEqual(request.await_args.kwargs["params"], {"page": 2, "per_page": 50, "status": "active"})
        self.assertEqual({item["id"] for item in (await list_listings(page=1, source="chats"))["items"]},
                         {"1001", "1002"})

        async def samsung_model(_config, messages):
            if messages[0]["content"].startswith("Извлеки поисковые"):
                return json.dumps({"queries": [query.model_dump()]})
            return json.dumps({"reply": "Чёрный Samsung Galaxy S26 Ultra 16/256 ГБ, две физические SIM — 81 000 ₽."})

        with patch.object(bot, "llm_call", new=samsung_model):
            samsung = await preview_reply(TestIn(
                text="Samsung S26 Ultra 16 256 2 SIM чёрный сколько стоит?", item_id=1001, item_title=SAMSUNG,
            ))
            self.assertEqual(samsung.action, "reply", samsung.reason)
            self.assertTrue(any("80 000 ₽" in message.text for message in samsung.messages))
            self.assertFalse(any("81 000 ₽" in message.text for message in samsung.messages))

        async def samsung_short(_config, messages):
            if messages[0]["content"].startswith("Извлеки поисковые"):
                return json.dumps({"queries": [query.model_dump()]})
            return json.dumps({"reply": "Да, в наличии — 81 000 ₽."})

        with patch.object(bot, "llm_call", new=samsung_short):
            samsung = await preview_reply(TestIn(
                text="Samsung S26 Ultra 16 256 2 SIM чёрный сколько стоит?", item_id=1001,
                item_title="Samsung Galaxy S26 Ultra",
            ))
            self.assertEqual(samsung.action, "reply", samsung.reason)
            self.assertTrue(any("80 000 ₽" in message.text for message in samsung.messages))

        async def dyson_model(_config, messages):
            if messages[0]["content"].startswith("Извлеки поисковые"):
                return json.dumps({"queries": [{
                    "brand": "Dyson", "category": "vacuum", "model": "V15 Detect",
                    "attributes": {"kit": "absolute"},
                }]})
            return json.dumps({"reply": "Dyson V15 Detect Absolute есть за 45 000 ₽."})

        with patch.object(bot, "llm_call", new=dyson_model):
            dyson = await preview_reply(TestIn(text="А Dyson V15 Detect Absolute сколько?", item_id=1001, item_title=SAMSUNG))
            self.assertEqual(dyson.action, "reply", dyson.reason)
            self.assertTrue(any("50 000 ₽" in message.text for message in dyson.messages))

        buyer_text = "А iPhone 17 Pro 256 оранжевый есть? Беру, самовывоз. Иванов Иван +79990000001"
        calls = []

        async def model(_config, messages):
            system = messages[0]["content"]
            calls.append(system)
            if system.startswith("Извлеки поисковые"):
                self.assertIn("Samsung", system)
                return json.dumps({"queries": [{
                    "brand": "Apple", "category": "smartphone", "model": "iPhone 17 Pro",
                    "attributes": {"storage_gb": 256, "color": "orange"},
                }], "booking_requested": True})
            self.assertNotIn("80000", system)
            self.assertNotIn("81000", system)
            self.assertIn("99000", system)
            self.assertIn("[1]", system)
            return json.dumps({"reply": "Оранжевый iPhone 17 Pro 256 ГБ — 99 000 ₽. Заявка оформлена.",
                "order": {"item": 1, "method": "pickup", "name": "Иванов Иван", "phone": "+79990000001"}})

        async def verified_send(_cfg, chat, msg, _session):
            async with AsyncSessionFactory() as verifier:
                persisted_chat = await verifier.get(AvitoChat, chat.id)
                order = await verifier.get(Order, persisted_chat.order_id)
                self.assertEqual(int(order.total_amount), 99000)
                self.assertEqual((await verifier.get(Product, iphone_id)).stock_quantity, 2)
                self.assertEqual((await verifier.get(Product, samsung_id)).stock_quantity, 3)
            self.assertNotIn("80 000", msg.text)
            return None

        with (patch.object(bot, "llm_call", new=model),
              patch.object(bot, "_send", new=AsyncMock(side_effect=verified_send)) as send,
              patch.object(bot, "send_order_push", new=AsyncMock()),
              patch.object(bot, "send_push_to_all", new=AsyncMock())):
            await bot.handle_incoming(selected_external, str(uuid4()), 999, "Добрый день")
            async with AsyncSessionFactory() as session:
                first_due = (await session.get(AvitoChat, selected_id)).reply_due_at
                self.assertGreater(first_due - bot._now(), timedelta(seconds=13))
            await bot.handle_incoming(selected_external, str(uuid4()), 999, buyer_text)
            await bot.handle_incoming(excluded_external, str(uuid4()), 999, buyer_text)
            await bot.handle_incoming(unknown_external, str(uuid4()), 999, buyer_text)
            async with AsyncSessionFactory() as session:
                self.assertGreater((await session.get(AvitoChat, selected_id)).reply_due_at, first_due)
                self.assertIsNone((await session.get(AvitoChat, excluded_id)).reply_due_at)
                self.assertIsNone((await session.get(AvitoChat, unknown_id)).reply_due_at)
            denied = await preview_reply(TestIn(text=buyer_text, item_id=1002, item_title=SAMSUNG))
            self.assertEqual(denied.action, "silent")
            self.assertFalse(calls)
            preview = await preview_reply(TestIn(text=buyer_text, item_id=1001, item_title=SAMSUNG))
            self.assertEqual(preview.search[0]["status"], "exact")
            self.assertEqual(preview.order["product_id"], str(iphone_id))
            await bot._process_chat(selected_id)
            async with AsyncSessionFactory() as session:
                queued = (await session.execute(select(AvitoMessage).where(
                    AvitoMessage.chat_id == selected_id, AvitoMessage.status == "scheduled",
                ))).scalar_one()
                queued_id = queued.id
                self.assertEqual(queued.text, preview.messages[0].text)
            await bot.deliver_due_message(queued_id)
            send.assert_awaited_once()

            async with AsyncSessionFactory() as session:
                late = AvitoMessage(chat_id=selected_id, author="bot", status="scheduled", text="Ещё ответ")
                session.add(late)
                await session.commit()
                late_id = late.id
            await self.save(cfg.model_copy(update={"allowed_listing_ids": []}))
            await bot.deliver_due_message(late_id)
            async with AsyncSessionFactory() as session:
                self.assertEqual((await session.get(AvitoMessage, late_id)).status, "discarded")
            send.assert_awaited_once()

    async def test_duo_contextual_price_and_mixed_transfer(self):
        cfg = AvitoBotConfig(
            enabled=True, listing_scope="selected", allowed_listing_ids=[1001, 1003], collect_messages_seconds=5,
            mode="auto", human_mode=False, orders_enabled=False, price_list=PRICE, greeting="",
            llm_provider="deepseek", llm_api_key="fake-test-key",
        )
        await self.save(cfg)

        async def duo_model(_config, messages):
            if messages[0]["content"].startswith("Извлеки поисковые"):
                if "а на 512?" in messages[0]["content"].lower():
                    return json.dumps({"queries": [{
                        "brand": "Apple", "category": "smartphone", "model": "iPhone Duo",
                        "attributes": {"storage_gb": 512, "color": "white", "sim": "esim"},
                    }]})
                return json.dumps({"queries": [{
                    "brand": "Apple", "category": "smartphone", "model": "iPhone Duo",
                    "attributes": {"storage_gb": 1024, "color": "white", "sim": "esim"},
                }]})
            return json.dumps({"reply": (
                "Илья, добрый вечер! Подскажите, пожалуйста, есть ли в наличии iPhone Duo 1 ТБ белый? "
                "И можно ли оплатить переводом на расчётный счёт (юрлицо)?"
            )})

        listing = "iPhone Duo, 1 ТБ, eSIM"
        buyer_mixed = (
            "Здравствуйте, айфон duo 1tb белый какая цена? Могу ли я вам сделать банковский перевод? "
            "Номер счета получателя, банк получателя и БИК"
        )
        async with AsyncSessionFactory() as session:
            live = AvitoChat(avito_chat_id=f"integration-{uuid4()}", item_id=1003, item_title=listing)
            session.add(live)
            await session.commit()
            live_id, live_external = live.id, live.avito_chat_id
        started = bot._now()
        await bot.handle_incoming(live_external, str(uuid4()), 999, "Белый на терабайт сколько?")
        async with AsyncSessionFactory() as session:
            due = (await session.get(AvitoChat, live_id)).reply_due_at
            self.assertGreater(due - started, timedelta(seconds=4))
            self.assertLess(due - started, timedelta(seconds=7))

        with patch.object(bot, "llm_call", new=duo_model):
            price = await preview_reply(TestIn(
                text="белый на терабайт сколько?", item_id=1003, item_title=listing,
            ))
            self.assertEqual(price.action, "reply", price.reason)
            self.assertTrue(any("264 990 ₽" in message.text for message in price.messages))
            self.assertFalse(any("259 990 ₽" in message.text for message in price.messages))
            self.assertEqual(len(price.messages), 1)
            self.assertIn("Здравствуйте", price.messages[0].text)

            white = await preview_reply(TestIn(text="Белый сколько?", item_id=1003, item_title=listing))
            white_text = white.messages[0].text
            self.assertIn("219 990 ₽", white_text)
            self.assertIn("239 990 ₽", white_text)
            self.assertIn("264 990 ₽", white_text)
            self.assertNotIn("259 990 ₽", white_text)

            followup = await preview_reply(TestIn(
                text="а на 512?", item_id=1001, item_title=SAMSUNG,
                history=[
                    {"author": "client", "text": "Белый на терабайт сколько?"},
                    {"author": "bot", "text": price.messages[0].text},
                ],
            ))
            self.assertEqual(followup.action, "reply", followup.reason)
            self.assertTrue(any("239 990 ₽" in message.text for message in followup.messages))
            self.assertFalse(any("234 990 ₽" in message.text for message in followup.messages))

            no_call = AsyncMock(side_effect=AssertionError("clear catalog price should not call the model"))
            with patch.object(bot, "llm_call", new=no_call):
                fallback = await preview_reply(TestIn(
                    text="iPhone Duo 1 ТБ белый сколько стоит?", item_id=1003, item_title=listing,
                ))
            no_call.assert_not_awaited()
            self.assertEqual(fallback.action, "reply", fallback.reason)
            self.assertTrue(any("264 990 ₽" in message.text for message in fallback.messages))
            self.assertFalse(any("259 990 ₽" in message.text for message in fallback.messages))

            greeting_call = AsyncMock(side_effect=AssertionError("non-price greeting should not call the model"))
            with patch.object(bot, "llm_call", new=greeting_call):
                greeting = await preview_reply(TestIn(
                    text="Привет, я сейчас приеду", item_id=1003, item_title=listing,
                ))
            greeting_call.assert_not_awaited()
            greeting_text = " ".join(message.text for message in greeting.messages)
            self.assertNotIn("264 990 ₽", greeting_text)
            self.assertNotIn("259 990 ₽", greeting_text)

            extraction_calls = []

            async def malformed_then_delivery(_config, messages):
                system = messages[0]["content"]
                extraction_calls.append(system)
                if system.startswith("Извлеки поисковые"):
                    return "Уточню запрос: белый Duo 1 ТБ, цена и доставка."
                return json.dumps({"reply": "Белый iPhone Duo 1 ТБ — 264 990 ₽. Доставка есть."})

            with patch.object(bot, "llm_call", new=malformed_then_delivery):
                delivery = await preview_reply(TestIn(
                    text="Белый Duo 1 ТБ сколько, и доставка есть?", item_id=1003, item_title=listing,
                ))
            self.assertEqual(len(extraction_calls), 2)
            self.assertTrue(extraction_calls[0].startswith("Извлеки поисковые"))
            delivery_text = " ".join(message.text for message in delivery.messages)
            self.assertEqual(delivery_text.count("264 990 ₽"), 1)
            self.assertIn("достав", delivery_text.lower())

            echo = await preview_reply(TestIn(
                text="Белый Duo 1 ТБ сколько, и доставка есть?", item_id=1003, item_title=listing,
            ))
            self.assertEqual(echo.action, "handoff", echo.reason)
            self.assertIn("264 990 ₽", echo.messages[0].text)
            self.assertNotIn("Илья, добрый вечер", echo.messages[0].text)

            mixed = await preview_reply(TestIn(
                text=buyer_mixed, item_id=1003, item_title=listing,
            ))
            self.assertIn(mixed.action, ("reply", "handoff"), mixed.reason)
            mixed_text = " ".join(message.text for message in mixed.messages)
            self.assertIn("264 990 ₽", mixed_text)
            self.assertNotIn("Илья, добрый вечер", mixed_text)
            self.assertNotIn("расчётный счёт", mixed_text)
            self.assertNotIn("Номер счета", mixed_text)
            self.assertIn("переводу", mixed_text)

    async def test_enable_setting_survives_in_flight_reconnect(self):
        await self.save(AvitoBotConfig(
            enabled=False, listing_scope="selected", allowed_listing_ids=[5001], collect_messages_seconds=5,
            avito_client_id="fake-id", avito_client_secret="fake-secret", webhook_secret="fake-hook",
        ))

        async def enable_while_connecting(_creds, _url):
            response = await put_settings(AvitoBotConfigIn(enabled=True))
            self.assertTrue(response.enabled)

        with (patch.object(avito_client, "get_self", new=AsyncMock(return_value={"id": 42})),
              patch.object(avito_client, "subscribe_webhook", new=enable_while_connecting)):
            connected = await connect()
        self.assertTrue(connected.ok, connected.detail)
        settings = await get_settings()
        self.assertTrue(settings.enabled)
        self.assertIsNotNone(settings.avito_connected_at)
        self.assertEqual(settings.allowed_listing_ids, ["5001"])
        self.assertEqual(settings.collect_messages_seconds, 5)

        await put_settings(AvitoBotConfigIn(enabled=False))
        settings = await get_settings()
        self.assertFalse(settings.enabled)
        self.assertIsNotNone(settings.avito_connected_at)
        self.assertEqual(settings.avito_user_id, 42)


if __name__ == "__main__":
    unittest.main()
