from datetime import date

from app.data_quality import POLICY_VERSION, contiguous_tail, prepare_product_series


def prepare(rows=(), quality=(), product="p1"):
    return prepare_product_series(rows, quality, product, date(2025, 1, 1), date(2025, 1, 4))


def test_exclusion_classification_removes_recorded_sales_without_changing_input():
    sales = [{"sale_date": "2025-01-01", "quantity": 4}]
    result = prepare(
        sales, [{"date": "2025-01-01", "classification": "full_stockout", "productId": "p1"}]
    )
    assert not result.days
    assert result.excluded_dates == (date(2025, 1, 1),)
    assert result.warnings[0].code == "sale_on_excluded_date"
    assert sales[0]["quantity"] == 4


def test_product_classification_overrides_store_wide_classification():
    result = prepare(
        [],
        [
            {"date": "2025-01-02", "classification": "business_closed", "productId": None},
            {"date": "2025-01-02", "classification": "confirmed_zero", "productId": "p1"},
        ],
    )
    assert [(item.day, item.quantity) for item in result.days] == [(date(2025, 1, 2), 0)]
    assert date(2025, 1, 2) not in result.excluded_dates


def test_confirmed_zero_never_silently_replaces_positive_sales():
    result = prepare(
        [{"sale_date": "2025-01-03", "quantity": 7}],
        [{"date": "2025-01-03", "classification": "confirmed_zero", "productId": "p1"}],
    )
    assert result.days[0].quantity == 7
    assert result.warnings[0].code == "confirmed_zero_with_sales"


def test_unclassified_gap_stays_unknown_and_breaks_calendar_tail():
    result = prepare(
        [
            {"sale_date": "2025-01-01", "quantity": 1},
            {"sale_date": "2025-01-03", "quantity": 2},
        ]
    )
    assert date(2025, 1, 2) in result.unknown_dates
    assert contiguous_tail(result, 2) == ()
    assert result.policy_version == POLICY_VERSION


def test_public_preparation_contract_exports_snapshot_and_contiguous_tail():
    from app.data_quality import POLICY_VERSION, contiguous_tail, prepare_product_series

    result = prepare_product_series(
        [{"date": "2025-01-01", "quantity": "2"}],
        [
            {"date": "2025-01-02", "classification": "confirmed_zero", "productId": None},
            {"date": "2025-01-03", "classification": "incomplete", "productId": None},
        ],
        "sku-1",
        date(2025, 1, 1),
        date(2025, 1, 3),
    )
    snapshot = result.snapshot()
    assert POLICY_VERSION == snapshot["policyVersion"]
    assert snapshot["targets"] == [
        {"day": "2025-01-01", "quantity": 2.0, "provenance": "recorded_sales"},
        {"day": "2025-01-02", "quantity": 0.0, "provenance": "confirmed_zero"},
    ]
    assert snapshot["excludedDates"] == ["2025-01-03"]
    assert contiguous_tail(result, 2) == result.days
