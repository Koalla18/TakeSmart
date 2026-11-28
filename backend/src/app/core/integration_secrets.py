from __future__ import annotations

from base64 import urlsafe_b64encode
from hashlib import sha256
from os import getenv

from cryptography.fernet import Fernet, InvalidToken

from src.app.core.config import DEFAULT_SECRET_KEY, settings


def _cipher(purpose: str, key: str) -> Fernet:
    return Fernet(urlsafe_b64encode(sha256(f"{purpose}:{key}".encode()).digest()))


def seal(value: str, purpose: str) -> str:
    key = settings.INTEGRATION_ENCRYPTION_KEY
    prefix = "enc:v2:" if key else "enc:"
    return prefix + _cipher(purpose, key or settings.INTEGRATION_LEGACY_KEY or settings.SECRET_KEY).encrypt(value.encode()).decode()


def open_sealed(value: str, purpose: str) -> str:
    if value.startswith("enc:v2:"):
        return _cipher(purpose, settings.INTEGRATION_ENCRYPTION_KEY).decrypt(value[7:].encode()).decode()
    if value.startswith("enc:"):
        old_keys = [settings.INTEGRATION_LEGACY_KEY, settings.SECRET_KEY]
        if purpose == "avito-bot" and getenv("JWT_SECRET") and not getenv("SECRET_KEY"):
            # Старый релиз игнорировал JWT_SECRET, хотя оно было указано в примере env.
            old_keys.append(DEFAULT_SECRET_KEY)
        for key in dict.fromkeys(filter(None, old_keys)):
            try:
                return _cipher(purpose, key).decrypt(value[4:].encode()).decode()
            except InvalidToken:
                continue
        raise InvalidToken()
    return value
