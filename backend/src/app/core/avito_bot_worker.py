"""
Фоновый обработчик Авито-бота — живёт внутри процесса API (запускается в lifespan).

Каждую секунду:
  • берёт диалоги, которым пора ответить (reply_due_at), и решает за каждый — до
    MAX_REPLIES одновременно, чтобы медленная модель не задерживала остальные задачи;
  • отправляет запланированные сообщения, у которых наступил send_at.
Раз в POLL_EVERY — опрос непрочитанных чатов Авито (догонялка за вебхуком).
Раз в REMIND_EVERY — напоминания замолчавшим покупателям (если включены).
Рассылки — по одному сообщению, с паузой broadcast_interval_seconds между ними.

Входящие и задания хранятся в PostgreSQL. Просроченная аренда возвращает
незавершённое задание в очередь.
"""
from __future__ import annotations

import asyncio
import time

from src.app.core import avito_bot_service as bot
from src.app.core.logger import get_logger

logger = get_logger(__name__)

TICK_SECONDS = 1.0
POLL_EVERY = 120.0
REMIND_EVERY = 60.0
MAX_REPLIES = 5
MAX_INCOMING = 2
MAX_SENDS = 3


class _Worker:
    def __init__(self) -> None:
        self.running: dict[asyncio.Task, str] = {}
        self.last_poll = 0.0
        self.last_remind = 0.0
        self.broadcasting = False

    def _spawn(self, coro, kind: str) -> None:
        async def guarded() -> None:
            try:
                await coro
            except Exception:  # noqa: BLE001 — одна сломанная задача не валит обработчик
                logger.error("avito_bot_task_failed", kind=kind)
        task = asyncio.create_task(guarded())
        self.running[task] = kind
        task.add_done_callback(self.running.pop)

    def _free(self, kind: str, maximum: int) -> int:
        return maximum - sum(value == kind for value in self.running.values())

    async def tick(self) -> None:
        free = self._free("webhook", MAX_INCOMING)
        if free > 0:
            for key, payload in await bot.claim_webhook_events(limit=free):
                self._spawn(bot.process_webhook_event(key, payload), "webhook")
        free = self._free("reply", MAX_REPLIES)
        if free > 0:
            for chat_id, lease in await bot.claim_due_chats(limit=free):
                self._spawn(bot.process_chat(chat_id, lease), "reply")
        free = self._free("send", MAX_SENDS)
        if free > 0:
            for message_id in await bot.claim_due_messages(limit=free):
                self._spawn(bot.deliver_due_message(message_id), "send")
        # Рассылка: по одному сообщению за проход, темп задаёт пауза в настройках
        if not self.broadcasting:
            self.broadcasting = True
            async def step() -> None:
                try:
                    await bot.broadcast_step()
                finally:
                    self.broadcasting = False
            self._spawn(step(), "broadcast")
        if self._free("poll", 1) and time.monotonic() - self.last_poll >= POLL_EVERY:
            self.last_poll = time.monotonic()
            self._spawn(bot.poll_unread(), "poll")
        if self._free("reminders", 1) and time.monotonic() - self.last_remind >= REMIND_EVERY:
            self.last_remind = time.monotonic()
            self._spawn(bot.run_reminders(), "reminders")

    async def run(self) -> None:
        logger.info("avito_bot_worker_started")
        # Первый опрос — через минуту после старта, а не сразу: даём приложению подняться
        self.last_poll = time.monotonic() - POLL_EVERY + 60
        try:
            while True:
                try:
                    await self.tick()
                except Exception as exc:  # noqa: BLE001 — база мигнула и т.п.: ждём и пробуем снова
                    logger.warning("avito_bot_worker_tick_failed", error_type=type(exc).__name__)
                    await asyncio.sleep(5)
                await asyncio.sleep(TICK_SECONDS)
        finally:
            running = list(self.running)
            for task in running:
                task.cancel()
            await asyncio.gather(*running, return_exceptions=True)


def start() -> asyncio.Task:
    return asyncio.create_task(_Worker().run(), name="avito-bot-worker")


async def stop(task: asyncio.Task) -> None:
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass


__all__ = ["start", "stop"]
