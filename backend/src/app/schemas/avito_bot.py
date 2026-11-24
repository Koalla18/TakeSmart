from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

DEFAULT_STYLE = (
    "Пиши как живой продавец-консультант в мессенджере: коротко (1–3 предложения), "
    "дружелюбно, без канцелярита и без эмодзи-гирлянд. Обращайся на «вы». "
    "Не повторяй приветствие, если уже здоровался в этом диалоге. "
    "Если покупатель отказался — не уговаривай, вежливо оставь контакт. "
    "Заканчивай понятным следующим шагом: забронировать, приехать, оформить доставку — "
    "но только если это уместно."
)
DEFAULT_HANDOFF = "торг и скидки сверх условий, возврат, брак, претензия, жалоба, ремонт, юридические вопросы"


# ── Настройки ────────────────────────────────────────────────────────────────

LlmProvider = Literal["none", "yandex", "deepseek", "openai_compatible"]


class AvitoBotConfig(BaseModel):
    """Хранится целиком в site_settings.avito_bot_config. Секреты наружу не отдаются."""
    enabled: bool = False
    mode: Literal["draft", "auto"] = "draft"
    persona_name: str = Field("Дарья", max_length=40)
    style: str = Field(DEFAULT_STYLE, max_length=3000)
    knowledge: str = Field("", max_length=20000, description="Свободный текст: всё, что бот должен знать о магазине")
    handoff_topics: str = Field(DEFAULT_HANDOFF, max_length=1000)
    handoff_message: str = Field("", max_length=500, description="Что написать покупателю, когда зовём человека; пусто — молчать")
    reply_delay_min: int = Field(5, ge=0, le=300)
    reply_delay_max: int = Field(15, ge=0, le=600)
    use_catalog: bool = True
    orders_enabled: bool = False
    pickup_address: str = Field("ТЦ «Багратионовский», ул. Барклая 10, 1 этаж, павильон А60", max_length=300)

    llm_provider: LlmProvider = "none"
    llm_base_url: str = Field("", max_length=300)
    llm_model: str = Field("", max_length=200)
    llm_folder_id: str = Field("", max_length=100)
    llm_api_key: str = Field("", max_length=500)
    llm_temperature: float = Field(0.4, ge=0, le=1.5)

    avito_client_id: str = Field("", max_length=200)
    avito_client_secret: str = Field("", max_length=300)
    avito_user_id: int | None = None
    avito_connected_at: datetime | None = None
    webhook_secret: str = Field("", max_length=80)


SECRET_FIELDS = ("llm_api_key", "avito_client_secret")


class AvitoBotConfigOut(BaseModel):
    enabled: bool
    mode: str
    persona_name: str
    style: str
    knowledge: str
    handoff_topics: str
    handoff_message: str
    reply_delay_min: int
    reply_delay_max: int
    use_catalog: bool
    orders_enabled: bool
    pickup_address: str
    llm_provider: str
    llm_base_url: str
    llm_model: str
    llm_folder_id: str
    llm_temperature: float
    llm_api_key_set: bool
    avito_client_id: str
    avito_client_secret_set: bool
    avito_user_id: int | None
    avito_connected_at: datetime | None
    webhook_url: str | None


class AvitoBotConfigIn(BaseModel):
    """Частичное обновление. Пустая строка в секретном поле — «не менять»; null — стереть."""
    enabled: bool | None = None
    mode: Literal["draft", "auto"] | None = None
    persona_name: str | None = Field(None, max_length=40)
    style: str | None = Field(None, max_length=3000)
    knowledge: str | None = Field(None, max_length=20000)
    handoff_topics: str | None = Field(None, max_length=1000)
    handoff_message: str | None = Field(None, max_length=500)
    reply_delay_min: int | None = Field(None, ge=0, le=300)
    reply_delay_max: int | None = Field(None, ge=0, le=600)
    use_catalog: bool | None = None
    orders_enabled: bool | None = None
    pickup_address: str | None = Field(None, max_length=300)
    llm_provider: LlmProvider | None = None
    llm_base_url: str | None = Field(None, max_length=300)
    llm_model: str | None = Field(None, max_length=200)
    llm_folder_id: str | None = Field(None, max_length=100)
    llm_api_key: str | None = Field(None, max_length=500)
    llm_temperature: float | None = Field(None, ge=0, le=1.5)
    avito_client_id: str | None = Field(None, max_length=200)
    avito_client_secret: str | None = Field(None, max_length=300)


# ── Правила ──────────────────────────────────────────────────────────────────

