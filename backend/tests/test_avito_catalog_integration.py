"""Run after Alembic upgrade against an isolated PostgreSQL database.

The database must be named takesmart_avito_test. Avito and the LLM are stubbed.
"""
from __future__ import annotations

import json
import asyncio
import os
import sys
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from sqlalchemy import func, select, update
from fastapi import BackgroundTasks, HTTPException, Request, Response
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.app import app
from src.app.core import avito_bot_service as bot, avito_catalog as catalog, avito_client
from src.app.api.routers.avito_bot import (
    PriceApplyIn, PriceUpdateIn, connect, get_settings, list_listings, price_list_apply, price_list_preview, price_list_undo,
    put_settings,
    test_chat as preview_reply,
)
from src.app.database.models.avito_bot import AvitoChat, AvitoItemLink, AvitoMessage, AvitoWebhookEvent
from src.app.database.models.avito_catalog import imports, variants
from src.app.database.models.admin import Admin
from src.app.database.models.order import Order
from src.app.database.models.product import Product
from src.app.database.models.product_variant import ProductVariant
from src.app.database.session import AsyncSessionFactory, engine
from src.app.schemas.avito_bot import AvitoBotConfig, AvitoBotConfigIn, TestIn as PreviewInput
from src.app.schemas.order import OrderCreate

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

    async def test_webhook_deduplication_and_reply_lease_recovery(self):
        external = f"integration-{uuid4()}"
        message_id = str(uuid4())
        payload = {"payload": {"type": "message", "value": {"id": message_id, "chat_id": external,
                   "author_id": 999, "type": "text", "content": {"text": "По чём?"}}}}
        await self.save(AvitoBotConfig(enabled=True, mode="auto", collect_messages_seconds=0, price_list=PRICE))
        async with AsyncSessionFactory.begin() as session:
            session.add(AvitoChat(avito_chat_id=external, item_title=SAMSUNG))
            secret = (await bot.load_config(session)).webhook_secret
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as http:
            self.assertEqual((await http.post("/api/v1/avito-bot/webhook/wrong-secret", json=payload)).status_code, 404)
            for _ in range(2):
                response = await http.post(f"/api/v1/avito-bot/webhook/{secret}", json=payload)
                self.assertEqual(response.json(), {"ok": True})
            system_payload = {"payload": {"type": "message", "value": {"id": str(uuid4()), "chat_id": external,
                              "type": "system", "content": {"text": "Служебное сообщение"}}}}
            await http.post(f"/api/v1/avito-bot/webhook/{secret}", json=system_payload)
        claims = await bot.claim_webhook_events(10)
        self.assertEqual(len(claims), 1)
        self.assertEqual(await bot.claim_webhook_events(10), [])
        async with AsyncSessionFactory.begin() as session:
            await session.execute(update(AvitoWebhookEvent).values(due_at=bot._now() - timedelta(seconds=1)))
        self.assertEqual(await bot.claim_webhook_events(10), claims)
        await bot.process_webhook_event(*claims[0])
        subsequent = await bot.claim_webhook_events(10)
        self.assertEqual([event for _, event in subsequent], [system_payload])
        await bot.process_webhook_event(*subsequent[0])
        with patch.object(bot, "send_push_to_all", new=AsyncMock()):
            await bot.handle_webhook(payload)
        async with AsyncSessionFactory.begin() as session:
            chat = await session.scalar(select(AvitoChat).where(AvitoChat.avito_chat_id == external))
            chat_id = chat.id
            self.assertEqual(await session.scalar(select(func.count()).select_from(AvitoMessage).where(
                AvitoMessage.chat_id == chat_id, AvitoMessage.author == "client")), 1)
        expired = dict(await bot.claim_due_chats(100))[chat_id]
        self.assertNotIn(chat_id, dict(await bot.claim_due_chats(100)))
        async with AsyncSessionFactory.begin() as session:
            chat = await session.get(AvitoChat, chat_id)
            chat.reply_due_at = bot._now() - timedelta(seconds=1)
        fresh = dict(await bot.claim_due_chats(100))[chat_id]
        await bot._process_chat(chat_id, expired)
        await bot._process_chat(chat_id, fresh)
        async with AsyncSessionFactory() as session:
            self.assertIsNone((await session.get(AvitoChat, chat_id)).reply_due_at)
            answer = await session.scalar(select(AvitoMessage).where(
                AvitoMessage.chat_id == chat_id, AvitoMessage.status == "scheduled"))
            self.assertIn("80 000 ₽", answer.text)
            self.assertEqual(answer.decision_trace[0]["status"], "exact")

    async def test_physical_sim_and_trade_in_listing_in_preview(self):
        price = PRICE + "\nSamsung S26 Ultra 12/512 Black eSIM — 79 000 ₽"
        await self.save(AvitoBotConfig(enabled=True, price_list=price, trade_in_listing_ids=[123]))
        first = await preview_reply(PreviewInput(text="Только с физической SIM. Сколько за 256?", item_title=SAMSUNG, item_id=123))
        answer = first.messages[0]
        self.assertIn("Цена в объявлении действует при сдаче устройства по trade-in.", answer.text)
        self.assertIn("80 000 ₽", answer.text)
        self.assertEqual(answer.quoted_subject["attributes"]["sim"], "has_physical")
        second = await preview_reply(PreviewInput(text="А на 512?", item_title=SAMSUNG, item_id=123,
            history=[{"author": "client", "text": "Только с физической SIM. Сколько за 256?"},
                     {"author": "bot", **answer.model_dump()}]))
        self.assertIn("83 000 ₽", second.messages[0].text)
        self.assertNotIn("79 000 ₽", second.messages[0].text)
        self.assertNotIn("Цена в объявлении действует", second.messages[0].text)
        self.assertEqual(second.search[0]["query"]["required"], ["sim"])
        self.assertEqual(second.search[0]["query"]["attributes"]["sim"], "has_physical")

    async def test_ordinal_selects_the_option_that_was_displayed(self):
        await self.save(AvitoBotConfig(enabled=True, price_list=PRICE))
        first = await preview_reply(PreviewInput(text="Сколько стоит белый iPhone Duo?"))
        answer = first.messages[0]
        shown = [line for line in answer.text.splitlines() if "₽" in line]
        self.assertEqual(len(shown), 3)
        next_answer = await preview_reply(PreviewInput(text="А у второго?", history=[
            {"author": "client", "text": "Сколько стоит белый iPhone Duo?"}, {"author": "bot", **answer.model_dump()},
        ]))
        self.assertEqual(next_answer.messages[0].text, shown[1])
        self.assertEqual(next_answer.search[0]["query"]["reference"], "conversation")

    async def test_booking_rechecks_retail_price_and_requires_separate_draft_approval(self):
        await self.save(AvitoBotConfig(enabled=True, mode="draft", price_list="Dyson HS08 Ceramic Pink — 34 990 ₽"))
        async with AsyncSessionFactory.begin() as session:
            product = Product(name="Dyson HS08 Ceramic Pink", slug=f"booking-{uuid4()}", price=1, stock_quantity=0)
            chat = AvitoChat(avito_chat_id=f"integration-{uuid4()}")
            session.add_all([product, chat])
            await session.flush()
            pid, cid = product.id, chat.id
            draft = AvitoMessage(chat_id=cid, author="bot", status="draft", text="Заявка оформлена.",
                order_payload={"product_id": str(pid), "product_name": product.name, "price": 34000,
                               "price_source": "avito_price_list"})
            session.add(draft)
            await session.flush()
            mid = draft.id
        with patch.object(bot, "_send", new=AsyncMock(return_value=None)) as send:
            with self.assertRaisesRegex(bot.ActionError, "отдельно подтвердите"):
                await bot.approve_draft(mid, None)
            with self.assertRaisesRegex(bot.ActionError, "Уберите из текста подтверждение"):
                await bot.approve_draft(mid, "Заявка оформлена. Хорошего дня!")
            with self.assertRaisesRegex(bot.ActionError, "цена изменилась на 34 990 ₽"):
                await bot.approve_draft(mid, None, confirm_order=True)
            send.assert_not_awaited()
            async with AsyncSessionFactory.begin() as session:
                self.assertIsNone((await session.get(AvitoChat, cid)).order_id)
                draft = await session.get(AvitoMessage, mid)
                draft.status = "draft"
            await bot.approve_draft(mid, "Спасибо, давайте уточним детали.")
            send.assert_awaited_once()
        async with AsyncSessionFactory() as session:
            self.assertIsNone((await session.get(AvitoChat, cid)).order_id)
            self.assertIsNone((await session.get(AvitoMessage, mid)).order_payload)

    async def test_uncertain_send_uses_avito_history_and_never_reposts(self):
        cfg = AvitoBotConfig(enabled=True, mode="auto", avito_user_id=42)
        await self.save(cfg)
        with (patch.object(bot, "_send", new=AsyncMock(side_effect=avito_client.SendUnconfirmed())) as send,
              patch.object(bot, "send_push_to_all", new=AsyncMock()),
              patch.object(avito_client, "list_messages", new=AsyncMock()) as remote):
            for was_sent in (True, False):
                async with AsyncSessionFactory.begin() as session:
                    chat = AvitoChat(avito_chat_id=f"integration-{uuid4()}")
                    session.add(chat)
                    await session.flush()
                    msg = AvitoMessage(chat_id=chat.id, author="bot", status="scheduled", text="Цена из прайса",
                                       send_at=bot._now(), send_started_at=bot._now())
                    session.add(msg)
                    await session.flush()
                    cid, mid = chat.id, msg.id
                    remote.return_value = ([{"id": str(uuid4()), "author_id": 42, "direction": "out",
                                            "created": int(msg.send_started_at.timestamp()),
                                            "content": {"text": msg.text}}] if was_sent else [])
                await bot.deliver_due_message(mid)
                await bot.deliver_due_message(mid)
                async with AsyncSessionFactory() as session:
                    self.assertEqual((await session.get(AvitoMessage, mid)).status, "sent" if was_sent else "failed")
                    self.assertEqual((await session.get(AvitoChat, cid)).needs_human, not was_sent)
            send.assert_not_awaited()

    async def test_checkout_keeps_variant_payment_and_shipping(self):
        from src.app.api.routers.orders import create_order

        async with AsyncSessionFactory.begin() as session:
            product = Product(name="Планшет для проверки корзины", slug=f"integration-{uuid4()}", price=50000, stock_quantity=0)
            session.add(product)
            await session.flush()
            red = ProductVariant(product_id=product.id, name="Красный", stock_quantity=1)
            blue = ProductVariant(product_id=product.id, name="Синий", stock_quantity=1)
            session.add_all([red, blue])
            await session.flush()
            pid, red_id, blue_id = product.id, red.id, blue.id
        body = OrderCreate(customer_name="Тестовый покупатель", customer_email="buyer@example.com",
            shipping_address="Тестовый адрес 1", shipping_city="Москва", payment_method="card", delivery_method="courier",
            expected_total=117000, items=[{"product_id": pid, "variant_id": variant_id, "quantity": 1}
                                         for variant_id in (red_id, blue_id)])
        failed = body.model_copy(update={"expected_total": 116000})
        with self.assertRaises(HTTPException) as mismatch:
            await create_order(failed, BackgroundTasks())
        self.assertEqual(mismatch.exception.status_code, 409)
        outcomes = await asyncio.gather(create_order(body, BackgroundTasks()), create_order(body, BackgroundTasks()),
                                        return_exceptions=True)
        order = next(result for result in outcomes if not isinstance(result, Exception))
        rejected = next(result for result in outcomes if isinstance(result, HTTPException))
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(order.total_amount, 117000)
        self.assertEqual(order.payment_surcharge, 16000)
        self.assertEqual(order.shipping_cost, 1000)
        self.assertEqual({line.variant_id for line in order.items}, {red_id, blue_id})
        self.assertEqual({line.product_name.split(" — ")[-1] for line in order.items}, {"Синий", "Красный"})

    async def test_checkout_preserves_the_total_displayed_in_an_old_cart(self):
        from src.app.api.routers.orders import create_order

        async with AsyncSessionFactory.begin() as session:
            product = Product(name="Товар старой корзины", slug=f"legacy-{uuid4()}", price=100000, stock_quantity=1)
            session.add(product)
            await session.flush()
            product_id = product.id
        body = OrderCreate(customer_name="Тестовый покупатель", customer_email="buyer@example.com",
            shipping_address="Тестовый адрес 1", shipping_city="Москва",
            customer_note="Оплата: Картой — к оплате 118 647 ₽ (включая налог 15% — 17 647 ₽) | Доставка: Курьер",
            items=[{"product_id": product_id, "quantity": 1}])
        order = await create_order(body, BackgroundTasks())
        self.assertEqual((order.payment_method, order.delivery_method), ("card", "courier"))
        self.assertEqual(order.total_amount, 118647)
        self.assertEqual(order.payment_surcharge, 17647)

    async def test_admin_refresh_is_single_use(self):
        from src.app.api.admin.endpoints import RefreshRequest, refresh_tokens
        from src.app.core.security import create_refresh_token

        username = f"session-{uuid4()}"
        async with AsyncSessionFactory.begin() as session:
            session.add(Admin(username=username, hashed_password="test-db-record"))
        token = create_refresh_token({"sub": username})
        self.assertNotEqual(token, create_refresh_token({"sub": username}))
        request = Request({"type": "http", "path": "/api/v1/admin/refresh", "headers": [(b"host", b"localhost")]})

        async def rotate(value):
            async with AsyncSessionFactory.begin() as session:
                response = Response()
                new = await refresh_tokens(request, response, RefreshRequest(refresh_token=value), session)
                self.assertIn("HttpOnly", response.headers["set-cookie"])
                return new

        attempts = await asyncio.gather(rotate(token), rotate(token), return_exceptions=True)
        reply = next(value for value in attempts if not isinstance(value, Exception))
        denial = next(value for value in attempts if isinstance(value, HTTPException))
        self.assertEqual(denial.status_code, 401)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as http:
            issued = await http.post("/api/v1/admin/refresh", json={"refresh_token": reply.refresh_token})
            self.assertEqual(issued.status_code, 200)
            response = await http.post("/api/v1/admin/refresh")
            self.assertEqual(response.status_code, 200)
            self.assertNotEqual(response.json()["refresh_token"], issued.json()["refresh_token"])
            self.assertEqual((await http.get("/api/v1/admin/me", headers={
                "Authorization": f"Bearer {response.json()['access_token']}",
            })).json()["username"], username)
            self.assertEqual((await http.post("/api/v1/admin/logout")).status_code, 204)
            self.assertEqual((await http.post("/api/v1/admin/refresh", json={
                "refresh_token": response.json()["refresh_token"],
            })).status_code, 401)

    async def test_routine_color_choice_and_store_visit_without_model(self):
        path = os.environ.get("TAKESMART_CATALOG_SNAPSHOT")
        price = Path(path).read_text() if path else (
            "iPhone 18 Pro Max 512 Black SIM + eSIM — 147 990 ₽\n"
            "iPhone 18 Pro Max 512 Black eSIM — 138 990 ₽\n"
            "iPhone 18 Pro Max 512 Silver SIM + eSIM — 153 990 ₽"
        )
        listing = "iPhone 18 Pro Max, 512 ГБ, SIM + eSIM"
        cfg = AvitoBotConfig(enabled=True, mode="auto", persona_name="Илья", price_list=price, llm_provider="deepseek",
                            llm_api_key="fake-test-key", pickup_address="ул. Барклая, 10, павильон А60",
                            knowledge="Работаем ежедневно с 10:30 до 20:30.")
        await self.save(cfg)
        no_model = AsyncMock(side_effect=AssertionError("routine reply must not require LLM"))
        with patch.object(bot, "llm_call", new=no_model):
            offered = await preview_reply(PreviewInput(text="че в итоге по цене ты мне скажешь на эту модель и когда можно приехать",
                                                 item_title=listing))
            self.assertEqual(offered.action, "reply", offered.reason)
            self.assertIn("147 990 ₽", offered.messages[0].text)
            self.assertIn("Наш адрес — ул. Барклая, 10, павильон А60.", offered.messages[0].text)
            self.assertIn("Работаем ежедневно с 10:30 до 20:30.", offered.messages[0].text)
            followup = await preview_reply(PreviewInput(text="мне надо черный", item_title=listing, history=[
                {"author": "client", "text": "По чём?"},
                {"author": "bot", "text": offered.messages[0].text},
            ]))
            self.assertEqual(followup.action, "reply", followup.reason)
            self.assertIn("Да, такой вариант есть.", followup.messages[0].text)
            self.assertIn("147 990 ₽", followup.messages[0].text)
            self.assertNotIn("138 990 ₽", followup.messages[0].text)
            self.assertNotIn("153 990 ₽", followup.messages[0].text)
            self.assertEqual(followup.search[0]["query"]["attributes"]["storage_gb"], 512)
            self.assertEqual(followup.search[0]["query"]["attributes"]["sim"], "physical_esim")

            unknown = await preview_reply(PreviewInput(text="мне надо черный"))
            self.assertEqual(unknown.action, "reply", unknown.reason)
            self.assertIn("какая модель вам нужна", unknown.messages[0].text)
            address = await preview_reply(PreviewInput(text="Подскажите, пожалуйста, адрес"))
            self.assertEqual(address.action, "reply", address.reason)
            self.assertIn("Наш адрес — ул. Барклая, 10, павильон А60.", address.messages[0].text)
            self.assertIn("во сколько вам удобно подъехать?", address.messages[0].text)
            colors = await preview_reply(PreviewInput(text="Какие цвета есть?", item_title=listing))
            self.assertEqual(colors.action, "reply", colors.reason)
            self.assertIn("147 990 ₽", colors.messages[0].text)
            self.assertIn("153 990 ₽", colors.messages[0].text)

            external = f"integration-{uuid4()}"
            async with AsyncSessionFactory.begin() as session:
                chat = AvitoChat(avito_chat_id=external, item_title=listing)
                session.add(chat)
                await session.flush()
                chat_id = chat.id
                session.add(AvitoMessage(chat_id=chat_id, author="bot", text=offered.messages[0].text,
                                         status="sent", sent_at=bot._now()))
            with patch.object(bot, "send_push_to_all", new=AsyncMock()) as push:
                await bot.handle_incoming(external, str(uuid4()), 999, "мне надо черный")
                await bot._process_chat(chat_id)
                push.assert_not_awaited()
            async with AsyncSessionFactory() as session:
                self.assertFalse((await session.get(AvitoChat, chat_id)).needs_human)
                planned = await session.scalar(select(AvitoMessage.text).where(
                    AvitoMessage.chat_id == chat_id, AvitoMessage.status == "scheduled",
                ))
                self.assertIn("147 990 ₽", planned)
            no_model.assert_not_awaited()

        with patch.object(bot, "llm_call", new=AsyncMock(side_effect=[
            "Выбор вариантов в обсуждаемом объявлении.",
            '{"reply":"Подскажите, пожалуйста, какая модель вам нужна?"}',
        ])) as model:
            recovered = await preview_reply(PreviewInput(text="Я выбираю вариант"))
            self.assertEqual(recovered.action, "reply", recovered.reason)
            self.assertIn("какая модель вам нужна", " ".join(message.text for message in recovered.messages))
            self.assertEqual(model.await_count, 2)

    async def test_admin_password_changes_after_env_update(self):
        from src.app.api.admin.endpoints import authenticate_admin
        from src.app.core import admin_password
        from src.app.core.security import get_password_hash

        username = f"test-{uuid4()}"
        original = "existing-test-login"
        updated = "new-test-login"
        async with AsyncSessionFactory.begin() as session:
            session.add(Admin(username=username, hashed_password=get_password_hash(original)))
        with patch.object(admin_password.settings, "ADMIN_USERNAME", username):
            with patch.dict(os.environ, {"ADMIN_PASSWORD": "stale-test-value"}):
                await admin_password.sync_admin_password()
                await admin_password.sync_admin_password()
            async with AsyncSessionFactory() as session:
                self.assertIsNotNone(await authenticate_admin(username, original, session))
                self.assertIsNone(await authenticate_admin(username, "stale-test-value", session))
            with patch.dict(os.environ, {"ADMIN_PASSWORD": updated}):
                await admin_password.sync_admin_password()
            async with AsyncSessionFactory() as session:
                self.assertIsNone(await authenticate_admin(username, original, session))
                admin = await authenticate_admin(username, updated, session)
                self.assertIsNotNone(admin)
                current_hash = admin.hashed_password
            with patch.dict(os.environ, {"ADMIN_PASSWORD": ""}):
                await admin_password.sync_admin_password()
            async with AsyncSessionFactory() as session:
                admin = await authenticate_admin(username, updated, session)
                self.assertEqual(admin.hashed_password, current_hash)

    async def test_quote_ipad_dyson_followup_card_and_trade_in(self):
        listing = 'iPad Air (M4, 2026) 13" Wi-Fi 128 гб, «Blue»'
        price = """iPad Air 13 M4 2026 Wi-Fi 128 ГБ Blue — 86 990 ₽
iPad Air 13 M4 Wi-Fi 128 ГБ Space Gray Канада — 79 990 ₽
iPad Air 13 M4 2026 Wi-Fi 256 ГБ Blue — 97 990 ₽
iPad Air 13 M4 2026 Wi-Fi 512 ГБ Blue — 126 990 ₽
iPad Air 13 M4 2026 LTE 128 ГБ Blue — 93 990 ₽
Dyson HS08 Ceramic Pink — 34 990 ₽
Google Pixel 11 Pro XL 12/256 ГБ Fog — 82 990 ₽
Google Pixel 11 Pro XL 12/256 ГБ Obsidian — 82 990 ₽
"""
        if path := os.environ.get("TAKESMART_CATALOG_SNAPSHOT"):
            price = Path(path).read_text()
        cfg = AvitoBotConfig(enabled=True, mode="auto", persona_name="Илья", price_list=price)
        await self.save(cfg)
        call = AsyncMock(side_effect=AssertionError("grounded quotes do not require a model call"))
        with patch.object(bot, "llm_call", new=call):
            request = "по чем и хочу прямо сейчас купить, можно ли по карте? и хочу трейд ин сдать свою технику"
            first = await preview_reply(PreviewInput(text=request, item_title=listing, item_price="61990"))
            self.assertEqual(len(first.messages), 1)
            text = first.messages[0].text
            for expected in ("Илья", "86 990 ₽", "100 908 ₽", "16%", "trade-in", "состояние"):
                self.assertIn(expected, text)
            self.assertNotIn("61 990", text)
            self.assertNotIn("93 990", text)
            self.assertEqual(first.search[0]["status"], "exact")
            self.assertGreater(first.search[0]["matches"][0]["source_number"], 0)
            gray = await preview_reply(PreviewInput(
                text=request, item_title="iPad Air 13 (M4, 2026) Wi-Fi 128 гб, Space Gray", item_price="62990",
            ))
            gray_text = gray.messages[0].text
            self.assertEqual(gray.action, "reply", gray.reason)
            for expected in ("Илья", "79 990 ₽", "92 788 ₽", "128 ГБ", "16%", "trade-in", "состояние"):
                self.assertIn(expected, gray_text)
            for unrelated in ("62 990 ₽", "86 990 ₽", "97 990 ₽", "не могу подтвердить"):
                self.assertNotIn(unrelated, gray_text)
            self.assertEqual(gray.search[0]["status"], "exact")
            self.assertIn("Space Gray", gray.search[0]["matches"][0]["source_line"])
            unavailable_color = await preview_reply(PreviewInput(
                text="по чем", item_title="iPad Air 13 (M4, 2026) Wi-Fi 256 гб, Space Gray",
            ))
            self.assertEqual(unavailable_color.search[0]["status"], "same_model")
            self.assertIn("97 990 ₽", unavailable_color.messages[0].text)
            self.assertNotIn("79 990 ₽", unavailable_color.messages[0].text)
            self.assertNotIn("86 990 ₽", unavailable_color.messages[0].text)
            async with AsyncSessionFactory() as session:
                chat = AvitoChat(avito_chat_id=f"integration-{uuid4()}", item_title=SAMSUNG)
                session.add(chat)
                await session.flush()
                session.add(AvitoMessage(chat_id=chat.id, author="bot", text="Вот предложение.",
                    quoted_subject=bot.avito_quotes.quoted_subject(first.search)))
                await session.flush()
                state = await bot.chat_state(session, chat)
                decision, _ = await bot.plan_chat_reply(session, cfg, state.ctx, "а на 512?", {})
                self.assertIn("126 990 ₽", decision.text)
                self.assertNotIn("93 990 ₽", decision.text)
                self.assertEqual(decision.search[0]["query"]["reference"], "conversation")
                context = bot.avito_quotes.quoted_subject(gray.search)
                context["attributes"] = {"color": "blue", "storage_gb": 512}
                result = await catalog.search(session, gray.search[0]["revision"], catalog.ProductQuery.model_validate(context))
                self.assertEqual(result.status, "exact")
                self.assertEqual(result.matches[0].item.price, 126990)

            dyson = await preview_reply(PreviewInput(
                text="Почём HS08 Ceramic Pink?", item_title=listing, item_price="61990",
            ))
            self.assertIn("34 990 ₽", dyson.messages[0].text)
            self.assertNotIn("86 990 ₽", dyson.messages[0].text)
            self.assertEqual(dyson.search[0]["status"], "exact")
            no_model = await preview_reply(PreviewInput(text="Сколько стоит Dyson HS99?", item_title=listing))
            self.assertNotIn("86 990", no_model.messages[0].text)

            pixel = await preview_reply(PreviewInput(
                text="по чем", item_title="Google Pixel 11 Pro XL, 12/256 ГБ, SIM + eSIM", item_price="72990",
            ))
            pixel_text = pixel.messages[0].text
            self.assertIn("82 990 ₽", pixel_text)
            self.assertIn("Тип SIM у конкретного экземпляра нужно подтвердить", pixel_text)
            self.assertNotIn("не могу подтвердить", pixel_text)
            self.assertNotIn("72 990", pixel_text)
            self.assertEqual(pixel.search[0]["matches"][0]["differences"]["sim"]["found"], None)

        await self.save(cfg.model_copy(update={"llm_provider": "deepseek", "llm_api_key": "fake-test-key"}))

        async def dyson_model(_cfg, messages):
            if messages[0]["content"].startswith("Извлеки поисковые"):
                return '{"queries":[]}'
            self.assertEqual(messages[-1]["content"], "И какая гарантия?")
            return json.dumps({"reply": "Dyson HS08 Ceramic Pink стоит 39 990 ₽, гарантия производителя — 12 месяцев. "
                                        "Цену уточню — передам менеджеру."})

        with patch.object(bot, "llm_call", new=dyson_model):
            dyson = await preview_reply(PreviewInput(text="А Dyson HS08 Ceramic Pink почём? И какая гарантия?", item_title=listing))
            self.assertEqual(dyson.action, "reply", dyson.reason)
            self.assertEqual(dyson.messages[0].text.count("34 990 ₽"), 1)
            self.assertNotIn("39 990", dyson.messages[0].text)
            self.assertNotIn("уточню", dyson.messages[0].text)
            self.assertIn("12 месяцев", dyson.messages[0].text)

    async def test_storefront_configuration_is_found_without_borrowing_any_price(self):
        title = 'iPad Air 13 (M4, 2026) Wi-Fi 128 гб Starlight'
        storefront = 'Планшет Apple iPad Air 13" (M4, 2026) 128 ГБ Wi-Fi, Starlight (Сияющая звезда)'
        price = ("iPad Air 13 M4 2026 Wi-Fi 128 ГБ Blue — 86 990 ₽\n"
                 "iPad Air 13 M4 2026 LTE 128 ГБ Starlight — 93 990 ₽")
        cfg = AvitoBotConfig(enabled=True, persona_name="Илья", price_list=price)
        await self.save(cfg)
        async with AsyncSessionFactory() as session:
            product = Product(name=storefront, slug=f"starlight-test-{uuid4()}", brand="Apple",
                              price=79990, stock_quantity=2)
            session.add(product)
            await session.flush()
            ctx = bot.ChatContext(title, "61990", None, [])
            with patch.object(bot, "llm_call", new=AsyncMock(side_effect=AssertionError("lookup must be deterministic"))):
                decision, _ = await bot.plan_chat_reply(session, cfg, ctx, "По чём?", {})
                self.assertEqual(decision.action, "reply")
                self.assertIn("Илья", decision.text)
                self.assertIn("По каталогу магазина эта комплектация в наличии.", decision.text)
                self.assertIn("Розничную цену для Авито пока не могу подтвердить.", decision.text)
                self.assertNotIn("₽", decision.text)
                self.assertEqual(decision.search[0]["storefront"], "in_stock")
                self.assertEqual(decision.quoted_subject["attributes"]["color"], "starlight")
                self.assertFalse(any(match.get("shown") for match in decision.search[0]["matches"]))

                product.stock_quantity = 0
                await session.flush()
                decision, _ = await bot.plan_chat_reply(session, cfg, ctx, "По чём?", {})
                self.assertIn("Эта комплектация есть в каталоге магазина.", decision.text)
                self.assertNotIn("в наличии", decision.text)

                wrong_ctx = bot.ChatContext(title.replace("128", "256"), None, None, [])
                decision, _ = await bot.plan_chat_reply(session, cfg, wrong_ctx, "По чём?", {})
                self.assertNotIn("storefront", decision.search[0])

        price += '\nПланшет Apple iPad Air 13 (M4, 2026) Wi-Fi 128 ГБ, Сияющая звезда — 83 990 ₽'
        await self.save(cfg.model_copy(update={"price_list": price}))
        preview = await preview_reply(PreviewInput(text="По чём?", item_title=title, item_price="61990"))
        self.assertEqual(preview.search[0]["status"], "exact")
        self.assertIn("83 990 ₽", preview.messages[0].text)
        self.assertNotIn("79 990 ₽", preview.messages[0].text)
        revision = preview.search[0]["revision"]
        async with AsyncSessionFactory.begin() as session:
            exact_key = preview.search[0]["matches"][0]["id"]
            await session.execute(update(variants).where(
                variants.c.import_id == revision, variants.c.key == exact_key,
            ).values(attributes={"storage_gb": 128, "color": "starlight сияющая звезда"}))
        await self.save(cfg.model_copy(update={
            "price_list": price, "llm_provider": "deepseek", "llm_api_key": "fake-test-key",
        }))
        model = AsyncMock(side_effect=[
            '{"queries":[]}',
            '{"reply":"Этой модели нет в наличии. Гарантия магазина 12 месяцев."}',
        ])
        with patch.object(bot, "llm_call", new=model):
            mixed = await preview_reply(PreviewInput(text="По чём? И какая гарантия?", item_title=title))
        self.assertEqual(mixed.search[0]["status"], "exact")
        self.assertIn("83 990 ₽", mixed.messages[0].text)
        self.assertIn("Гарантия магазина 12 месяцев.", mixed.messages[0].text)
        self.assertNotIn("нет в наличии", mixed.messages[0].text)

    async def test_ipad_year_alias_keeps_conflicting_years_and_hardware_apart(self):
        price = """iPad Air 13 M4 Wi-Fi 128 ГБ Space Gray — 79 990 ₽
iPad Air 13 M4 2025 Wi-Fi 128 ГБ Space Gray — 74 990 ₽
iPad Air 13 M4 2026 Wi-Fi 128 ГБ Blue — 86 990 ₽
iPad Air 11 M4 2026 Wi-Fi 128 ГБ Space Gray — 69 990 ₽
iPad Air 13 M4 2026 LTE 128 ГБ Space Gray — 99 990 ₽
iPad Air 13 M3 2026 Wi-Fi 128 ГБ Space Gray — 65 990 ₽
"""
        await self.save(AvitoBotConfig(enabled=True, price_list=price))
        response = await preview_reply(PreviewInput(
            text="по чем", item_title="iPad Air 13 (M4, 2026) Wi-Fi 128 гб, Space Gray",
        ))
        self.assertEqual(response.search[0]["status"], "same_model")
        self.assertEqual([match["price_rub"] for match in response.search[0]["matches"]], [86990])

    async def test_trade_in_duo_does_not_replace_selected_ipad_or_escalate(self):
        title = "iPad Air 13 (M4, 2026) Wi-Fi 128 гб, Space Gray"
        price = ("iPad Air 13 M4 2026 Wi-Fi 128 ГБ Blue — 86 990 ₽\n"
                 "iPad Air 13 M4 Wi-Fi 128 ГБ Space Gray — 79 990 ₽\n"
                 "iPhone Duo 256 ГБ White — 191 990 ₽")
        if path := os.environ.get("TAKESMART_CATALOG_SNAPSHOT"):
            price = Path(path).read_text()
        cfg = AvitoBotConfig(enabled=True, persona_name="Илья", price_list=price,
                            llm_provider="deepseek", llm_api_key="fake-test-key")
        await self.save(cfg)
        history = [
            {"author": "client", "text": "по чем, можно по карте? и хочу сдать свою технику"},
            {"author": "bot", "text": "iPad Air 13 M4 2026 Wi-Fi 128 ГБ, Blue — 86 990 ₽ без trade-in\n"
                                      "По trade-in напишите модель, объём памяти и состояние устройства."},
        ]
        with patch.object(bot, "llm_call", new=AsyncMock(side_effect=AssertionError("known case must bypass LLM"))) as model:
            only_this = await preview_reply(PreviewInput(text="нет я только этот хочу", item_title=title, history=history))
            self.assertEqual(only_this.action, "reply", only_this.reason)
            self.assertIn("79 990 ₽", only_this.messages[0].text)
            self.assertNotIn("86 990 ₽", only_this.messages[0].text)
            history.append({"author": "client", "text": "нет я только этот хочу"})
            history.append({"author": "bot", "text": only_this.messages[0].text})

            for request in ("у меня айфон DUO 256gb", "новый айфон дуо", "нет я хочу сдать этот айфон дуо"):
                declined = await preview_reply(PreviewInput(text=request, item_title=title, history=history))
                self.assertEqual(declined.action, "reply", declined.reason)
                self.assertIn("iPhone Duo на 256 ГБ", declined.messages[0].text)
                self.assertIn("не принимаем по trade-in", declined.messages[0].text)
                self.assertNotIn("191 990", declined.messages[0].text)
                history.append({"author": "client", "text": request})
                history.append({"author": "staff", "text": "К сожалению, не можем принять."})

            again = await preview_reply(PreviewInput(text="А за этот сколько?", item_title=title, history=history))
            self.assertEqual(again.action, "reply", again.reason)
            self.assertIn("79 990 ₽", again.messages[0].text)
            self.assertNotIn("191 990", again.messages[0].text)

            mixed = await preview_reply(PreviewInput(text="По чём? И хочу сдать свой айфон Duo 256gb", item_title=title))
            self.assertEqual(mixed.action, "reply", mixed.reason)
            self.assertIn("79 990 ₽", mixed.messages[0].text)
            self.assertIn("не принимаем по trade-in", mixed.messages[0].text)
            model.assert_not_awaited()

        phone = bot.avito_quotes.trade_in_phone([], "хочу сдать iPhone Duo 256gb")
        self.assertIsNone(bot.avito_quotes.trade_in_rejection(phone, "iPhone Duo — 65 000–75 000 ₽"))
        for request in ("хочу купить iPhone Duo по trade-in", "не хочу сдавать iPhone Duo"):
            self.assertIsNone(bot.avito_quotes.trade_in_phone([], request))

        await self.save(cfg.model_copy(update={"trade_in_prices": "iPhone Duo — 65 000–75 000 ₽"}))
        with patch.object(bot, "llm_call", new=AsyncMock(return_value='{"reply":"Подскажите состояние телефона."}')) as accepted:
            reply = await preview_reply(PreviewInput(text="хочу сдать iPhone Duo 256gb", item_title=title))
            self.assertEqual(reply.action, "reply", reply.reason)
            accepted.assert_awaited_once()
            self.assertIn("Устройство покупателя для сдачи по trade-in: iPhone Duo, 256 ГБ", accepted.call_args.args[1][0]["content"])

    async def test_shared_local_color_and_specific_shade_in_chat(self):
        await self.save(AvitoBotConfig(enabled=True, price_list="""
Google Pixel 11 Pro XL 12/256 Obsidian — 82 990 ₽
Google Pixel 11 Pro XL 12/256 Jet Black — 84 990 ₽
Google Pixel 11 Pro XL 12/256 Snow — 85 990 ₽
Google Pixel 11 Pro XL 12/512 Obsidian — 89 990 ₽
Google Pixel 11 Pro XL 12/512 Snow — 88 990 ₽
"""))
        with patch.object(bot, "llm_call", new=AsyncMock(side_effect=AssertionError("catalog lookup required"))):
            first = await preview_reply(PreviewInput(text="по чем", item_title="Google Pixel 11 Pro XL 12/256, чёрный"))
            self.assertEqual(first.action, "reply", first.reason)
            self.assertEqual(first.search[0]["status"], "exact")
            text = first.messages[0].text
            self.assertIn("Здравствуйте", text)
            for name, price in (("Obsidian", "82 990 ₽"), ("Jet Black", "84 990 ₽")):
                self.assertTrue(any(name.lower() in line.lower() and price in line for line in text.splitlines()), text)
            for wrong in ("85 990 ₽", "89 990 ₽", "не могу подтвердить"):
                self.assertNotIn(wrong, text)
            followup = await preview_reply(PreviewInput(
                text="Только Obsidian", item_title="Google Pixel 11 Pro XL 12/256, чёрный",
                history=[{"author": "client", "text": "по чем"}, {"author": "bot", **first.messages[0].model_dump()}],
            ))
            self.assertEqual(followup.action, "reply", followup.reason)
            self.assertEqual(followup.search[0]["status"], "exact")
            self.assertIn("82 990 ₽", followup.messages[0].text)
            for wrong in ("84 990 ₽", "85 990 ₽", "89 990 ₽"):
                self.assertNotIn(wrong, followup.messages[0].text)
            from_text = await preview_reply(PreviewInput(
                text="А на 512?", item_title="Google Pixel 11 Pro XL 12/256, чёрный", history=[
                    {"author": "client", "text": "по чем"}, {"author": "bot", "text": first.messages[0].text},
                ],
            ))
            self.assertEqual(from_text.action, "reply", from_text.reason)
            self.assertIn("89 990 ₽", from_text.messages[0].text)
            self.assertNotIn("88 990 ₽", from_text.messages[0].text)

    async def test_price_file_teaches_new_shade_to_listing_and_followup(self):
        await self.save(AvitoBotConfig(enabled=True, price_list="""
@|31100|Dyson HS08, Lunar Mist||Lunar Mist|лунный туман||||
@|32200|Dyson HS08, Ceramic Pink||Ceramic Pink|розовый||||
!|Acme|speaker|Pulse V2|41400|да|{"color":"Lunar Mist","color_ru":"лунный туман"}
!|Acme|speaker|Pulse V2|42800|да|{"color":"White"}
"""))
        with patch.object(bot, "llm_call", new=AsyncMock(side_effect=AssertionError("catalog lookup required"))):
            for label in ("Lunar Mist", "лунный туман", "Lunar Mist (лунный туман)", "лунный туман (Lunar Mist)"):
                first = await preview_reply(PreviewInput(text="по чем", item_title=f"Dyson HS08, {label}"))
                self.assertEqual(first.action, "reply", label)
                self.assertEqual(first.search[0]["status"], "exact", label)
                self.assertIn("31 100 ₽", first.messages[0].text)
                self.assertNotIn("32 200 ₽", first.messages[0].text)

            listing = "Dyson HS08, Ceramic Pink"
            previous = await preview_reply(PreviewInput(text="по чем", item_title=listing))
            followup = await preview_reply(PreviewInput(
                text="А лунный туман?", item_title=listing, history=[
                    {"author": "client", "text": "по чем"}, {"author": "bot", **previous.messages[0].model_dump()},
                ],
            ))
            self.assertEqual(followup.action, "reply", followup.reason)
            self.assertEqual(followup.search[0]["status"], "exact")
            self.assertIn("31 100 ₽", followup.messages[0].text)
            self.assertNotIn("32 200 ₽", followup.messages[0].text)

            speaker = await preview_reply(PreviewInput(text="по чем", item_title="Acme Pulse V2, лунный туман"))
            self.assertEqual(speaker.action, "reply", speaker.reason)
            self.assertEqual(speaker.search[0]["status"], "exact")
            self.assertIn("41 400 ₽", speaker.messages[0].text)
            for wrong in ("42 800 ₽", "31 100 ₽", "32 200 ₽"):
                self.assertNotIn(wrong, speaker.messages[0].text)

    async def test_full_price_snapshot(self):
        path = os.environ.get("TAKESMART_CATALOG_SNAPSHOT")
        if not path:
            self.skipTest("set TAKESMART_CATALOG_SNAPSHOT to an offline price snapshot")
        raw = Path(path).read_text()
        rows, errors = catalog.prepare(raw)
        self.assertFalse(errors, errors)
        self.assertTrue(rows)
        cfg = AvitoBotConfig(enabled=True, persona_name="Илья", price_list=raw)
        await self.save(cfg)
        palette = catalog.import_colors(raw)
        async with AsyncSessionFactory() as session:
            revision = await catalog.active_import(session, raw)
            published = (await session.execute(catalog.rows_for(revision))).all()
            self.assertEqual({row["key"] for row in rows}, {row.key for row in published})
            imported = {row["key"]: row["item"] for row in rows}
            misses = []
            for row in published:
                if not row.available:
                    continue
                query = catalog.ProductQuery(model_id=row.model_id,
                    attributes={key: value for key, value in row.attributes.items() if key != "few"})
                result = await catalog.search(session, revision, query, allow_other_models=False)
                matched = next((m for m in result.matches if m.item.key == row.key and m.item.price == row.price
                                and m.relation == "exact"), None)
                self.assertIsNotNone(matched, row.name)
                old_reply = bot.avito_quotes._line(matched)
                recovered, _ = bot.avito_quotes.conversation_subject(
                    bot.ChatContext(history=[("bot", old_reply)]), palette,
                )
                self.assertIsNotNone(recovered, old_reply)
                self.assertEqual(catalog.model_key(recovered.model, row.brand_key), row.model_key, old_reply)
                self.assertEqual(recovered.attributes, query.attributes, old_reply)
                item = imported[row.key]
                color, russian = item.attributes.get("color"), item.attributes.get("color_ru")
                names = [(item.name, True)]
                if color and russian:
                    model, separator, suffix = item.name.rpartition(color)
                    self.assertTrue(separator, f"{color!r} missing in source name {item.name!r}")
                    names.extend((model + label + suffix, specific) for label, specific in (
                        (russian, False), (f"{color} ({russian})", True), (f"{russian} ({color})", True),
                    ))
                for name, specific in names:
                    title = ", ".join([name] + [
                        item.attributes[key] for key in ("country", "sim") if item.attributes.get(key)
                    ])
                    decision, replies = await bot.plan_chat_reply(session, cfg, bot.ChatContext(item_title=title),
                                                                   "по чем", {})
                    self.assertEqual(decision.action, "reply", title)
                    self.assertEqual(len(replies), 1, title)
                    reply_text = replies[0].text
                    self.assertIn("Илья", reply_text, title)
                    for denial in ("нет в наличии", "нет точной комплектации", "не могу подтвердить"):
                        self.assertNotIn(denial, reply_text.casefold(), title)
                    trace = decision.search[0] if decision.search else {}
                    exact = [m for m in trace.get("matches", []) if m["relation"] == "exact"]
                    if color and specific:
                        self.assertEqual({m["attributes"].get("color") for m in exact} - {row.attributes["color"]},
                                         set(), title)
                    if specific:
                        self.assertIn(f"{int(row.price):,} ₽".replace(",", " "), reply_text, title)
                    found_original = any(m["id"] == row.key and m["price_rub"] == row.price for m in exact)
                    shown_prices = [f"{m['price_rub']:,} ₽".replace(",", " ") for m in exact if m.get("shown")]
                    kept_color = not color or trace.get("query", {}).get("attributes", {}).get("color")
                    if not (found_original and kept_color and any(price in reply_text for price in shown_prices)):
                        misses.append((title, trace.get("query"), reply_text))
            self.assertEqual(len(misses), 0, f"Position title lookup failures (first 12): {misses[:12]}")

    async def test_catalog_and_pilot_through_runtime(self):
        cfg = AvitoBotConfig(
            enabled=True, listing_scope="selected", allowed_listing_ids=[1001], collect_messages_seconds=15,
            mode="auto", human_mode=False, orders_enabled=True, price_list=PRICE,
            llm_provider="deepseek", llm_api_key="fake-test-key",
            first_message="Здравствуйте! Цена по объявлению {price}",
        )
        await self.save(cfg.model_copy(update={"price_list": "iPhone 16 128 White — 59 990 ₽"}))
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
        listing_ids = {item["id"] for item in (await list_listings(page=1, source="chats"))["items"]}
        self.assertTrue({"1001", "1002"}.issubset(listing_ids))

        async def samsung_model(_config, messages):
            if messages[0]["content"].startswith("Извлеки поисковые"):
                return json.dumps({"queries": [query.model_dump()]})
            return json.dumps({"reply": "Чёрный Samsung Galaxy S26 Ultra 16/256 ГБ, две физические SIM — 81 000 ₽."})

        with patch.object(bot, "llm_call", new=samsung_model):
            samsung = await preview_reply(PreviewInput(
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
            samsung = await preview_reply(PreviewInput(
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
            dyson = await preview_reply(PreviewInput(text="А Dyson V15 Detect Absolute сколько?", item_id=1001, item_title=SAMSUNG))
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
                self.assertEqual((await verifier.get(Product, iphone_id)).stock_quantity, 3)
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
            denied = await preview_reply(PreviewInput(text=buyer_text, item_id=1002, item_title=SAMSUNG))
            self.assertEqual(denied.action, "silent")
            self.assertFalse(calls)
            preview = await preview_reply(PreviewInput(text=buyer_text, item_id=1001, item_title=SAMSUNG))
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
            price = await preview_reply(PreviewInput(
                text="белый на терабайт сколько?", item_id=1003, item_title=listing,
            ))
            self.assertEqual(price.action, "reply", price.reason)
            self.assertTrue(any("264 990 ₽" in message.text for message in price.messages))
            self.assertFalse(any("259 990 ₽" in message.text for message in price.messages))
            self.assertEqual(len(price.messages), 1)
            self.assertIn("Здравствуйте", price.messages[0].text)

            white = await preview_reply(PreviewInput(text="Белый сколько?", item_id=1003, item_title=listing))
            white_text = white.messages[0].text
            self.assertIn("219 990 ₽", white_text)
            self.assertIn("239 990 ₽", white_text)
            self.assertIn("264 990 ₽", white_text)
            self.assertNotIn("259 990 ₽", white_text)

            followup = await preview_reply(PreviewInput(
                text="а на 512?", item_id=1001, item_title=SAMSUNG,
                history=[
                    {"author": "client", "text": "Белый на терабайт сколько?"},
                    {"author": "bot", "text": price.messages[0].text},
                ],
            ))
            self.assertEqual(followup.action, "reply", followup.reason)
            self.assertTrue(any("239 990 ₽" in message.text for message in followup.messages),
                            (price.messages[0].text, followup.search, [message.text for message in followup.messages]))
            self.assertFalse(any("234 990 ₽" in message.text for message in followup.messages))

            no_call = AsyncMock(side_effect=AssertionError("clear catalog price should not call the model"))
            with patch.object(bot, "llm_call", new=no_call):
                fallback = await preview_reply(PreviewInput(
                    text="iPhone Duo 1 ТБ белый сколько стоит?", item_id=1003, item_title=listing,
                ))
            no_call.assert_not_awaited()
            self.assertEqual(fallback.action, "reply", fallback.reason)
            self.assertTrue(any("264 990 ₽" in message.text for message in fallback.messages))
            self.assertFalse(any("259 990 ₽" in message.text for message in fallback.messages))

            greeting_call = AsyncMock(side_effect=AssertionError("non-price greeting should not call the model"))
            with patch.object(bot, "llm_call", new=greeting_call):
                greeting = await preview_reply(PreviewInput(
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
                delivery = await preview_reply(PreviewInput(
                    text="Белый Duo 1 ТБ сколько, и доставка есть?", item_id=1003, item_title=listing,
                ))
            self.assertEqual(len(extraction_calls), 2)
            self.assertTrue(extraction_calls[0].startswith("Извлеки поисковые"))
            delivery_text = " ".join(message.text for message in delivery.messages)
            self.assertEqual(delivery_text.count("264 990 ₽"), 1)
            self.assertIn("достав", delivery_text.lower())

            echo = await preview_reply(PreviewInput(
                text="Белый Duo 1 ТБ сколько, и доставка есть?", item_id=1003, item_title=listing,
            ))
            self.assertEqual(echo.action, "handoff", echo.reason)
            self.assertIn("264 990 ₽", echo.messages[0].text)
            self.assertNotIn("Илья, добрый вечер", echo.messages[0].text)

            mixed = await preview_reply(PreviewInput(
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

    async def test_a57_short_price_and_first_greeting_in_new_listing_chat(self):
        title = "Samsung Galaxy A57, 8/256 ГБ"
        await self.save(AvitoBotConfig(
            enabled=True, listing_scope="selected", allowed_listing_ids=[4001], mode="auto",
            persona_name="Илья", greeting="", human_mode=False, orders_enabled=False,
            llm_provider="qwen", llm_api_key="fake-test-key",
            price_list=(
                "Samsung A57 5G 8/256 Black — 31 990 ₽\n"
                "Samsung A17 4G 8/256 Gray — 22 990 ₽\n"
                "Samsung A17 5G 8/256 Gray — 25 990 ₽"
            ),
        ))
        async with AsyncSessionFactory() as session:
            old = AvitoChat(avito_chat_id=f"integration-{uuid4()}", item_id=4002, client_avito_id=555)
            new = AvitoChat(avito_chat_id=f"integration-{uuid4()}", item_id=4001, client_avito_id=555, item_title=title)
            session.add_all([old, new])
            await session.flush()
            session.add(AvitoMessage(chat_id=old.id, author="bot", status="sent", text="Здравствуйте!"))
            await session.commit()
            new_id, external = new.id, new.avito_chat_id

        no_model = AsyncMock(side_effect=AssertionError("catalog price uses the listing directly"))
        with (patch.object(bot, "llm_call", new=no_model), patch.object(bot, "_send", new=AsyncMock(return_value=None))):
            await bot.handle_incoming(external, str(uuid4()), 555, "по чем")
            await bot._process_chat(new_id)
            async with AsyncSessionFactory() as session:
                first = (await session.execute(select(AvitoMessage).where(
                    AvitoMessage.chat_id == new_id, AvitoMessage.status == "scheduled",
                ))).scalar_one()
                self.assertTrue(first.text.startswith("Здравствуйте! Меня зовут Илья"), first.text)
                self.assertIn("A57 5G 8/256", first.text)
                self.assertIn("31 990 ₽", first.text)
                self.assertNotIn("A17", first.text)
                self.assertEqual(first.source, "catalog")
                first_id = first.id
            await bot.deliver_due_message(first_id)

            await bot.handle_incoming(external, str(uuid4()), 555, "по чём?")
            await bot._process_chat(new_id)
            async with AsyncSessionFactory() as session:
                followup = (await session.execute(select(AvitoMessage).where(
                    AvitoMessage.chat_id == new_id, AvitoMessage.status == "scheduled",
                ))).scalar_one()
                self.assertIn("31 990 ₽", followup.text)
                self.assertNotIn("Здравствуйте", followup.text)
                self.assertFalse((await session.get(AvitoChat, new_id)).needs_human)

            missing = await preview_reply(PreviewInput(text="по чем", item_id=4001, item_title="Samsung Galaxy A56, 8/256 ГБ"))
            self.assertEqual(missing.search[0]["matches"], [])
            self.assertNotIn("A17", missing.messages[0].text)
            explicit = await preview_reply(PreviewInput(text="Почём A17 5G 8/256?", item_id=4001, item_title=title))
            self.assertIn("25 990 ₽", explicit.messages[0].text)
            self.assertNotIn("22 990 ₽", explicit.messages[0].text)
        no_model.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
