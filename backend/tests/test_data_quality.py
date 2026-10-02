from datetime import date, timedelta

import pytest

from app.data_quality import observed_daily_values, prepare_product_series


def test_absent_closure_and_stockout_dates_are_not_zero_targets():
    start = date(2025, 1, 1)
    values = observed_daily_values(
        [{"sale_date": start, "quantity": "4"}],
        start,
        start + timedelta(days=3),
        [
            {"date": "2025-01-02", "classification": "confirmed_zero"},
            {"date": "2025-01-03", "classification": "business_closed"},
            {"date": "2025-01-04", "classification": "full_stockout"},
        ],
    )
    assert values == [(start, 4.0), (start + timedelta(days=1), 0.0)]


def test_sale_wins_over_confirmed_zero_correction():
    day = date(2025, 1, 1)
    assert observed_daily_values(
        [{"sale_date": day, "quantity": 3}],
        day,
        day,
        [{"date": str(day), "classification": "confirmed_zero"}],
    ) == [(day, 3.0)]


@pytest.mark.parametrize(
    "classification", ["business_closed", "full_stockout", "partial_stockout", "incomplete"]
)
def test_reviewed_exclusions_remove_existing_sales_targets(classification):
    day = date(2026, 1, 1)
    prepared = prepare_product_series(
        [{"sale_date": day, "quantity": 4}],
        [
            {"date": str(day), "classification": classification},
            {"date": "2026-01-02", "classification": "confirmed_zero"},
        ],
        "product-1",
        day,
        day + timedelta(days=2),
    )
    assert [(item.day, item.quantity, item.provenance) for item in prepared.targets] == [
        (day + timedelta(days=1), 0.0, "confirmed_zero")
    ]
    assert prepared.excluded_dates == [day]
    assert prepared.unknown_dates == [day + timedelta(days=2)]


def test_product_override_keeps_conflicting_recorded_sales_with_warning():
    day = date(2026, 1, 1)
    prepared = prepare_product_series(
        [{"sale_date": day, "quantity": 3}],
        [
            {"date": str(day), "classification": "business_closed", "productId": None},
            {"date": str(day), "classification": "confirmed_zero", "productId": "product-1"},
            {"date": str(day), "classification": "full_stockout", "productId": "product-2"},
        ],
        "product-1",
        day,
        day,
    )
    assert [(item.quantity, item.provenance) for item in prepared.targets] == [
        (3.0, "recorded_sales")
    ]
    assert [warning.code for warning in prepared.warnings] == ["confirmed_zero_with_sales"]
    assert prepared.excluded_dates == prepared.unknown_dates == []
