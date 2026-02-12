import asyncio
from datetime import datetime, timedelta
from fastapi import Depends, FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func

from .db import get_db
from .models import Base, Order
from .schemas import OrderCreate, OrderRead, OrderStatusUpdate
from .settings import settings
from .auth import (
    LoginRequest, TokenResponse, 
    create_access_token, authenticate_admin, verify_admin
)
from .telegram import send_telegram_notification

app = FastAPI(title="Take Smart API")

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
