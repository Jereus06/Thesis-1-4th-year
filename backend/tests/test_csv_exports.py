"""CSV export identity regressions using isolated synthetic PostgreSQL records."""

import csv
import io
from decimal import Decimal

import pytest

from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


def exported_rows(response):
    assert response.status_code == 200, response.text
    return list(csv.DictReader(io.StringIO(response.text)))


def test_sales_csv_preserves_stored_keys_without_inventing_unkeyed_identities(pg_client):
    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    historical = [
        {"sku": "TEST-1", "saleDate": "2026-01-01", "quantity": "2",
         "sourceRecordKey": "verified-pos:line-1"},
        {"sku": "TEST-1", "saleDate": "2026-01-02", "quantity": "3"},
    ]
    imported = client.post(base + "/data-imports", json={"rows": historical})
    assert imported.status_code == 201, imported.text
    live = client.post(base + "/sales", json={
        "productId": product["id"], "saleDate": "2026-01-03", "quantity": "1",
    })
    assert live.status_code == 201, live.text

    response = client.get(base + "/exports/sales.csv")
    rows = exported_rows(response)
    assert list(rows[0]) == [
        "id", "sku", "sale_date", "quantity", "source", "data_origin", "source_record_key",
    ]
    assert [row["source_record_key"] for row in rows] == ["verified-pos:line-1", "", ""]
    assert len({row["id"] for row in rows}) == 3
    assert client.get(base + "/exports/sales.csv").text == response.text

    # A different source/batch still recognizes the exported real key as the saved sale.
    first = rows[0]
    retry = client.post(base + "/data-imports", json={"source": "pos_export", "rows": [{
        "sku": first["sku"], "saleDate": first["sale_date"], "quantity": first["quantity"],
        "sourceRecordKey": first["source_record_key"],
    }]})
    assert retry.status_code == 201, retry.text
    assert retry.json()["data"]["acceptedRows"] == 0
    assert retry.json()["data"]["errors"] == [{"row": 1, "code": "duplicate_source_record_key"}]
    assert len(client.get(base + "/sales").json()["data"]) == 3


@pytest.mark.parametrize("text", [
    '=HYPERLINK("synthetic-only")', "+1+1", "-1+1", "@SUM(1,2)",
    "  =1+1", "\t@SUM(1,2)", "\r\n=1+1", "\x01=1+1",
    "＝1+1", "＋1+1", "－1+1", "＠SUM(1,2)",
])
def test_csv_response_quotes_and_neutralizes_formula_looking_text(text):
    from app.main import csv_response

    response = csv_response("synthetic.csv", ["text", "amount", "empty"], [
        {"text": text, "amount": Decimal("-2.500"), "empty": None},
    ])
    raw = response.body.decode()
    assert raw.startswith('"text","amount","empty"\n')
    values = list(csv.reader(io.StringIO(raw)))[1]
    assert values == ["\t" + text, "-2.500", ""]
    assert '"-2.500"' in raw


@pytest.mark.parametrize("text", ["ordinary text", "'=1+1", "'@SUM(1,2)", "", "words, \"quotes\"\nand lines"])
def test_csv_response_preserves_nonformula_text_including_literal_apostrophes(text):
    from app.main import csv_response

    response = csv_response("synthetic.csv", ["text"], [{"text": text}])
    assert list(csv.reader(io.StringIO(response.body.decode())))[1] == [text]


def test_formula_looking_sales_identifiers_export_and_reimport_without_new_sales(pg_client):
    client, business, _dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    sku = "=SYNTHETIC-SKU"
    key = "+synthetic-pos:line-1"
    created = client.post(base + "/products", json={
        "sku": sku, "name": "Synthetic formula-shaped SKU", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
    })
    assert created.status_code == 201, created.text
    original = client.post(base + "/data-imports", json={"rows": [{
        "sku": sku, "saleDate": "2026-01-01", "quantity": "2", "sourceRecordKey": key,
    }]})
    assert original.status_code == 201, original.text
    row = exported_rows(client.get(base + "/exports/sales.csv"))[0]
    assert row["sku"] == "\t" + sku
    assert row["source_record_key"] == "\t" + key
    retry = client.post(base + "/data-imports", json={"source": "pos_export", "rows": [{
        "sku": row["sku"], "saleDate": row["sale_date"], "quantity": row["quantity"],
        "sourceRecordKey": row["source_record_key"],
    }]})
    assert retry.status_code == 201, retry.text
    assert retry.json()["data"]["acceptedRows"] == 0
    assert retry.json()["data"]["errors"] == [{"row": 1, "code": "duplicate_source_record_key"}]
    assert len(client.get(base + "/sales").json()["data"]) == 1
    assert client.get(base + "/products").json()["data"][0]["sku"] == sku


def test_movement_and_data_quality_exports_protect_text_without_altering_stored_values(pg_client):
    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    note = '@SUM(1,2), "synthetic"\nsecond line'
    movement = client.post(base + "/inventory-movements", json={
        "productId": product["id"], "movementDate": "2026-01-01",
        "movementType": "write_off", "quantityDelta": "-2", "note": note,
    })
    assert movement.status_code == 201, movement.text
    movements = exported_rows(client.get(base + "/exports/inventory-movements.csv"))
    exported = next(row for row in movements if row["note"] == "\t" + note)
    assert Decimal(exported["quantity_delta"]) == -2
    assert next(row for row in client.get(base + "/inventory-movements").json()["data"]
                if row["id"] == exported["id"])["note"] == note

    quality = client.put(base + "/data-quality", json={
        "productId": product["id"], "classificationDate": "2026-01-01",
        "classification": "confirmed_zero", "note": note,
    })
    assert quality.status_code == 200, quality.text
    assert quality.json()["data"]["note"] == note
    audit = exported_rows(client.get(base + "/exports/data-quality.csv"))
    assert audit[0]["note"] == "\t" + note
