"""Historical-sales request capacity without changing import transactions or row validation."""

import pytest
from pydantic import ValidationError

from app.schemas import ImportSaleRow, SalesImportCreate


@pytest.mark.parametrize("count", [1, 73_100, 100_000])
def test_sales_request_accepts_every_row_through_one_hundred_thousand(count):
    request = SalesImportCreate(
        source="csv",
        rows=[
            {
                "sku": "SYNTHETIC-CSV-CAP",
                "saleDate": "2026-01-01",
                "quantity": "1.125",
                "sourceRecordKey": f"synthetic-cap:{index}",
            }
            for index in range(count)
        ],
    )
    assert len(request.rows) == count
    assert request.rows[0].source_record_key == "synthetic-cap:0"
    assert request.rows[-1].source_record_key == f"synthetic-cap:{count - 1}"
    assert str(request.rows[-1].quantity) == "1.125"


@pytest.mark.parametrize("count, error_type", [(0, "too_short"), (100_001, "too_long")])
def test_sales_request_rejects_empty_or_above_one_hundred_thousand(count, error_type):
    row = ImportSaleRow(sku="SYNTHETIC-CSV-CAP", saleDate="2026-01-01", quantity="1")
    with pytest.raises(ValidationError) as error:
        SalesImportCreate(rows=[row] * count)
    details = error.value.errors(include_input=False)
    assert details[0]["loc"] == ("rows",)
    assert details[0]["type"] == error_type
    if count:
        assert details[0]["ctx"]["max_length"] == 100_000


@pytest.mark.parametrize(
    "changes",
    [
        {"quantity": "0"},
        {"quantity": "1.0001"},
        {"saleDate": "2026-02-30"},
        {"sourceRecordKey": "x" * 201},
    ],
)
def test_higher_sales_request_capacity_preserves_existing_row_validation(changes):
    row = {"sku": "SYNTHETIC-CSV-CAP", "saleDate": "2026-01-01", "quantity": "1"}
    with pytest.raises(ValidationError):
        SalesImportCreate(rows=[{**row, **changes}])
