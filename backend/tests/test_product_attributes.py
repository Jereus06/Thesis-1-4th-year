"""Product attributes work on fresh schemas and upgrades without losing stock."""

import psycopg
import pytest
from psycopg.rows import dict_row

from app.migrate import MIGRATION_DIR, migrate, migration_body
from test_postgres_integration import create_product, fresh_auth_limiter, pg_client  # noqa: F401


MIGRATION = "012_product_attributes.up.sql"


def test_product_attribute_upgrade_preserves_existing_records_and_reapplies_safely(pg_client):
    client, business, dsn = pg_client
    product = create_product(client, business)
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        before = conn.execute(
            "SELECT id,sku,current_stock,created_at,updated_at FROM products WHERE id=%s",
            (product["id"],),
        ).fetchone()
        movements = conn.execute("SELECT * FROM inventory_movements ORDER BY id").fetchall()
        # Recreate an existing installation at migration 011, retaining its business records.
        conn.execute(migration_body(
            (MIGRATION_DIR / "012_product_attributes.down.sql").read_text(encoding="utf-8")
        ))
        conn.execute("DELETE FROM schema_migrations WHERE filename=%s", (MIGRATION,))

    assert migrate() == [MIGRATION]
    assert migrate() == []
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        assert conn.execute(
            "SELECT id,sku,current_stock,created_at,updated_at FROM products WHERE id=%s",
            (product["id"],),
        ).fetchone() == before
        assert conn.execute("SELECT * FROM inventory_movements ORDER BY id").fetchall() == movements
        assert conn.execute(
            "SELECT brand,model,variant FROM products WHERE id=%s", (product["id"],)
        ).fetchone() == {"brand": "", "model": "", "variant": ""}
    saved = client.get(f"/api/v1/businesses/{business}/products/{product['id']}")
    assert saved.status_code == 200, saved.text
    assert all(saved.json()["data"][field] == "" for field in ("brand", "model", "variant"))


def test_product_attributes_persist_and_remain_optional_in_inventory_imports(pg_client):
    client, business, dsn = pg_client
    base = f"/api/v1/businesses/{business}"
    details = {"brand": "Synthetic brand", "model": "Synthetic model", "variant": "Small"}
    response = client.post(base + "/products", json={
        "sku": "ATTR-1", "name": "Synthetic product", "category": "Test", "unit": "pc",
        "currentStock": "20", "leadTimeDays": 2, "safetyStock": "2", "unitCost": "10",
        **details,
    })
    assert response.status_code == 201, response.text
    product = response.json()["data"]
    assert {field: product[field] for field in details} == details
    changed = {"brand": "Updated brand", "model": "Updated model", "variant": "Large"}
    response = client.patch(base + f"/products/{product['id']}", json=changed)
    assert response.status_code == 200, response.text

    response = client.post(base + "/inventory-imports", json={"rows": [
        {"sku": "ATTR-1", "currentStock": "12"},
        {"sku": "ATTR-2", "name": "Legacy format", "category": "Test", "unit": "pc",
         "currentStock": "5", "leadTimeDays": 1, "safetyStock": "0", "unitCost": "2"},
        {"sku": "ATTR-3", "name": "With attributes", "category": "Test", "unit": "pc",
         "currentStock": "3", "leadTimeDays": 1, "safetyStock": "0", "unitCost": "2",
         **details},
    ]})
    assert response.status_code == 201, response.text
    assert response.json()["data"] == {"created": 2, "updated": 1}
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        rows = {row["sku"]: row for row in conn.execute(
            "SELECT sku,brand,model,variant,current_stock FROM products WHERE business_id=%s",
            (business,),
        ).fetchall()}
    for sku, expected in (
        ("ATTR-1", changed), ("ATTR-2", {field: "" for field in details}), ("ATTR-3", details),
    ):
        assert {field: rows[sku][field] for field in details} == expected
    assert rows["ATTR-1"]["current_stock"] == 12


@pytest.mark.parametrize("column_type", ["text", "varchar"])
def test_published_attribute_migration_accepts_existing_schema_without_rewriting_it(pg_client, column_type):
    client, business, dsn = pg_client
    product = create_product(client, business)
    with psycopg.connect(dsn) as conn:
        if column_type == "varchar":
            conn.execute("ALTER TABLE products ALTER COLUMN brand TYPE varchar(100), ALTER COLUMN model TYPE varchar(150), ALTER COLUMN variant TYPE varchar(150)")
        conn.execute("UPDATE products SET brand='Saved brand',model='Saved model',variant='Saved variant',selling_price=12.3456 WHERE id=%s", (product["id"],))
        before = conn.execute("SELECT * FROM products WHERE id=%s", (product["id"],)).fetchone()
        conn.execute("DELETE FROM schema_migrations WHERE filename=%s", (MIGRATION,))
    assert migrate() == [MIGRATION]
    assert migrate() == []
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT * FROM products WHERE id=%s", (product["id"],)).fetchone() == before


def test_incomplete_attribute_baseline_is_not_silently_adopted(pg_client):
    _client, _business, dsn = pg_client
    with psycopg.connect(dsn) as conn:
        conn.execute("ALTER TABLE products DROP COLUMN variant")
        conn.execute("DELETE FROM schema_migrations WHERE filename=%s", (MIGRATION,))
    with pytest.raises(psycopg.errors.DuplicateColumn):
        migrate()
    with psycopg.connect(dsn) as conn:
        assert conn.execute("SELECT filename FROM schema_migrations WHERE filename=%s", (MIGRATION,)).fetchone() is None


def test_attribute_baseline_requires_exact_published_checksum():
    from app.migrate import ATTRIBUTE_BASELINE, existing_attribute_baseline
    # A changed migration must never skip new SQL based on an older schema.
    assert existing_attribute_baseline(None, ATTRIBUTE_BASELINE[0], "changed") is False
    assert existing_attribute_baseline(None, "another_migration.up.sql", ATTRIBUTE_BASELINE[1]) is False
