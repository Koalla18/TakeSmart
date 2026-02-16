# TakeSmart Backend Testing

## Running Tests

### Install test dependencies
```bash
pip install -r requirements.txt
pip install -r requirements-test.txt
```

### Run all tests
```bash
pytest tests/
```

### Run with verbose output
```bash
pytest tests/ -v
```

### Run with coverage report
```bash
pytest tests/ --cov=app --cov-report=html
```

### Run specific test file
```bash
pytest tests/test_auth.py
```

### Run specific test
```bash
pytest tests/test_auth.py::test_login_success
```

## Test Structure

- `tests/conftest.py` - Pytest configuration and fixtures
- `tests/test_health.py` - Health check and system tests
- `tests/test_auth.py` - Authentication tests
- `tests/test_products.py` - Product endpoint tests
- `tests/test_categories.py` - Category endpoint tests
- `tests/test_orders.py` - Order endpoint tests
- `tests/test_analytics.py` - Analytics endpoint tests
- `tests/test_seed.py` - Seed endpoint tests

## Test Coverage

The tests cover:
- ✅ All API endpoints (public and admin)
- ✅ Authentication and authorization
- ✅ CRUD operations
- ✅ Validation errors
- ✅ Error handling
- ✅ Database operations

## Writing New Tests

Use the async/await pattern with pytest-asyncio:

```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_my_endpoint(client: AsyncClient):
    response = await client.get("/api/my-endpoint")
    assert response.status_code == 200
```

## Fixtures

- `client` - Async HTTP client for API testing
- `test_session` - Async database session
- `test_engine` - Test database engine
- `auth_headers` - Pre-configured authentication headers

