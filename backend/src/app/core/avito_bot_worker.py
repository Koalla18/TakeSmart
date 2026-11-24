"""
Фоновый обработчик Авито-бота — живёт внутри процесса API (запускается в lifespan).

Каждую секунду:
  • берёт диалоги, которым пора ответить (reply_due_at), и решает за каждый — до
    MAX_PARALLEL одновременно, чтобы медленная модель не задерживала остальных;
  • отправляет запланированные сообщения, у которых наступил send_at.
Раз в POLL_EVERY — опрос непрочитанных чатов Авито (догонялка за вебхуком).
Раз в REMIND_EVERY — напоминания замолчавшим покупателям (если включены).
Рассылки — по одному сообщению, с паузой broadcast_interval_seconds между ними.

Всё состояние — в базе, задачи берутся через SELECT … FOR UPDATE SKIP LOCKED,
поэтому несколько процессов или перезапуск ничего не ломают и не дублируют.
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
MAX_PARALLEL = 5


class _Worker:
    def __init__(self) -> None:
        self.running: set[asyncio.Task] = set()
        self.slots = asyncio.Semaphore(MAX_PARALLEL)
        self.last_poll = 0.0
        self.last_remind = 0.0
        self.broadcasting = False

    def _spawn(self, coro, what: str) -> None:
        async def guarded() -> None:
            async with self.slots:
                try:
                    await coro
                except Exception as exc:  # noqa: BLE001 — одна сломанная задача не валит обработчик
                    logger.exception("avito_bot_task_failed", what=what, error=str(exc))
        task = asyncio.create_task(guarded())
        self.running.add(task)
        task.add_done_callback(self.running.discard)

    async def tick(self) -> None:
        free = MAX_PARALLEL - len(self.running)
        if free > 0:
            for chat_id in await bot.claim_due_chats(limit=free):
                self._spawn(bot.process_chat(chat_id), f"chat:{chat_id}")
        for message_id in await bot.claim_due_messages():
            self._spawn(bot.deliver_due_message(message_id), f"send:{message_id}")
        # Рассылка: по одному сообщению за проход, темп задаёт пауза в настройках
        if not self.broadcasting:
            self.broadcasting = True
            async def step() -> None:
                try:
                    await bot.broadcast_step()
                finally:
                    self.broadcasting = False
            self._spawn(step(), "broadcast")
        if time.monotonic() - self.last_poll >= POLL_EVERY:
            self.last_poll = time.monotonic()
            self._spawn(bot.poll_unread(), "poll")
        if time.monotonic() - self.last_remind >= REMIND_EVERY:
            self.last_remind = time.monotonic()
            self._spawn(bot.run_reminders(), "reminders")

    async def run(self) -> None:
        logger.info("avito_bot_worker_started")
        # Первый опрос — через минуту после старта, а не сразу: даём приложению подняться
        self.last_poll = time.monotonic() - POLL_EVERY + 60
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — база мигнула и т.п.: ждём и пробуем снова
                logger.warning("avito_bot_worker_tick_failed", error=str(exc)[:300])
                await asyncio.sleep(5)
            await asyncio.sleep(TICK_SECONDS)


def start() -> asyncio.Task:
    return asyncio.create_task(_Worker().run(), name="avito-bot-worker")


async def stop(task: asyncio.Task) -> None:
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass


__all__ = ["start", "stop"]
