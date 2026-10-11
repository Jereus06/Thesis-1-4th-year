"""Versioned inventory recommendation calculations."""

from decimal import ROUND_CEILING, Decimal


def calculate_reorder(
    *,
    current_stock: Decimal,
    recent_quantity: Decimal,
    lookback_days: int,
    lead_time_days: int,
    safety_stock: Decimal,
    target_cover_days: int,
) -> dict[str, Decimal | str | None]:
    if lookback_days <= 0:
        raise ValueError("lookback_days must be positive")
    if min(current_stock, recent_quantity, safety_stock) < 0:
        raise ValueError("stock, demand, and safety stock cannot be negative")
    daily = recent_quantity / Decimal(lookback_days)
    lead_demand = daily * lead_time_days
    reorder_point = lead_demand + safety_stock
    target = daily * (lead_time_days + target_cover_days) + safety_stock
    should_reorder = current_stock <= reorder_point
    suggested = max(Decimal(0), target - current_stock)
    suggested = (
        suggested.quantize(Decimal("1"), rounding=ROUND_CEILING) if should_reorder else Decimal(0)
    )
    cover = current_stock / daily if daily > 0 else None
    status = (
        "stockout"
        if current_stock == 0
        else "reorder"
        if should_reorder
        else "watch"
        if cover is not None and cover <= lead_time_days + target_cover_days
        else "healthy"
    )
    return {
        "daily_demand": daily,
        "demand_during_lead_time": lead_demand,
        "reorder_point": reorder_point,
        "target_stock": target,
        "suggested_quantity": suggested,
        "days_of_cover": cover,
        "status": status,
    }
