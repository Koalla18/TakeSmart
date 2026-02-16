"""Tests for product endpoints."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_products_empty(client: AsyncClient):
    """Test listing products when database is empty."""
    response = await client.get("/api/products")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_products_with_filters(client: AsyncClient):
    """Test listing products with filters."""
    # Test category filter
    response = await client.get("/api/products?category=smartphones")
    assert response.status_code == 200

    # Test is_used filter
    response = await client.get("/api/products?is_used=true")
    assert response.status_code == 200

    # Test in_stock filter
    response = await client.get("/api/products?in_stock=true")
    assert response.status_code == 200

    # Test search filter
    response = await client.get("/api/products?search=iphone")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_featured_product_none(client: AsyncClient):
    """Test getting featured product when none exists."""
    response = await client.get("/api/products/featured")
    assert response.status_code == 200
    assert response.json() is None


@pytest.mark.asyncio
async def test_get_product_not_found(client: AsyncClient):
    """Test getting non-existent product."""
    response = await client.get("/api/products/999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_get_product_by_slug_not_found(client: AsyncClient):
    """Test getting product by non-existent slug."""
    response = await client.get("/api/products/slug/non-existent-slug")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_product_unauthorized(client: AsyncClient):
    """Test creating product without authentication."""
    product_data = {
        "name": "Test Product",
        "slug": "test-product",
        "price": 10000,
        "in_stock": True,
    }
    response = await client.post("/api/admin/products", json=product_data)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_all_products_admin_unauthorized(client: AsyncClient):
    """Test listing all products (admin) without authentication."""
    response = await client.get("/api/admin/products")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_create_product_authorized(client: AsyncClient):
    """Test creating product with authentication."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]

    product_data = {
        "name": "Test iPhone",
        "slug": "test-iphone-15",
        "brand": "Apple",
        "price": 99990,
        "in_stock": True,
        "is_active": True,
    }

    response = await client.post(
        "/api/admin/products",
        json=product_data,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test iPhone"
    assert data["slug"] == "test-iphone-15"
    assert data["price"] == 99990


@pytest.mark.asyncio
async def test_create_duplicate_product(client: AsyncClient):
    """Test creating product with duplicate slug."""
    # Login first
    login_response = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "takesmart2024"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    product_data = {
        "name": "Test Product",
        "slug": "duplicate-slug",
        "price": 10000,
        "in_stock": True,
    }

    # Create first product
    response = await client.post("/api/admin/products", json=product_data, headers=headers)
    assert response.status_code == 201

    # Try to create duplicate
    response = await client.post("/api/admin/products", json=product_data, headers=headers)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"].lower()

