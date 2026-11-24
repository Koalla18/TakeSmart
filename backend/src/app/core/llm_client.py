"""
Языковая модель для Авито-бота через OpenAI-совместимый API (/chat/completions).

Все поддержанные провайдеры говорят на этом протоколе, поэтому сменить модель —
значит поменять настройку в админке, без правки кода:
  yandex             — YandexGPT, https://llm.api.cloud.yandex.net/v1, модель gpt://<каталог>/<модель>
  deepseek           — https://api.deepseek.com, модель deepseek-chat
  qwen               — Alibaba Cloud Model Studio (Qwen), регион Сингапур: с ID рабочего пространства —
                       https://<workspace>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1, без него —
                       прежний общий адрес dashscope-intl. Ключ работает только в регионе, где создан.
                       Qwen есть и в Yandex AI Studio: провайдер yandex, модель qwen3.6-35b-a3b
  timeweb            — ИИ-агент Timeweb Cloud: https://agent.timeweb.cloud/api/v1/cloud-ai/agents/<Access ID>/v1,
                       авторизация токеном агента (Bearer); модель (Qwen и др.) выбирается в панели агента,
                       поле model в запросе игнорируется
  openai_compatible  — любой другой адрес (OpenRouter, свой сервер с Qwen и т.п.)
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from src.app.core.logger import get_logger

logger = get_logger(__name__)

TIMEOUT = httpx.Timeout(40.0, connect=10.0)

DEFAULTS = {
    "yandex": ("https://llm.api.cloud.yandex.net/v1", "yandexgpt/latest"),
    "deepseek": ("https://api.deepseek.com", "deepseek-chat"),
    "qwen": ("https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "qwen3.7-plus"),
    "timeweb": ("", "agent"),
    "openai_compatible": ("", ""),
}


class LlmError(Exception):
    pass


@dataclass
class LlmSettings:
    provider: str
    base_url: str
    model: str
    api_key: str
    folder_id: str
    temperature: float

    @property
    def ready(self) -> bool:
        if self.provider not in DEFAULTS or not self.api_key:
            return False
        if self.provider in ("yandex", "timeweb") and not self.folder_id and not (self.provider == "timeweb" and self.base_url):
            return False
        return bool(self.resolved_base_url and self.resolved_model)

    @property
    def resolved_base_url(self) -> str:
        if self.base_url:
            # Вставили «OpenAI URL» целиком, вместе с /chat/completions — отрезаем хвост
            return self.base_url.strip().rstrip("/").removesuffix("/chat/completions")
        if self.provider == "timeweb" and self.folder_id:
            return f"https://agent.timeweb.cloud/api/v1/cloud-ai/agents/{self.folder_id.strip()}/v1"
        if self.provider == "qwen" and self.folder_id:
            return f"https://{self.folder_id.strip()}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
        return (self.base_url or DEFAULTS.get(self.provider, ("", ""))[0]).rstrip("/")

    @property
    def resolved_model(self) -> str:
        model = self.model or DEFAULTS.get(self.provider, ("", ""))[1]
        if self.provider == "yandex" and model and not model.startswith("gpt://"):
            model = f"gpt://{self.folder_id}/{model}"
        return model


@dataclass
class LlmResult:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0


async def complete(cfg: LlmSettings, messages: list[dict[str, str]], max_tokens: int = 500) -> LlmResult:
    if not cfg.ready:
        raise LlmError("Модель не настроена")
    headers = {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"}
    if cfg.provider == "yandex":
        headers["OpenAI-Project"] = cfg.folder_id
        headers["x-folder-id"] = cfg.folder_id
    body = {
        "model": cfg.resolved_model,
        "messages": messages,
        "temperature": cfg.temperature,
        "max_tokens": max_tokens,
    }
    url = f"{cfg.resolved_base_url}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(url, headers=headers, json=body)
            # Часть моделей (например, gpt-5 у агентов Timeweb) не принимает temperature и max_tokens —
            # повторяем запрос без них
            if resp.status_code == 400 and ("temperature" in resp.text or "max_tokens" in resp.text):
                body.pop("temperature", None)
                body["max_completion_tokens"] = body.pop("max_tokens", max_tokens)
                resp = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        raise LlmError(f"Нет связи с моделью: {exc.__class__.__name__}") from exc
    if resp.status_code >= 400:
        logger.warning("llm_http_error", provider=cfg.provider, status=resp.status_code, body=resp.text[:300])
        raise LlmError(f"Модель ответила ошибкой {resp.status_code}: {resp.text[:160]}")
    try:
        data = resp.json()
        text = data["choices"][0]["message"]["content"] or ""
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LlmError("Непонятный ответ модели") from exc
    usage = data.get("usage") or {}
    return LlmResult(text, int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
                     int(usage.get("completion_tokens") or usage.get("output_tokens") or 0))