class RuleFields(BaseModel):
    keywords: list[str] = Field(..., min_length=1, max_length=50)
    answer: str = Field(..., min_length=1, max_length=4000)
    verbatim: bool = True
    time_from: str = "00:00"
    time_to: str = "23:59"
    days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6])
    delay_seconds: int = Field(2, ge=0, le=600)
    max_per_chat: int = Field(1, ge=0, le=100)
    is_active: bool = True
    sort: int = 0

    @field_validator("keywords")
    @classmethod
    def _clean_keywords(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for k in v:
            k = " ".join(k.strip().split())
            if k and k.lower() not in (x.lower() for x in out):
                out.append(k[:100])
        if not out:
            raise ValueError("Нужно хотя бы одно ключевое слово")
        return out

    @field_validator("time_from", "time_to")
    @classmethod
    def _time(cls, v: str) -> str:
        v = v.strip()[:5]
        if not _TIME.match(v):
            raise ValueError("Время в формате ЧЧ:ММ")
        return v

    @field_validator("days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        days = sorted({d for d in v if 0 <= d <= 6})
        if not days:
            raise ValueError("Выберите хотя бы один день недели")
        return days


class RuleIn(RuleFields):
    pass


class RulePatch(BaseModel):
    keywords: list[str] | None = None
    answer: str | None = Field(None, min_length=1, max_length=4000)
    verbatim: bool | None = None
    time_from: str | None = None
    time_to: str | None = None
    days: list[int] | None = None
    delay_seconds: int | None = Field(None, ge=0, le=600)
    max_per_chat: int | None = Field(None, ge=0, le=100)
    is_active: bool | None = None
    sort: int | None = None


class RuleOut(RuleFields):
    id: uuid.UUID
    hits: int
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class RulesImportIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=200000)
    replace: bool = False


class RulesImportOut(BaseModel):
    created: int
    skipped: int
    errors: list[str]


# ── Диалоги ──────────────────────────────────────────────────────────────────

class MessageOut(BaseModel):
    id: uuid.UUID
    author: str
    text: str
    status: str
    source: str | None
    rule_id: uuid.UUID | None
    error: str | None
    send_at: datetime | None = None
    attempts: int = 0
    order_payload: dict | None = None
    created_at: datetime
    sent_at: datetime | None
    model_config = {"from_attributes": True}


class ChatOut(BaseModel):
    id: uuid.UUID
    avito_chat_id: str
    is_simulated: bool
    client_name: str | None
    item_id: int | None
    item_title: str | None
    item_price: str | None
    item_url: str | None
    mode: str
    needs_human: bool
    human_reason: str | None
    last_message_text: str | None
    last_message_at: datetime | None
    created_at: datetime
    order_id: uuid.UUID | None = None
    order_number: str | None = None
    human_question: str | None = None
    has_draft: bool = False
    model_config = {"from_attributes": True}


class LinkedProductOut(BaseModel):
    id: uuid.UUID
    name: str
    price: float
    stock_quantity: int
    is_preorder: bool


class ChatDetailOut(ChatOut):
    messages: list[MessageOut]
    linked_product: LinkedProductOut | None = None


class ChatsOut(BaseModel):
    chats: list[ChatOut]
    total: int
    needs_human: int
    drafts: int


class SendIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class ApproveIn(BaseModel):
    text: str | None = Field(None, min_length=1, max_length=4000)


class SimulateIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    chat_id: uuid.UUID | None = None
    client_name: str = Field("Тестовый покупатель", max_length=120)
    item_title: str | None = Field(None, max_length=300)
    item_price: str | None = Field(None, max_length=60)


# ── Тестовый чат (без сохранения) ────────────────────────────────────────────

class TestTurn(BaseModel):
    author: Literal["client", "bot", "staff"]
    text: str = Field(..., max_length=4000)


class TestIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    history: list[TestTurn] = Field(default_factory=list, max_length=40)
    item_title: str | None = Field(None, max_length=300)
    item_price: str | None = Field(None, max_length=60)


class DecisionOut(BaseModel):
    action: Literal["reply", "handoff", "silent"]
    text: str | None
    source: str | None
    rule_id: uuid.UUID | None
    reason: str | None
    delay_seconds: int
    catalog: list[str] = Field(default_factory=list, description="Какие товары каталога модель видела")
    order: dict | None = Field(None, description="Бронь, которую бот оформил бы")
    examples_used: int = 0


class HealthOut(BaseModel):
    last_webhook_at: datetime | None = None
    last_poll_at: datetime | None = None
    last_poll_error: str | None = None
    caught_by_poll: int = Field(0, description="Сообщений, которые пришли не вебхуком, а опросом")
    llm_fail_streak: int = 0
    last_llm_error: str | None = None
    queue_replies: int = 0
    queue_sends: int = 0


class StatusOut(BaseModel):
    enabled: bool
    mode: str
    llm_ready: bool
    avito_ready: bool
    avito_connected: bool
    webhook_url: str | None
    health: HealthOut


# ── Обучение и привязка объявлений ───────────────────────────────────────────

class ExampleOut(BaseModel):
    id: uuid.UUID
    question: str
    bot_answer: str | None
    answer: str
    item_title: str | None
    chat_id: uuid.UUID | None
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class ExamplePatch(BaseModel):
    answer: str | None = Field(None, min_length=1, max_length=4000)
    is_active: bool | None = None


class UnansweredOut(BaseModel):
    chat_id: uuid.UUID
    client_name: str | None
    item_title: str | None
    question: str
    reason: str | None
    at: datetime | None


class LearningOut(BaseModel):
    examples: list[ExampleOut]
    unanswered: list[UnansweredOut]


class ProductHitOut(LinkedProductOut):
    pass


class LinkIn(BaseModel):
    product_id: uuid.UUID


class ConnectOut(BaseModel):
    ok: bool
    user_id: int | None
    webhook_url: str
    detail: str
