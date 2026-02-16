"""Tests for seed endpoint."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_seed_unauthorized(client: AsyncClient):
    """Test seed endpoint without authentication."""
    response = await client.post("/api/admin/seed")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_seed_authorized(client: AsyncClient):
    """Test seed endpoint with authentication."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    response = await client.post(
        "/api/admin/seed",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["ok"] is True


@pytest.mark.asyncio
async def test_seed_creates_data(client: AsyncClient):
    """Test that seed actually creates data."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Run seed
    seed_response = await client.post("/api/admin/seed", headers=headers)
    assert seed_response.status_code == 201

    # Check that categories were created
    categories_response = await client.get("/api/categories")
    categories = categories_response.json()
    assert len(categories) > 0

    # Check that products were created
    products_response = await client.get("/api/products")
    products = products_response.json()
    assert len(products) > 0


@pytest.mark.asyncio
async def test_seed_idempotent(client: AsyncClient):
    """Test that seed can be run multiple times without errors."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Run seed twice
    response1 = await client.post("/api/admin/seed", headers=headers)
    assert response1.status_code == 201

    response2 = await client.post("/api/admin/seed", headers=headers)
    assert response2.status_code == 201

