"""Synthetic price history, imports, permissions, and durable storage regressions."""
import csv
import io
import json
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest
from pydantic import ValidationError

from app.schemas import ImportSaleRow
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


def saved(response, status=201):
    assert response.status_code == status, response.text
    return response.json()["data"]


@pytest.mark.parametrize("fields", [
    {"sellingPrice": "-1"}, {"sellingPrice": "1.00001"},
    {"sellingPrice": "NaN"}, {"salesAmount": "10"},
    {"sellingPrice": "2", "salesAmount": "5"},
])
def test_historical_price_validation(fields):
    with pytest.raises(ValidationError):
        ImportSaleRow(sku="SYNTHETIC", saleDate="2026-01-01", quantity="2", **fields)


def test_missing_zero_and_fractional_prices_are_distinct():
    base = dict(sku="SYNTHETIC", saleDate="2026-01-01", quantity="0.125")
    assert ImportSaleRow(**base).sales_amount is None
    assert ImportSaleRow(**base, sellingPrice="0").sales_amount == 0
    assert ImportSaleRow(**base, sellingPrice="12.3456").sales_amount == Decimal("1.5432")


@pytest.mark.parametrize("existing_catalog", [False, True])
def test_price_migration_leaves_existing_sales_unknown(pg_client, existing_catalog):
    client, business, dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    sale = saved(client.post(base + "/sales", json={"productId": product["id"], "saleDate": "2026-01-01", "quantity": "2"}))
    from app.migrate import migration_body
    migrations = Path(__file__).parents[1] / "db" / "migrations"
    with psycopg.connect(dsn) as conn:
        # Only this fixture's disposable schema is reverted to the pre-price shape.
        conn.execute(migration_body((migrations / "012_selling_prices.down.sql").read_text()))
        conn.execute("ALTER TABLE products DROP COLUMN brand, DROP COLUMN model, DROP COLUMN variant, DROP COLUMN selling_price")
        if existing_catalog:
            # Match the earlier deployed catalog extensions, absent from this checkout.
            conn.execute("ALTER TABLE products ADD COLUMN brand text NOT NULL DEFAULT '', ADD COLUMN model text NOT NULL DEFAULT '', ADD COLUMN variant text NOT NULL DEFAULT '', ADD COLUMN selling_price numeric(18,4) NOT NULL DEFAULT 0 CHECK (selling_price >= 0)")
            conn.execute("UPDATE products SET brand='Synthetic',model='M1',variant='USB-C',selling_price=12.3456 WHERE id=%s", (product["id"],))
        before = conn.execute("SELECT count(*),sum(quantity) FROM sales").fetchone()
        conn.execute(migration_body((migrations / "012_selling_prices.up.sql").read_text()))
        assert conn.execute("SELECT count(*),sum(quantity) FROM sales").fetchone() == before
        assert conn.execute("SELECT selling_price,sales_amount FROM sales WHERE id=%s", (sale["id"],)).fetchone() == (None, None)
        assert conn.execute("SELECT selling_price,current_stock FROM products WHERE id=%s", (product["id"],)).fetchone() == (Decimal("12.3456") if existing_catalog else None, Decimal("18"))
        if existing_catalog:
            assert conn.execute("SELECT brand,model,variant FROM products WHERE id=%s", (product["id"],)).fetchone() == ("Synthetic", "M1", "USB-C")
        assert conn.execute("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='selling_price'").fetchone() == ("YES", None)
        conn.execute("UPDATE products SET selling_price=NULL WHERE id=%s", (product["id"],))


def test_full_database_decimal_precision_is_not_rounded_by_python_context():
    row = ImportSaleRow(sku="SYNTHETIC", saleDate="2026-01-01", quantity="999999999999999.999", sellingPrice="99999999999999.9999")
    assert row.sales_amount == Decimal("99999999999999999800000000000.0000001")


def test_price_history_defaults_overrides_unknown_void_and_new_process(pg_client):
    client, business, dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    path = base + f"/products/{product['id']}"
    saved(client.patch(path, json={"sellingPrice": "12.3456", "brand": "Synthetic", "model": "M1", "variant": "USB-C 2m"}), 200)
    data = {"productId": product["id"], "saleDate": "2026-01-02", "quantity": "0.125"}
    original = saved(client.post(base + "/sales", json=data, headers={"Idempotency-Key": "priced-sale"}))
    assert Decimal(original["salesAmount"]) == Decimal("1.5432")
    assert client.post(base + "/sales", json={**data, "sellingPrice": None}, headers={"Idempotency-Key": "priced-sale"}).status_code == 409
    saved(client.patch(path, json={"sellingPrice": "90", "unitCost": "1"}), 200)
    assert saved(client.post(base + "/sales", json=data, headers={"Idempotency-Key": "priced-sale"})) == original
    discounted = saved(client.post(base + "/sales", json={**data, "sellingPrice": "8.2"}))
    assert Decimal(discounted["salesAmount"]) == Decimal("1.025")
    unknown = saved(client.post(base + "/sales", json={**data, "sellingPrice": None}))
    assert unknown["salesAmount"] is None
    zero = saved(client.post(base + "/sales", json={**data, "sellingPrice": "0"}))
    assert Decimal(zero["salesAmount"]) == 0
    # A fresh interpreter and connection must read stored values without API memory.
    code = "import json,sys,psycopg; sys.path.insert(0,'backend'); from app.repository import Repository; c=psycopg.connect(sys.argv[1]); print(json.dumps(Repository(c).list_sales(sys.argv[2],100,0)))"
    rows = json.loads(subprocess.check_output([sys.executable, "-c", code, dsn, business], text=True))
    assert next(row for row in rows if row["id"] == original["id"])["salesAmount"] == "1.5432000"
    before_stock = Decimal(saved(client.get(base + "/products"), 200)[0]["currentStock"])
    saved(client.delete(base + f"/sales/{original['id']}"), 200)
    assert Decimal(saved(client.get(base + "/products"), 200)[0]["currentStock"]) == before_stock + Decimal("0.125")
    assert original["id"] not in {row["id"] for row in saved(client.get(base + "/sales"), 200)}
    assert original["id"] not in client.get(base + "/exports/sales.csv").text
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT selling_price,sales_amount,voided_at IS NOT NULL FROM sales WHERE id=%s", (original["id"],)).fetchone() == (Decimal("12.3456"), Decimal("1.5432000"), True)
    saved(client.patch(path, json={"sellingPrice": None}), 200)
    assert saved(client.post(base + "/sales", json=data))["salesAmount"] is None


