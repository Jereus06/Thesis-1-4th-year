from decimal import Decimal

from app.inventory import calculate_reorder


def test_quantity_is_zero_until_reorder_trigger_is_reached():
    result = calculate_reorder(
        current_stock=Decimal("20"),
        recent_quantity=Decimal("28"),
        lookback_days=28,
        lead_time_days=3,
        safety_stock=Decimal("2"),
        target_cover_days=7,
    )
    assert result["reorder_point"] == Decimal("5")
    assert result["suggested_quantity"] == 0
    assert result["status"] == "healthy"


def test_reorder_quantity_rounds_up_to_whole_stock_units():
    result = calculate_reorder(
        current_stock=Decimal("2.5"),
        recent_quantity=Decimal("35"),
        lookback_days=28,
        lead_time_days=2,
        safety_stock=Decimal("1"),
        target_cover_days=5,
    )
    assert result["status"] == "reorder"
    assert result["suggested_quantity"] == Decimal("8")
