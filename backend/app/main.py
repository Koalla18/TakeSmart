import asyncio
import os
import uuid
from datetime import datetime, timedelta
from fastapi import Depends, FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from .db import get_db, engine, SessionLocal
from .models import Base, Order, Category, Product, WeeklySlide
from .schemas import (
    OrderCreate, OrderRead, OrderStatusUpdate,
    CategoryCreate, CategoryRead, CategoryUpdate,
    ProductCreate, ProductRead, ProductUpdate,
    WeeklySlideCreate, WeeklySlideRead, WeeklySlideUpdate
)
from .settings import settings
from .auth import (
    LoginRequest, TokenResponse, 
    create_access_token, authenticate_admin, verify_admin
)
from .telegram import send_telegram_notification
from .middleware import (
    RequestLoggingMiddleware, 
    RateLimitMiddleware, 
    SecurityHeadersMiddleware,
    logger
)

app = FastAPI(
    title="Take Smart API",
    description="API для интернет-магазина TakeSmart",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# Create uploads directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files for uploads
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Add middleware (order matters - first added is outermost)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler for structured errors
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Return structured error responses."""
    detail = exc.detail
    if isinstance(detail, str):
        detail = {"error": "request_error", "message": detail}
    
    return JSONResponse(
        status_code=exc.status_code,
        content=detail,
        headers=getattr(exc, "headers", None)
    )


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created/verified")
    logger.info(f"Server started. CORS origins: {settings.cors_origins_list}")
    
    # Auto-seed weekly slides if empty
    db = SessionLocal()
    try:
        if db.query(WeeklySlide).count() == 0:
            default_slides = [
                WeeklySlide(
                    title="iPhone 17 Pro",
                    badge="Мощь. Стиль. Pro.",
                    description="Оригинальная техника Apple без переплат.\nОбмен старого устройства на новое с выгодой до 50%.\nДоставка в день заказа по Москве и МО.",
                    price="94 000",
                    image="/iphone-17-pro.png",
                    color="bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50",
                    tags=["trade-in", "гарантия 12 месяцев*", "новинка"],
                    is_new=True,
                    sort_order=0
                ),
                WeeklySlide(
                    title="MacBook Air M3",
                    badge="Лёгкость. Мощь. Air.",
                    description="Невероятно тонкий и лёгкий.\nДо 18 часов работы без подзарядки.\nЧип M3 — производительность нового уровня.",
                    price="119 990",
                    image="https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/macbook-air-midnight-select-20220606?wid=800&hei=800&fmt=png-alpha",
                    color="bg-gradient-to-br from-slate-100 via-gray-50 to-slate-50",
                    tags=["trade-in", "гарантия 12 месяцев*", "хит"],
                    is_new=False,
                    sort_order=1
                ),
                WeeklySlide(
                    title="AirPods Pro 2",
                    badge="Звук. Без границ.",
                    description="Активное шумоподавление нового поколения.\nАдаптивное аудио — под вас.\nДо 6 часов прослушивания.",
                    price="24 990",
                    image="https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/airpods-pro-2-hero-select-202409?wid=800&hei=800&fmt=png-alpha",
                    color="bg-gradient-to-br from-purple-50 via-white to-fuchsia-50",
                    tags=["trade-in", "гарантия 12 месяцев*"],
                    is_new=False,
                    sort_order=2
                ),
                WeeklySlide(
                    title="Apple Watch Ultra 2",
                    badge="Создан для приключений.",
                    description="Титановый корпус 49 мм.\nСамый яркий дисплей Apple Watch.\nДо 36 часов автономной работы.",
                    price="79 990",
                    image="/watch-ultra-2.png",
                    color="bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50",
                    tags=["trade-in", "гарантия 12 месяцев*", "новинка"],
                    is_new=True,
                    sort_order=3
                ),
            ]
            db.add_all(default_slides)
            db.commit()
            logger.info("Weekly slides seeded automatically")
    finally:
        db.close()


@app.get("/health")
def health():
    """Health check endpoint with database connectivity test."""
    try:
        # Test database connection
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"
    
    return {
        "status": "ok",
        "database": db_status,
        "version": "1.0.0"
    }


# ============ AUTH ENDPOINTS ============

@app.post("/api/auth/login", response_model=TokenResponse)
def login(request: LoginRequest):
    """Admin login endpoint."""
    user = authenticate_admin(request.username, request.password)
    if not user:
        raise HTTPException(
            status_code=401, 
            detail={
                "error": "invalid_credentials",
                "message": "Неверный логин или пароль"
            }
        )
    
    access_token, expires_in = create_access_token(
        data=user, 
        expires_delta=timedelta(hours=settings.jwt_expiry_hours)
    )
    return TokenResponse(
        access_token=access_token,
        expires_in=expires_in
    )


@app.get("/api/auth/verify")
def verify_auth(admin: dict = Depends(verify_admin)):
    """Verify current token is valid."""
    return {"valid": True, "username": admin.get("username")}


# ============ ORDERS ENDPOINTS ============

@app.post("/api/orders", response_model=OrderRead, status_code=201)
async def create_order(
    order_data: OrderCreate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Create a new order with full cart data."""
    # Convert items to list of dicts for JSON storage
    items_data = None
    if order_data.items:
        items_data = [item.model_dump() for item in order_data.items]
    
    order = Order(
        name=order_data.name,
        phone=order_data.phone,
        email=order_data.email,
        comment=order_data.comment,
        items=items_data,
        total_amount=order_data.total_amount,
        payment_method=order_data.payment_method,
        delivery_method=order_data.delivery_method,
        delivery_address=order_data.delivery_address,
        status='new'
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    
    # Build order dict for Telegram notification
    order_dict = {
        "id": order.id,
        "name": order.name,
        "phone": order.phone,
        "email": order.email,
        "comment": order.comment,
        "items": items_data,
        "total_amount": order.total_amount,
        "payment_method": order.payment_method,
        "delivery_method": order.delivery_method,
        "delivery_address": order.delivery_address,
        "created_at": order.created_at.strftime("%d.%m.%Y %H:%M")
    }
    background_tasks.add_task(send_telegram_notification, order_dict)
    
    return order


@app.get("/api/orders", response_model=list[OrderRead])
def list_orders(
    status: str | None = None,
    db: Session = Depends(get_db), 
    admin: dict = Depends(verify_admin)
):
    """List all orders with optional status filter (admin only)."""
    query = db.query(Order)
    if status and status != 'all':
        query = query.filter(Order.status == status)
    orders = query.order_by(Order.created_at.desc()).all()
    return orders


@app.get("/api/orders/{order_id}", response_model=OrderRead)
def get_order(
    order_id: int, 
    db: Session = Depends(get_db), 
    admin: dict = Depends(verify_admin)
):
    """Get single order details (admin only)."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.patch("/api/orders/{order_id}/status")
def update_order_status(
    order_id: int,
    status_data: OrderStatusUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Update order status (admin only)."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    valid_statuses = ['new', 'processing', 'ready', 'completed', 'cancelled']
    if status_data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    order.status = status_data.status
    db.commit()
    db.refresh(order)
    
    return {"success": True, "status": order.status}


@app.delete("/api/orders/{order_id}", status_code=204)
def delete_order(order_id: int, db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """Delete an order (admin only)."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    db.delete(order)
    db.commit()
    return None


# ============ ANALYTICS ENDPOINTS ============

@app.get("/api/analytics")
def get_analytics(db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """Get comprehensive analytics data (admin only)."""
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    
    # Total orders
    total_orders = db.query(func.count(Order.id)).scalar() or 0
    
    # Today's orders
    today_orders = db.query(func.count(Order.id)).filter(
        Order.created_at >= today_start
    ).scalar() or 0
    
    # Week's orders
    week_orders = db.query(func.count(Order.id)).filter(
        Order.created_at >= week_ago
    ).scalar() or 0
    
    # Month's orders
    month_orders = db.query(func.count(Order.id)).filter(
        Order.created_at >= month_ago
    ).scalar() or 0
    
    # Orders by status
    status_counts = {}
    for status in ['new', 'processing', 'ready', 'completed', 'cancelled']:
        status_counts[status] = db.query(func.count(Order.id)).filter(
            Order.status == status
        ).scalar() or 0
    
    # Revenue calculations
    total_revenue = db.query(func.sum(Order.total_amount)).filter(
        Order.status.in_(['new', 'processing', 'ready', 'completed'])
    ).scalar() or 0
    
    today_revenue = db.query(func.sum(Order.total_amount)).filter(
        Order.created_at >= today_start,
        Order.status.in_(['new', 'processing', 'ready', 'completed'])
    ).scalar() or 0
    
    week_revenue = db.query(func.sum(Order.total_amount)).filter(
        Order.created_at >= week_ago,
        Order.status.in_(['new', 'processing', 'ready', 'completed'])
    ).scalar() or 0
    
    # Payment method stats
    payment_stats = {}
    for method in ['cash', 'card', 'online']:
        payment_stats[method] = db.query(func.count(Order.id)).filter(
            Order.payment_method == method
        ).scalar() or 0
    
    # Delivery method stats  
    delivery_stats = {}
    for method in ['pickup', 'courier', 'post']:
        delivery_stats[method] = db.query(func.count(Order.id)).filter(
            Order.delivery_method == method
        ).scalar() or 0
    
    # Daily orders for last 14 days
    daily_orders = []
    for i in range(14):
        day = now - timedelta(days=i)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        count = db.query(func.count(Order.id)).filter(
            Order.created_at >= day_start,
            Order.created_at < day_end
        ).scalar() or 0
        revenue = db.query(func.sum(Order.total_amount)).filter(
            Order.created_at >= day_start,
            Order.created_at < day_end,
            Order.status.in_(['new', 'processing', 'ready', 'completed'])
        ).scalar() or 0
        daily_orders.append({
            "date": day_start.strftime("%d.%m"),
            "day": day_start.strftime("%a"),
            "count": count,
            "revenue": revenue
        })
    
    # Average order value
    avg_order_value = 0
    if total_orders > 0:
        avg_result = db.query(func.avg(Order.total_amount)).filter(
            Order.total_amount.isnot(None)
        ).scalar()
        avg_order_value = int(avg_result) if avg_result else 0
    
    return {
        "total_orders": total_orders,
        "today_orders": today_orders,
        "week_orders": week_orders,
        "month_orders": month_orders,
        "status_counts": status_counts,
        "total_revenue": total_revenue,
        "today_revenue": today_revenue,
        "week_revenue": week_revenue,
        "avg_order_value": avg_order_value,
        "payment_stats": payment_stats,
        "delivery_stats": delivery_stats,
        "daily_orders": list(reversed(daily_orders))
    }


# ============ CATEGORY ENDPOINTS ============

@app.get("/api/categories", response_model=list[CategoryRead])
def list_categories(db: Session = Depends(get_db)):
    """List all active categories (public)."""
    categories = db.query(Category).filter(Category.is_active == True).order_by(Category.sort_order).all()
    return categories


@app.get("/api/admin/categories", response_model=list[CategoryRead])
def list_all_categories(db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """List all categories including inactive (admin only)."""
    categories = db.query(Category).order_by(Category.sort_order).all()
    return categories


@app.post("/api/admin/categories", response_model=CategoryRead, status_code=201)
def create_category(
    category_data: CategoryCreate,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Create a new category (admin only)."""
    # Check if slug already exists
    existing = db.query(Category).filter(Category.slug == category_data.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="Category with this slug already exists")
    
    category = Category(**category_data.model_dump())
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@app.get("/api/admin/categories/{category_id}", response_model=CategoryRead)
def get_category(category_id: int, db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """Get single category (admin only)."""
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@app.patch("/api/admin/categories/{category_id}", response_model=CategoryRead)
def update_category(
    category_id: int,
    category_data: CategoryUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Update a category (admin only)."""
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    
    update_data = category_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(category, key, value)
    
    db.commit()
    db.refresh(category)
    return category


@app.delete("/api/admin/categories/{category_id}", status_code=204)
def delete_category(category_id: int, db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """Delete a category (admin only)."""
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    
    # Update products to remove category reference
    db.query(Product).filter(Product.category_id == category_id).update({"category_id": None})
    
    db.delete(category)
    db.commit()
    return None


# ============ PRODUCT ENDPOINTS ============

@app.get("/api/products", response_model=list[ProductRead])
def list_products(
    category: str | None = None,
    is_used: bool | None = None,
    in_stock: bool | None = None,
    db: Session = Depends(get_db)
):
    """List all active products with optional filters (public)."""
    query = db.query(Product).filter(Product.is_active == True)
    
    if category:
        cat = db.query(Category).filter(Category.slug == category).first()
        if cat:
            query = query.filter(Product.category_id == cat.id)
    
    if is_used is not None:
        query = query.filter(Product.is_used == is_used)
    
    if in_stock is not None:
        query = query.filter(Product.in_stock == in_stock)
    
    products = query.order_by(Product.sort_order, Product.created_at.desc()).all()
    return products


@app.get("/api/products/featured", response_model=ProductRead | None)
def get_featured_product(db: Session = Depends(get_db)):
    """Get the featured product for landing page (public)."""
    product = db.query(Product).filter(
        Product.is_featured == True, 
        Product.is_active == True
    ).first()
    return product


@app.post("/api/admin/products/{product_id}/set-featured", response_model=ProductRead)
def set_featured_product(
    product_id: int,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Set a product as featured (unsets all others)."""
    # Unset all featured products
    db.query(Product).filter(Product.is_featured == True).update({"is_featured": False})
    
    # Set the new featured product
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    product.is_featured = True
    db.commit()
    db.refresh(product)
    return product


# ============ WEEKLY SLIDES ENDPOINTS ============

@app.get("/api/weekly-slides", response_model=list[WeeklySlideRead])
def get_weekly_slides(db: Session = Depends(get_db)):
    """Get all active weekly slides (public)."""
    return db.query(WeeklySlide).filter(
        WeeklySlide.is_active == True
    ).order_by(WeeklySlide.sort_order).all()


@app.get("/api/admin/weekly-slides", response_model=list[WeeklySlideRead])
def get_all_weekly_slides(
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Get all weekly slides (admin)."""
    return db.query(WeeklySlide).order_by(WeeklySlide.sort_order).all()


@app.post("/api/admin/weekly-slides", response_model=WeeklySlideRead, status_code=201)
def create_weekly_slide(
    slide_data: WeeklySlideCreate,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Create a new weekly slide."""
    slide = WeeklySlide(**slide_data.model_dump())
    db.add(slide)
    db.commit()
    db.refresh(slide)
    return slide


@app.patch("/api/admin/weekly-slides/{slide_id}", response_model=WeeklySlideRead)
def update_weekly_slide(
    slide_id: int,
    slide_data: WeeklySlideUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Update a weekly slide."""
    slide = db.query(WeeklySlide).filter(WeeklySlide.id == slide_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    
    update_data = slide_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(slide, key, value)
    
    db.commit()
    db.refresh(slide)
    return slide


@app.delete("/api/admin/weekly-slides/{slide_id}")
def delete_weekly_slide(
    slide_id: int,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Delete a weekly slide."""
    slide = db.query(WeeklySlide).filter(WeeklySlide.id == slide_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    db.delete(slide)
    db.commit()
    return {"ok": True}


@app.post("/api/admin/weekly-slides/seed")
def seed_weekly_slides(
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Seed default weekly slides."""
    existing = db.query(WeeklySlide).count()
    if existing > 0:
        return {"message": "Слайды уже существуют", "count": existing}
    
    default_slides = [
        WeeklySlide(
            title="iPhone 17 Pro",
            badge="Мощь. Стиль. Pro.",
            description="Оригинальная техника Apple без переплат.\nОбмен старого устройства на новое с выгодой до 50%.\nДоставка в день заказа по Москве и МО.",
            price="94 000",
            image="/iphone-17-pro.png",
            color="bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50",
            tags=["trade-in", "гарантия 12 месяцев*", "новинка"],
            is_new=True,
            sort_order=0
        ),
        WeeklySlide(
            title="MacBook Air M3",
            badge="Лёгкость. Мощь. Air.",
            description="Невероятно тонкий и лёгкий.\nДо 18 часов работы без подзарядки.\nЧип M3 — производительность нового уровня.",
            price="119 990",
            image="https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/macbook-air-midnight-select-20220606?wid=800&hei=800&fmt=png-alpha",
            color="bg-gradient-to-br from-slate-100 via-gray-50 to-slate-50",
            tags=["trade-in", "гарантия 12 месяцев*", "хит"],
            is_new=False,
            sort_order=1
        ),
        WeeklySlide(
            title="AirPods Pro 2",
            badge="Звук. Без границ.",
            description="Активное шумоподавление нового поколения.\nАдаптивное аудио — под вас.\nДо 6 часов прослушивания.",
            price="24 990",
            image="https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/airpods-pro-2-hero-select-202409?wid=800&hei=800&fmt=png-alpha",
            color="bg-gradient-to-br from-purple-50 via-white to-fuchsia-50",
            tags=["trade-in", "гарантия 12 месяцев*"],
            is_new=False,
            sort_order=2
        ),
        WeeklySlide(
            title="Apple Watch Ultra 2",
            badge="Создан для приключений.",
            description="Титановый корпус 49 мм.\nСамый яркий дисплей Apple Watch.\nДо 36 часов автономной работы.",
            price="79 990",
            image="/watch-ultra-2.png",
            color="bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50",
            tags=["trade-in", "гарантия 12 месяцев*", "новинка"],
            is_new=True,
            sort_order=3
        ),
    ]
    
    db.add_all(default_slides)
    db.commit()
    return {"message": "Слайды созданы", "count": len(default_slides)}


def _validate_file_content(contents: bytes, content_type: str) -> bool:
    """
    Validate file content by checking magic bytes.
    Extra security layer beyond content-type header.
    """
    # Magic bytes for common image formats
    magic_bytes = {
        "image/jpeg": [b'\xff\xd8\xff'],
        "image/png": [b'\x89PNG\r\n\x1a\n'],
        "image/gif": [b'GIF87a', b'GIF89a'],
        "image/webp": [b'RIFF'],  # WebP starts with RIFF
    }
    
    signatures = magic_bytes.get(content_type, [])
    for sig in signatures:
        if contents.startswith(sig):
            return True
    
    # If no magic bytes defined for type, allow (for webp we check RIFF)
    if content_type == "image/webp" and len(contents) > 12:
        # WebP has WEBP at byte 8
        return contents[8:12] == b'WEBP'
    
    return len(signatures) == 0  # Allow if no signatures defined


@app.post("/api/admin/upload")
async def upload_file(
    file: UploadFile = File(...),
    admin: dict = Depends(verify_admin)
):
    """Upload an image file and return its URL."""
    # Validate file type from settings
    allowed_types = settings.allowed_upload_types_list
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400, 
            detail={
                "error": "invalid_file_type",
                "message": f"Недопустимый формат файла. Разрешены: {', '.join(allowed_types)}"
            }
        )
    
    # Validate file size from settings
    max_size = settings.max_upload_size_mb * 1024 * 1024
    contents = await file.read()
    if len(contents) > max_size:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "file_too_large",
                "message": f"Файл слишком большой. Максимум {settings.max_upload_size_mb}MB"
            }
        )
    
    # Validate file content (magic bytes check)
    if not _validate_file_content(contents, file.content_type):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_file_content",
                "message": "Содержимое файла не соответствует заявленному типу"
            }
        )
    
    # Generate unique filename with sanitized extension
    original_ext = file.filename.split('.')[-1].lower() if '.' in file.filename else 'jpg'
    # Only allow safe extensions
    safe_extensions = {'jpg', 'jpeg', 'png', 'webp', 'gif'}
    ext = original_ext if original_ext in safe_extensions else 'jpg'
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    
    # Save file
    try:
        with open(filepath, "wb") as f:
            f.write(contents)
        logger.info(f"File uploaded: {filename} ({len(contents)} bytes)")
    except IOError as e:
        logger.error(f"File upload failed: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "upload_failed",
                "message": "Ошибка при сохранении файла"
            }
        )
    
    # Return the URL
    return {"url": f"/uploads/{filename}", "filename": filename, "size": len(contents)}


@app.delete("/api/admin/upload/{filename}")
def delete_uploaded_file(
    filename: str,
    admin: dict = Depends(verify_admin)
):
    """Delete an uploaded file."""
    # Prevent path traversal attacks
    safe_filename = os.path.basename(filename)
    if safe_filename != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    
    filepath = os.path.join(UPLOAD_DIR, safe_filename)
    if os.path.exists(filepath):
        os.remove(filepath)
        logger.info(f"File deleted: {safe_filename}")
        return {"ok": True}
    raise HTTPException(status_code=404, detail="File not found")


@app.get("/api/admin/media")
def list_media_files(admin: dict = Depends(verify_admin)):
    """List all uploaded media files."""
    files = []
    if os.path.exists(UPLOAD_DIR):
        for filename in os.listdir(UPLOAD_DIR):
            filepath = os.path.join(UPLOAD_DIR, filename)
            if os.path.isfile(filepath):
                stat = os.stat(filepath)
                files.append({
                    "name": filename,
                    "url": f"/uploads/{filename}",
                    "size": stat.st_size,
                    "uploadedAt": datetime.fromtimestamp(stat.st_mtime).isoformat()
                })
    # Sort by upload date descending
    files.sort(key=lambda x: x["uploadedAt"], reverse=True)
    return files


@app.get("/api/admin/products", response_model=list[ProductRead])
def list_all_products(db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """List all products including inactive (admin only)."""
    products = db.query(Product).order_by(Product.sort_order, Product.created_at.desc()).all()
    return products


@app.post("/api/admin/products", response_model=ProductRead, status_code=201)
def create_product(
    product_data: ProductCreate,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Create a new product (admin only)."""
    # Check if slug already exists
    existing = db.query(Product).filter(Product.slug == product_data.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="Product with this slug already exists")
    
    # Convert specs to dict format for JSON storage
    data = product_data.model_dump()
    if data.get('specs'):
        data['specs'] = [spec if isinstance(spec, dict) else spec.model_dump() for spec in product_data.specs]
    
    product = Product(**data)
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def get_product_with_variants(product: Product, db: Session) -> dict:
    """Add variants info to product."""
    result = {
        "id": product.id,
        "name": product.name,
        "slug": product.slug,
        "brand": product.brand,
        "category_id": product.category_id,
        "price": product.price,
        "old_price": product.old_price,
        "badge": product.badge,
        "in_stock": product.in_stock,
        "is_used": product.is_used,
        "is_featured": product.is_featured,
        "variant_group_id": product.variant_group_id,
        "color": product.color,
        "color_code": product.color_code,
        "storage": product.storage,
        "image": product.image,
        "images": product.images,
        "description": product.description,
        "specs": product.specs,
        "sort_order": product.sort_order,
        "is_active": product.is_active,
        "created_at": product.created_at,
        "updated_at": product.updated_at,
        "variants": None
    }
    
    # Get variants if product has variant_group_id
    if product.variant_group_id:
        variants = db.query(Product).filter(
            Product.variant_group_id == product.variant_group_id,
            Product.is_active == True
        ).order_by(Product.price).all()
        
        result["variants"] = [
            {
                "id": v.id,
                "slug": v.slug,
                "color": v.color,
                "color_code": v.color_code,
                "storage": v.storage,
                "price": v.price,
                "in_stock": v.in_stock
            }
            for v in variants
        ]
    
    return result


@app.get("/api/products/{product_id}")
def get_product_public(product_id: int, db: Session = Depends(get_db)):
    """Get single product (public) with variants."""
    product = db.query(Product).filter(Product.id == product_id, Product.is_active == True).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return get_product_with_variants(product, db)


@app.get("/api/products/slug/{slug}")
def get_product_by_slug(slug: str, db: Session = Depends(get_db)):
    """Get single product by slug (public) with variants."""
    product = db.query(Product).filter(Product.slug == slug, Product.is_active == True).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return get_product_with_variants(product, db)


@app.get("/api/admin/products/{product_id}")
def get_product_admin(product_id: int, db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """Get single product (admin only, includes inactive) with variants."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return get_product_with_variants(product, db)


@app.patch("/api/admin/products/{product_id}", response_model=ProductRead)
def update_product(
    product_id: int,
    product_data: ProductUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(verify_admin)
):
    """Update a product (admin only)."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    update_data = product_data.model_dump(exclude_unset=True)
    
    # Convert specs to dict format for JSON storage
    if 'specs' in update_data and update_data['specs']:
        update_data['specs'] = [spec if isinstance(spec, dict) else spec for spec in update_data['specs']]
    
    for key, value in update_data.items():
        setattr(product, key, value)
    
    db.commit()
    db.refresh(product)
    return product


@app.delete("/api/admin/products/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """Delete a product (admin only)."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    db.delete(product)
    db.commit()
    return None


# ============ SEED DATA ENDPOINT ============

@app.post("/api/admin/seed", status_code=201)
def run_seed_database(db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """Seed database with initial categories and products (admin only)."""
    from .seed import seed_database
    result = seed_database(db)
    logger.info(f"Database seeded: {result}")
    return result

