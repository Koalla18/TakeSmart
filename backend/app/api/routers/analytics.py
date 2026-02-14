from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session
from ...models import Order

router = APIRouter(prefix="/api", tags=["analytics"])


@router.get("/analytics", summary="Analytics overview (admin)")
async def get_analytics(
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total_orders = (await db.execute(select(func.count(Order.id)))).scalar() or 0

    today_orders = (
        await db.execute(select(func.count(Order.id)).where(Order.created_at >= today_start))
    ).scalar() or 0

    week_orders = (await db.execute(select(func.count(Order.id)).where(Order.created_at >= week_ago))).scalar() or 0

    month_orders = (
        await db.execute(select(func.count(Order.id)).where(Order.created_at >= month_ago))
    ).scalar() or 0

    status_counts = {}
    for status in ["new", "processing", "ready", "completed", "cancelled"]:
        status_counts[status] = (
            await db.execute(select(func.count(Order.id)).where(Order.status == status))
        ).scalar() or 0

    active_statuses = ["new", "processing", "ready", "completed"]
    total_revenue = (
        await db.execute(select(func.sum(Order.total_amount)).where(Order.status.in_(active_statuses)))
    ).scalar() or 0

    today_revenue = (
        await db.execute(
            select(func.sum(Order.total_amount)).where(
                Order.created_at >= today_start, Order.status.in_(active_statuses)
            )
        )
    ).scalar() or 0

    week_revenue = (
        await db.execute(
            select(func.sum(Order.total_amount)).where(
                Order.created_at >= week_ago, Order.status.in_(active_statuses)
            )
        )
    ).scalar() or 0

    payment_stats = {}
    for method in ["cash", "card", "online"]:
        payment_stats[method] = (
            await db.execute(select(func.count(Order.id)).where(Order.payment_method == method))
        ).scalar() or 0

    delivery_stats = {}
    for method in ["pickup", "courier", "post"]:
        delivery_stats[method] = (
            await db.execute(select(func.count(Order.id)).where(Order.delivery_method == method))
        ).scalar() or 0

    daily_orders = []
    for i in range(14):
        day = now - timedelta(days=i)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        count = (
            await db.execute(
                select(func.count(Order.id)).where(
                    Order.created_at >= day_start, Order.created_at < day_end
                )
            )
        ).scalar() or 0
        revenue = (
            await db.execute(
                select(func.sum(Order.total_amount)).where(
                    Order.created_at >= day_start,
                    Order.created_at < day_end,
                    Order.status.in_(active_statuses),
                )
            )
        ).scalar() or 0
        daily_orders.append(
            {
                "date": day_start.strftime("%d.%m"),
                "day": day_start.strftime("%a"),
                "count": count,
                "revenue": revenue,
            }
        )

    avg_order_value = 0
    if total_orders > 0:
        avg_result = (
            await db.execute(select(func.avg(Order.total_amount)).where(Order.total_amount.isnot(None)))
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
        "daily_orders": list(reversed(daily_orders)),
    }

