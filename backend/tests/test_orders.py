"""Tests for order endpoints."""
import pytest
from httpx import AsyncClient

# Данные для входа (берутся из окружения/conftest)
ADMIN_CREDENTIALS = {"username": "admin", "password": "TakeSmart_Dev_2024!"}


async def _get_admin_token(client: AsyncClient) -> str:
    login_response = await client.post("/api/auth/login", json=ADMIN_CREDENTIALS)
    return login_response.json()["access_token"]


@pytest.mark.asyncio
async def test_create_order_success(client: AsyncClient):
    """Test creating a new order (без товаров — пустая корзина)."""
    order_data = {
        "name": "Иван Иванов",
        "phone": "+79991234567",
        "email": "ivan@example.com",
        "comment": "Позвоните перед доставкой",
        "items": [],  # Пустая корзина — товары не нужны для базового теста
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
    # total_amount считается сервером, для пустой корзины = None
    assert data["total_amount"] is None
    assert "id" in data
    # id должен быть валидным UUID
    import uuid

    uuid.UUID(data["id"])  # не бросит исключение если валидный


@pytest.mark.asyncio
async def test_create_order_invalid_payment_method(client: AsyncClient):
    """Test creating order with invalid payment_method is rejected."""
    order_data = {
        "name": "Тест Тестов",
        "phone": "+79991234567",
        "email": "test@example.com",
        "payment_method": "bitcoin",  # Недопустимый метод
    }
    response = await client.post("/api/orders", json=order_data)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_order_invalid_delivery_method(client: AsyncClient):
    """Test creating order with invalid delivery_method is rejected."""
    order_data = {
        "name": "Тест Тестов",
        "phone": "+79991234567",
        "email": "test@example.com",
        "delivery_method": "teleport",  # Недопустимый метод
    }
    response = await client.post("/api/orders", json=order_data)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_order_invalid_product_uuid(client: AsyncClient):
    """Test that non-UUID product_id is rejected."""
    order_data = {
        "name": "Тест Тестов",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [{"product_id": "not-a-uuid", "quantity": 1}],
    }
    response = await client.post("/api/orders", json=order_data)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_order_missing_fields(client: AsyncClient):
    """Test creating order with missing required fields."""
    order_data = {"name": "Test User"}
    response = await client.post("/api/orders", json=order_data)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_orders_unauthorized(client: AsyncClient):
    """Test listing orders without authentication."""
    response = await client.get("/api/orders")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_orders_authorized(client: AsyncClient):
    """Test listing orders with authentication."""
    token = await _get_admin_token(client)
    response = await client.get(
        "/api/orders", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_list_orders_with_status_filter(client: AsyncClient):
    """Test listing orders with status filter."""
    token = await _get_admin_token(client)
    response = await client.get(
        "/api/orders?status=new",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_order_by_id(client: AsyncClient):
    """Test getting order by UUID."""
    token = await _get_admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    # Create an order first
    order_data = {
        "name": "Test User",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [],
    }
    create_response = await client.post("/api/orders", json=order_data)
    assert create_response.status_code == 201
    order_id = create_response.json()["id"]

    # Get the order by UUID
    response = await client.get(f"/api/orders/{order_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["id"] == order_id


@pytest.mark.asyncio
async def test_update_order_status(client: AsyncClient):
    """Test updating order status."""
    token = await _get_admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    order_data = {
        "name": "Test User",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [],
    }
    create_response = await client.post("/api/orders", json=order_data)
    order_id = create_response.json()["id"]

    response = await client.patch(
        f"/api/orders/{order_id}/status",
        json={"status": "processing"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "processing"


@pytest.mark.asyncio
async def test_update_order_invalid_status(client: AsyncClient):
    """Test updating order with invalid status is rejected by Pydantic Literal."""
    token = await _get_admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    order_data = {
        "name": "Test User",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [],
    }
    create_response = await client.post("/api/orders", json=order_data)
    order_id = create_response.json()["id"]

    response = await client.patch(
        f"/api/orders/{order_id}/status",
        json={"status": "invalid_status"},
        headers=headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_delete_order(client: AsyncClient):
    """Test deleting order."""
    token = await _get_admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    order_data = {
        "name": "Test User",
        "phone": "+79991234567",
        "email": "test@example.com",
        "items": [],
    }
    create_response = await client.post("/api/orders", json=order_data)
    order_id = create_response.json()["id"]

    response = await client.delete(f"/api/orders/{order_id}", headers=headers)
    assert response.status_code == 204

    # Verify it's deleted
    get_response = await client.get(f"/api/orders/{order_id}", headers=headers)
    assert get_response.status_code == 404

