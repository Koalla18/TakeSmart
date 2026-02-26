from src.app.api.routers.health import router as health_router
from src.app.api.routers.product_images import router as product_images_router
from src.app.api.routers.categories import router as categories_router
from src.app.api.routers.products import router as products_router
from src.app.api.routers.orders import router as orders_router
from src.app.api.admin.endpoints import router as admin_router

__all__ = [
    "health_router",
    "product_images_router",
    "categories_router",
    "products_router",
    "orders_router",
]

__all__.append("admin_router")
