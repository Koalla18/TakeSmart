from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt
import secrets
import hashlib
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from .settings import settings


# Security scheme
security = HTTPBearer(
    description="JWT Bearer token for admin authentication",
    auto_error=True
)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1, max_length=100)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until expiration


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> tuple[str, int]:
    """
    Create a JWT access token.
    Returns tuple of (token, expires_in_seconds).
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours)
    
    # Add standard JWT claims
    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),  # Issued at
        "jti": secrets.token_hex(16),  # Unique token ID
    })
    
    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret, algorithm="HS256")
    expires_in = int((expire - datetime.now(timezone.utc)).total_seconds())
    
    return encoded_jwt, expires_in


def verify_token(token: str) -> dict:
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(
            token, 
            settings.jwt_secret, 
            algorithms=["HS256"],
            options={"require": ["exp", "iat", "role"]}
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": "token_expired",
                "message": "Сессия истекла. Пожалуйста, войдите снова."
            }
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": "invalid_token",
                "message": "Недействительный токен авторизации."
            }
        )


def verify_admin(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Dependency to verify admin access."""
    token = credentials.credentials
    payload = verify_token(token)
    if payload.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "forbidden",
                "message": "Требуются права администратора."
            }
        )
    return payload


def _secure_compare(a: str, b: str) -> bool:
    """Constant-time string comparison to prevent timing attacks."""
    return secrets.compare_digest(a.encode('utf-8'), b.encode('utf-8'))


def authenticate_admin(username: str, password: str) -> Optional[dict]:
    """
    Authenticate admin credentials using constant-time comparison.
    Returns admin data dict if valid, None otherwise.
    """
    # Use constant-time comparison to prevent timing attacks
    username_valid = _secure_compare(username, settings.admin_username)
    password_valid = _secure_compare(password, settings.admin_password)
    
    if username_valid and password_valid:
        return {"username": username, "role": "admin"}
    return None
