"""Tests for analytics endpoints."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_analytics_unauthorized(client: AsyncClient):
    """Test getting analytics without authentication."""
    response = await client.get("/api/analytics")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_analytics_authorized(client: AsyncClient):
    """Test getting analytics with authentication."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    response = await client.get(
        "/api/analytics",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    data = response.json()
    # Verify structure
    assert "total_orders" in data
    assert "today_orders" in data
    assert "week_orders" in data
    assert "month_orders" in data
    assert "status_counts" in data
    assert "total_revenue" in data
    assert "today_revenue" in data
    assert "week_revenue" in data
    assert "avg_order_value" in data
    assert "payment_stats" in data
    assert "delivery_stats" in data
    assert "daily_orders" in data

    # Verify types
    assert isinstance(data["total_orders"], int)
    assert isinstance(data["status_counts"], dict)
    assert isinstance(data["daily_orders"], list)


@pytest.mark.asyncio
async def test_analytics_empty_database(client: AsyncClient):
    """Test analytics with empty database."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    response = await client.get(
        "/api/analytics",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    data = response.json()
    # All counts should be 0 for empty database
    assert data["total_orders"] == 0
    assert data["today_orders"] == 0
    assert data["total_revenue"] == 0
    assert data["avg_order_value"] == 0

