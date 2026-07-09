from src.app.api.routers.health import router as health_router
from src.app.api.routers.product_images import router as product_images_router
from src.app.api.routers.categories import router as categories_router
from src.app.api.routers.products import router as products_router
from src.app.api.routers.product_groups import router as product_groups_router
from src.app.api.routers.orders import router as orders_router
from src.app.api.routers.weekly_slides import router as weekly_slides_router
from src.app.api.routers.hero_banners import router as hero_banners_router
from src.app.api.routers.push import router as push_router
from src.app.api.routers.media import router as media_router
from src.app.api.admin.endpoints import router as admin_router

__all__ = [
    "health_router",
    "product_images_router",
    "categories_router",
    "products_router",
    "product_groups_router",
    "orders_router",
    "weekly_slides_router",
    "hero_banners_router",
    "push_router",
    "media_router",
]

__all__.append("admin_router")