def test_import_export_price_roundtrip_inactive_stock_and_identity(pg_client):
    client, business, _dsn = pg_client
    product = create_product(client, business)
    base = f"/api/v1/businesses/{business}"
    saved(client.patch(base + f"/products/{product['id']}", json={"sellingPrice": "999", "isActive": False}), 200)
    rows = [
        {"sku": product["sku"], "saleDate": "2026-01-01", "quantity": "2.125", "sellingPrice": "3.4567", "salesAmount": "7.3454875", "sourceRecordKey": "verified-line"},
        {"sku": product["sku"], "saleDate": "2026-01-02", "quantity": "3", "sourceRecordKey": "unpriced-line"},
    ]
    assert saved(client.post(base + "/data-imports", json={"rows": rows}))["acceptedRows"] == 2
    catalog = saved(client.get(base + "/products"), 200)[0]
    assert catalog["isActive"] is False and Decimal(catalog["currentStock"]) == 20
    assert client.post(base + "/sales", json={"productId": product["id"], "saleDate": "2026-01-02", "quantity": "1"}).status_code == 404
    exported = list(csv.DictReader(io.StringIO(client.get(base + "/exports/sales.csv").text)))
    assert Decimal(exported[0]["sales_amount"]) == Decimal("7.3454875")
    assert exported[1]["selling_price"] == exported[1]["sales_amount"] == ""
    imported = [{"sku": row["sku"], "saleDate": row["sale_date"], "quantity": row["quantity"], "sellingPrice": row["selling_price"] or None, "salesAmount": row["sales_amount"] or None, "sourceRecordKey": row["source_record_key"]} for row in exported]
    retry = saved(client.post(base + "/data-imports", json={"source": "pos_export", "rows": imported}))
    assert retry["acceptedRows"] == 0
    assert all(error["code"] == "duplicate_source_record_key" for error in retry["errors"])
    conflict = saved(client.post(base + "/data-imports", json={"rows": [{**rows[0], "sellingPrice": "4", "salesAmount": "8.5"}]}))
    assert conflict["errors"][0]["code"] == "source_record_key_conflict"
    assert len(saved(client.get(base + "/sales"), 200)) == 2


def test_product_import_attributes_prices_and_staff_boundaries(pg_client):
    client, business, dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    details = {"sku": "SYNTHETIC-CABLE", "name": "Synthetic cable", "category": "Cable", "unit": "pc", "currentStock": "10", "leadTimeDays": 0, "safetyStock": "0", "unitCost": "3.1234", "sellingPrice": "6.7891", "brand": "Synthetic", "model": "M2", "variant": "USB-C 1m"}
    assert saved(client.post(base + "/inventory-imports", json={"rows": [details]}))["created"] == 1
    product = saved(client.get(base + "/products"), 200)[0]
    assert product["variant"] == "USB-C 1m" and Decimal(product["sellingPrice"]) == Decimal("6.7891")
    saved(client.post(base + "/inventory-imports", json={"rows": [{"sku": details["sku"], "currentStock": "9"}]}))
    assert saved(client.get(base + "/products"), 200)[0]["sellingPrice"] == product["sellingPrice"]
    with psycopg.connect(dsn) as conn:
        conn.execute("UPDATE users SET role='staff' WHERE business_id=%s", (business,))
    sale = {"productId": product["id"], "saleDate": "2026-01-02", "quantity": "1", "sellingPrice": "5.5"}
    assert client.patch(base + f"/products/{product['id']}", json={"sellingPrice": "1"}).status_code == 403
    assert client.post(base + "/inventory-imports", json={"rows": [details]}).status_code == 403
    assert client.post(base + "/data-imports", json={"rows": [{"sku": details["sku"], "saleDate": "2026-01-02", "quantity": "1"}]}).status_code == 403
    assert client.post(base + "/sales", json=sale, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    created = saved(client.post(base + "/sales", json=sale))
    assert Decimal(created["salesAmount"]) == Decimal("5.5")
    assert client.delete(base + f"/sales/{created['id']}").status_code == 403
    assert client.get(base.replace(business, "00000000-0000-4000-8000-000000000099") + "/exports/sales.csv").status_code == 403
