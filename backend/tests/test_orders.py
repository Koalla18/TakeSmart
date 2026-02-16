"""Tests for order endpoints."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_order_success(client: AsyncClient):
    """Test creating a new order."""
    order_data = {
        "name": "Иван Иванов",
        "phone": "+79991234567",
        "email": "ivan@example.com",
        "comment": "Позвоните перед доставкой",
        "items": [
            {
                "product_id": 1,
                "name": "iPhone 15 Pro",
                "price": 99990,
                "quantity": 1,
            }
        ],
        "total_amount": 99990,
        "payment_method": "card",
        "delivery_method": "courier",
        "delivery_address": "г. Москва, ул. Ленина, д. 1",
    }

    response = await client.post("/api/orders", json=order_data)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Иван Иванов"
    assert data["phone"] == "+79991234567"
    assert data["status"] == "new"
    assert data["total_amount"] == 99990
    assert "id" in data


@pytest.mark.asyncio
async def test_create_order_missing_fields(client: AsyncClient):
    """Test creating order with missing required fields."""
    order_data = {
        "name": "Test User",
        # Missing phone, email, etc.
    }

    response = await client.post("/api/orders", json=order_data)
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_list_orders_unauthorized(client: AsyncClient):
    """Test listing orders without authentication."""
    response = await client.get("/api/orders")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_orders_authorized(client: AsyncClient):
    """Test listing orders with authentication."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    response = await client.get(
        "/api/orders",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_list_orders_with_status_filter(client: AsyncClient):
    """Test listing orders with status filter."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    response = await client.get(
        "/api/orders?status=new",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_order_by_id(client: AsyncClient):
    """Test getting order by ID."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create an order first
    order_data = {
        "name": "Test User",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [],
        "total_amount": 1000,
    }
    create_response = await client.post("/api/orders", json=order_data)
    order_id = create_response.json()["id"]

    # Get the order
    response = await client.get(f"/api/orders/{order_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["id"] == order_id


@pytest.mark.asyncio
async def test_update_order_status(client: AsyncClient):
    """Test updating order status."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create an order first
    order_data = {
        "name": "Test User",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [],
        "total_amount": 1000,
    }
    create_response = await client.post("/api/orders", json=order_data)
    order_id = create_response.json()["id"]

    # Update status
    response = await client.patch(
        f"/api/orders/{order_id}/status",
        json={"status": "processing"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "processing"


@pytest.mark.asyncio
async def test_update_order_invalid_status(client: AsyncClient):
    """Test updating order with invalid status."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create an order first
    order_data = {
        "name": "Test User",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [],
        "total_amount": 1000,
    }
    create_response = await client.post("/api/orders", json=order_data)
    order_id = create_response.json()["id"]

    # Try invalid status
    response = await client.patch(
        f"/api/orders/{order_id}/status",
        json={"status": "invalid_status"},
        headers=headers,
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_delete_order(client: AsyncClient):
    """Test deleting order."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create an order first
    order_data = {
        "name": "Test User",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [],
        "total_amount": 1000,
    }
    create_response = await client.post("/api/orders", json=order_data)
    order_id = create_response.json()["id"]

    # Delete the order
    response = await client.delete(f"/api/orders/{order_id}", headers=headers)
    assert response.status_code == 204

    # Verify it's deleted
    get_response = await client.get(f"/api/orders/{order_id}", headers=headers)
    assert get_response.status_code == 404

