"""Tests for authentication endpoints."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    """Test successful admin login."""
    response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert len(data["access_token"]) > 0


@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient):
    """Test login with invalid credentials."""
    response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrongpassword"},
    )
    assert response.status_code == 401
    assert "Invalid credentials" in response.json()["detail"]


@pytest.mark.asyncio
async def test_login_missing_username(client: AsyncClient):
    """Test login with missing username."""
    response = await client.post(
        "/api/auth/login",
        json={"password": "takesmart2024"},
    )
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_login_missing_password(client: AsyncClient):
    """Test login with missing password."""
    response = await client.post(
        "/api/auth/login",
        json={"username": "admin"},
    )
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_verify_token_valid(client: AsyncClient):
    """Test token verification with valid token."""
    # First login to get a valid token
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    # Verify the token
    response = await client.get(
        "/api/auth/verify",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["username"] == "admin"


@pytest.mark.asyncio
async def test_verify_token_invalid(client: AsyncClient):
    """Test token verification with invalid token."""
    response = await client.get(
        "/api/auth/verify",
        headers={"Authorization": "Bearer invalid_token"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_verify_token_missing(client: AsyncClient):
    """Test token verification without token."""
    response = await client.get("/api/auth/verify")
    assert response.status_code == 403  # Forbidden without authorization

