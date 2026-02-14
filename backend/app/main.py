import asyncio
import os
import uuid
from datetime import datetime, timedelta
from fastapi import Depends, FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func

from .db import get_db
from .models import Base, Order, Category, Product
from .schemas import (
    OrderCreate, OrderRead, OrderStatusUpdate,
    CategoryCreate, CategoryRead, CategoryUpdate,
    ProductCreate, ProductRead, ProductUpdate
)
from .settings import settings
from .auth import (
    LoginRequest, TokenResponse, 
    create_access_token, authenticate_admin, verify_admin
)
from .telegram import send_telegram_notification

app = FastAPI(title="Take Smart API")

# Create uploads directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files for uploads
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    from .db import engine
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"ok": True}


# ============ AUTH ENDPOINTS ============

@app.post("/api/auth/login", response_model=TokenResponse)
def login(request: LoginRequest):
    """Admin login endpoint."""
    user = authenticate_admin(request.username, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token(data=user, expires_delta=timedelta(hours=24))
    return TokenResponse(access_token=access_token)


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


@app.post("/api/admin/upload")
async def upload_file(
    file: UploadFile = File(...),
    admin: dict = Depends(verify_admin)
):
    """Upload an image file and return its URL."""
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400, 
            detail="Недопустимый формат файла. Разрешены: JPG, PNG, WebP, GIF"
        )
    
    # Validate file size (max 10MB)
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="Файл слишком большой. Максимум 10MB"
        )
    
    # Generate unique filename
    ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    
    # Save file
    with open(filepath, "wb") as f:
        f.write(contents)
    
    # Return the URL
    return {"url": f"/uploads/{filename}", "filename": filename}


