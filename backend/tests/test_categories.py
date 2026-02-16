"""Tests for category endpoints."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_categories_empty(client: AsyncClient):
    """Test listing categories when database is empty."""
    response = await client.get("/api/categories")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_create_category_unauthorized(client: AsyncClient):
    """Test creating category without authentication."""
    category_data = {
        "slug": "test-category",
        "name": "Test Category",
        "is_active": True,
    }
    response = await client.post("/api/admin/categories", json=category_data)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_create_category_authorized(client: AsyncClient):
    """Test creating category with authentication."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    category_data = {
        "slug": "smartphones",
        "name": "Смартфоны",
        "description": "iPhone, Samsung, Xiaomi",
        "icon": "📱",
        "sort_order": 1,
        "is_active": True,
    }

    response = await client.post(
        "/api/admin/categories",
        json=category_data,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["slug"] == "smartphones"
    assert data["name"] == "Смартфоны"
    assert data["icon"] == "📱"


@pytest.mark.asyncio
async def test_create_duplicate_category(client: AsyncClient):
    """Test creating category with duplicate slug."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    category_data = {
        "slug": "duplicate-category",
        "name": "Duplicate",
        "is_active": True,
    }

    # Create first category
    response = await client.post("/api/admin/categories", json=category_data, headers=headers)
    assert response.status_code == 201

    # Try to create duplicate
    response = await client.post("/api/admin/categories", json=category_data, headers=headers)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_list_all_categories_admin(client: AsyncClient):
    """Test listing all categories (admin endpoint)."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    response = await client.get(
        "/api/admin/categories",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_get_category_not_found(client: AsyncClient):
    """Test getting non-existent category."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    response = await client.get(
        "/api/admin/categories/999999",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_category(client: AsyncClient):
    """Test updating category."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create category first
    category_data = {
        "slug": "test-update",
        "name": "Test Update",
        "is_active": True,
    }
    create_response = await client.post(
        "/api/admin/categories", json=category_data, headers=headers
    )
    category_id = create_response.json()["id"]

    # Update the category
    update_data = {"name": "Updated Name"}
    response = await client.patch(
        f"/api/admin/categories/{category_id}",
        json=update_data,
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_delete_category(client: AsyncClient):
    """Test deleting category."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create category first
    category_data = {
        "slug": "test-delete",
        "name": "Test Delete",
        "is_active": True,
    }
    create_response = await client.post(
        "/api/admin/categories", json=category_data, headers=headers
    )
    category_id = create_response.json()["id"]

    # Delete the category
    response = await client.delete(
        f"/api/admin/categories/{category_id}",
        headers=headers,
    )
    assert response.status_code == 204

    # Verify it's deleted
    get_response = await client.get(
        f"/api/admin/categories/{category_id}",
        headers=headers,
    )
    assert get_response.status_code == 404

