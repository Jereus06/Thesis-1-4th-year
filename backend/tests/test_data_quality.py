from datetime import date, timedelta

from app.data_quality import observed_daily_values


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