@app.delete("/api/admin/upload/{filename}")
def delete_uploaded_file(
    filename: str,
    admin: dict = Depends(verify_admin)
):
    """Delete an uploaded file."""
    filepath = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
        return {"ok": True}
    raise HTTPException(status_code=404, detail="File not found")


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
def seed_database(db: Session = Depends(get_db), admin: dict = Depends(verify_admin)):
    """Seed database with initial categories and products (admin only)."""
    
    # Default categories
    categories_data = [
        {"slug": "smartphones", "name": "Смартфоны", "description": "iPhone, Samsung, Xiaomi", "icon": "📱", "sort_order": 1},
        {"slug": "laptops", "name": "Ноутбуки", "description": "MacBook, Dell, HP", "icon": "💻", "sort_order": 2},
        {"slug": "tablets", "name": "Планшеты", "description": "iPad, Samsung Tab", "icon": "📱", "sort_order": 3},
        {"slug": "headphones", "name": "Наушники", "description": "AirPods, Sony, JBL", "icon": "🎧", "sort_order": 4},
        {"slug": "watches", "name": "Часы", "description": "Apple Watch, Samsung", "icon": "⌚", "sort_order": 5},
        {"slug": "accessories", "name": "Аксессуары", "description": "Чехлы, зарядки, кабели", "icon": "🔌", "sort_order": 6},
        {"slug": "gaming", "name": "Игровые консоли", "description": "PlayStation, Nintendo", "icon": "🎮", "sort_order": 7},
        {"slug": "tv", "name": "ТВ и аудио", "description": "Samsung, LG, Sony", "icon": "📺", "sort_order": 8},
    ]
    
    created_categories = {}
    for cat_data in categories_data:
        existing = db.query(Category).filter(Category.slug == cat_data["slug"]).first()
        if not existing:
            cat = Category(**cat_data)
            db.add(cat)
            db.commit()
            db.refresh(cat)
            created_categories[cat_data["slug"]] = cat.id
        else:
            created_categories[cat_data["slug"]] = existing.id
    
    # Default products (with variants)
    products_data = [
        # iPhone 15 Pro Max - Natural Titanium variants
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-natural",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 124990,
            "old_price": 139990,
            "badge": "hit",
            "in_stock": True,
            "is_featured": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "натуральный титан",
            "color_code": "#8B8378",
            "storage": "256 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 512 ГБ",
            "slug": "iphone-15-pro-max-512gb-natural",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 144990,
            "old_price": 159990,
            "in_stock": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "натуральный титан",
            "color_code": "#8B8378",
            "storage": "512 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "512 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-blue",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 124990,
            "old_price": 139990,
            "in_stock": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "голубой титан",
            "color_code": "#87CEEB",
            "storage": "256 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-bluetitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 512 ГБ",
            "slug": "iphone-15-pro-max-512gb-blue",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 144990,
            "in_stock": False,  # Out of stock example
            "variant_group_id": "iphone-15-pro-max",
            "color": "голубой титан",
            "color_code": "#87CEEB",
            "storage": "512 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-bluetitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "512 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-white",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 124990,
            "old_price": 139990,
            "in_stock": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "белый титан",
            "color_code": "#F5F5F5",
            "storage": "256 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-whitetitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro Max 256 ГБ",
            "slug": "iphone-15-pro-max-256gb-black",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 124990,
            "old_price": 139990,
            "in_stock": True,
            "variant_group_id": "iphone-15-pro-max",
            "color": "чёрный титан",
            "color_code": "#1C1C1E",
            "storage": "256 ГБ",
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-pro-finish-select-202309-6-7inch-blacktitanium?wid=400"
            ],
            "description": "Флагманский смартфон Apple с титановым корпусом, чипом A17 Pro и продвинутой камерой.",
            "specs": [
                {"label": "Дисплей", "value": "6.7\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "48 Мп + 12 Мп + 12 Мп"},
            ],
            "sort_order": 1
        },
        {
            "name": "iPhone 15 Pro 128 ГБ",
            "slug": "iphone-15-pro-128gb",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 109990,
            "badge": "new",
            "in_stock": True,
            "image": "📱",
            "description": "Компактный флагман с титановым дизайном и Action Button.",
            "specs": [
                {"label": "Дисплей", "value": "6.1\" Super Retina XDR"},
                {"label": "Процессор", "value": "Apple A17 Pro"},
                {"label": "Память", "value": "128 ГБ"},
            ],
            "sort_order": 2
        },
        {
            "name": "Samsung Galaxy S24 Ultra",
            "slug": "samsung-galaxy-s24-ultra",
            "brand": "Samsung",
            "category_id": created_categories.get("smartphones"),
            "price": 109990,
            "in_stock": True,
            "image": "📱",
            "description": "Флагман Samsung с Galaxy AI, S Pen и революционной камерой 200 Мп.",
            "specs": [
                {"label": "Дисплей", "value": "6.8\" Dynamic AMOLED 2X"},
                {"label": "Процессор", "value": "Snapdragon 8 Gen 3"},
                {"label": "Память", "value": "256 ГБ"},
            ],
            "sort_order": 3
        },
        {
            "name": "MacBook Pro 14\" M3 Pro",
            "slug": "macbook-pro-14-m3-pro",
            "brand": "Apple",
            "category_id": created_categories.get("laptops"),
            "price": 249990,
            "badge": "new",
            "in_stock": True,
            "image": "💻",
            "description": "Профессиональный ноутбук с чипом M3 Pro и дисплеем Liquid Retina XDR.",
            "specs": [
                {"label": "Дисплей", "value": "14\" Liquid Retina XDR"},
                {"label": "Процессор", "value": "Apple M3 Pro"},
                {"label": "Память", "value": "512 ГБ SSD"},
            ],
            "sort_order": 4
        },
        {
            "name": "PlayStation 5",
            "slug": "playstation-5",
            "brand": "Sony",
            "category_id": created_categories.get("gaming"),
            "price": 54990,
            "badge": "hit",
            "in_stock": True,
            "image": "🎮",
            "description": "Консоль нового поколения от Sony с поддержкой 4K и молниеносным SSD.",
            "specs": [
                {"label": "SSD", "value": "825 ГБ"},
                {"label": "Разрешение", "value": "4K 120fps"},
            ],
            "sort_order": 5
        },
        {
            "name": "AirPods Pro 2",
            "slug": "airpods-pro-2",
            "brand": "Apple",
            "category_id": created_categories.get("headphones"),
            "price": 24990,
            "in_stock": True,
            "image": "🎧",
            "description": "TWS-наушники Apple с адаптивным шумоподавлением и пространственным звуком.",
            "specs": [
                {"label": "Тип", "value": "TWS"},
                {"label": "Шумоподавление", "value": "Адаптивное ANC"},
                {"label": "Время работы", "value": "6 ч"},
            ],
            "sort_order": 6
        },
        {
            "name": "Apple Watch Series 9",
            "slug": "apple-watch-series-9",
            "brand": "Apple",
            "category_id": created_categories.get("watches"),
            "price": 44990,
            "in_stock": True,
            "image": "⌚",
            "description": "Умные часы Apple с жестовым управлением и новым чипом S9.",
            "specs": [
                {"label": "Дисплей", "value": "Always-On Retina"},
                {"label": "Процессор", "value": "Apple S9"},
            ],
            "sort_order": 7
        },
        {
            "name": "iPad Pro 12.9\" M2",
            "slug": "ipad-pro-129-m2",
            "brand": "Apple", 
            "category_id": created_categories.get("tablets"),
            "price": 129990,
            "in_stock": True,
            "image": "📱",
            "description": "Профессиональный планшет с дисплеем Liquid Retina XDR и чипом M2.",
            "specs": [
                {"label": "Дисплей", "value": "12.9\" Liquid Retina XDR"},
                {"label": "Процессор", "value": "Apple M2"},
                {"label": "Память", "value": "256 ГБ"},
            ],
            "sort_order": 8
        },
        # Б/У товары  
        {
            "name": "iPhone 13 Pro 128 ГБ (Б/У)",
            "slug": "iphone-13-pro-128gb-bu",
            "brand": "Apple",
            "category_id": created_categories.get("smartphones"),
            "price": 54990,
            "old_price": 84990,
            "badge": "sale",
            "in_stock": True,
            "is_used": True,
            "image": "📱",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-13-pro-graphite-select?wid=400"
            ],
            "description": "iPhone 13 Pro в отличном состоянии. Батарея 92%, без царапин.",
            "specs": [
                {"label": "Состояние", "value": "Отличное (9/10)"},
                {"label": "Батарея", "value": "92%"},
                {"label": "Память", "value": "128 ГБ"},
                {"label": "Гарантия", "value": "6 месяцев"},
            ],
            "sort_order": 100
        },
        {
            "name": "MacBook Air M1 2020 (Б/У)",
            "slug": "macbook-air-m1-2020-bu",
            "brand": "Apple",
            "category_id": created_categories.get("laptops"),
            "price": 64990,
            "old_price": 99990,
            "badge": "sale",
            "in_stock": True,
            "is_used": True,
            "image": "💻",
            "images": [
                "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/macbook-air-space-gray-select-201810?wid=400"
            ],
            "description": "MacBook Air в идеальном состоянии. Цикл зарядки 87, как новый.",
            "specs": [
                {"label": "Состояние", "value": "Идеальное (10/10)"},
                {"label": "Циклы батареи", "value": "87"},
                {"label": "Память", "value": "256 ГБ SSD"},
                {"label": "Гарантия", "value": "12 месяцев"},
            ],
            "sort_order": 101
        },
        {
            "name": "Samsung Galaxy S23 Ultra (Б/У)",
            "slug": "samsung-galaxy-s23-ultra-bu",
            "brand": "Samsung",
            "category_id": created_categories.get("smartphones"),
            "price": 69990,
            "old_price": 109990,
            "in_stock": True,
            "is_used": True,
            "image": "📱",
            "description": "Galaxy S23 Ultra с S Pen, небольшие следы использования.",
            "specs": [
                {"label": "Состояние", "value": "Хорошее (8/10)"},
                {"label": "Память", "value": "256 ГБ"},
                {"label": "Камера", "value": "200 Мп"},
                {"label": "Гарантия", "value": "3 месяца"},
            ],
            "sort_order": 102
        },
        {
            "name": "AirPods Pro (Б/У)",
            "slug": "airpods-pro-bu",
            "brand": "Apple",
            "category_id": created_categories.get("headphones"),
            "price": 12990,
            "old_price": 24990,
            "badge": "sale",
            "in_stock": True,
            "is_used": True,
            "image": "🎧",
            "description": "AirPods Pro 1-го поколения. Заменены амбушюры, работают идеально.",
            "specs": [
                {"label": "Состояние", "value": "Хорошее (8/10)"},
                {"label": "Батарея", "value": "85%"},
                {"label": "Гарантия", "value": "3 месяца"},
            ],
            "sort_order": 103
        },
    ]
    
    created_products = 0
    for prod_data in products_data:
        existing = db.query(Product).filter(Product.slug == prod_data["slug"]).first()
        if not existing:
            product = Product(**prod_data)
            db.add(product)
            created_products += 1
    
    db.commit()
    
    return {
        "message": "Database seeded successfully",
        "categories_count": len(created_categories),
        "products_created": created_products
    }
