from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import get_db
from .models import Base, Order
from .schemas import OrderCreate, OrderRead
from .settings import settings

app = FastAPI(title="Take Smart API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # frontend dev
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


@app.post("/api/orders", response_model=OrderRead, status_code=201)
def create_order(order_data: OrderCreate, db: Session = Depends(get_db)):
    order = Order(
        name=order_data.name,
        phone=order_data.phone,
        email=order_data.email,
        comment=order_data.comment,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


@app.get("/api/orders", response_model=list[OrderRead])
def list_orders(db: Session = Depends(get_db)):
    orders = db.query(Order).order_by(Order.created_at.desc()).all()
    return orders


@app.delete("/api/orders/{order_id}", status_code=204)
def delete_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    db.delete(order)
    db.commit()
    return None
