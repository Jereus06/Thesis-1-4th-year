"""Run setup, restart the disposable PostgreSQL container, then run verify.

Requires STOCKCAST_TEST_DATABASE_URL pointing to the dedicated price_tests database.
Uses only its price_restart_check schema. No production configuration is read.
"""
import os
import sys
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

import psycopg

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.migrate import migration_body
from app.repository import Repository
from app.schemas import ProductCreate, ProductUpdate, SaleCreate, SalesImportCreate
from app.security import Principal, hash_password

database = os.environ["STOCKCAST_TEST_DATABASE_URL"]
url = urlsplit(database)
assert url.path == "/price_tests", "Use the disposable price_tests database"
schema = "price_restart_check"
with psycopg.connect(database) as conn:
    if sys.argv[1] == "setup":
        conn.execute("CREATE SCHEMA price_restart_check")
        conn.execute("SET search_path TO price_restart_check")
        for migration in sorted((Path(__file__).parents[1] / "db" / "migrations").glob("*.up.sql")):
            conn.execute(migration_body(migration.read_text()))
        business = conn.execute("INSERT INTO businesses(name,data_origin) VALUES('Synthetic restart check','demo') RETURNING id").fetchone()[0]
        user = conn.execute("INSERT INTO users(business_id,email,display_name,role,password_hash) VALUES(%s,'restart@example.test','Synthetic owner','owner',%s) RETURNING id", (business, hash_password("synthetic-restart-password"))).fetchone()[0]
        conn.execute("INSERT INTO business_settings(business_id) VALUES(%s)", (business,))
        repository = Repository(conn)
        principal = Principal(str(user), str(business), "restart@example.test", "Synthetic owner", "owner")
        product = repository.create_product(principal, ProductCreate(sku="SYNTHETIC-RESTART", name="Synthetic cable", category="Synthetic", brand="Example", model="M1", variant="USB-C 2m", unit="pc", currentStock="20", leadTimeDays=0, safetyStock="0", unitCost="2.5", sellingPrice="12.3456"))
        repository.record_sale(principal, SaleCreate(productId=product["id"], saleDate="2026-01-01", quantity="0.125"))
        repository.create_sales_import(principal, SalesImportCreate(rows=[{"sku": product["sku"], "saleDate": "2026-01-02", "quantity": "3"}]))
        repository.update_product(principal, product["id"], ProductUpdate(sellingPrice="100", isActive=False))
        print("Synthetic price records saved; restart the disposable database before verify.")
    elif sys.argv[1] == "verify":
        conn.execute("SET search_path TO price_restart_check")
        assert conn.execute("SELECT current_stock,selling_price,unit_cost,is_active,brand,model,variant FROM products").fetchone() == (Decimal("19.875"), Decimal("100"), Decimal("2.5"), False, "Example", "M1", "USB-C 2m")
        assert conn.execute("SELECT quantity,selling_price,sales_amount FROM sales ORDER BY sale_date").fetchall() == [(Decimal("0.125"), Decimal("12.3456"), Decimal("1.5432000")), (Decimal("3"), None, None)]
        business = str(conn.execute("SELECT id FROM businesses").fetchone()[0])
        rows = Repository(conn).export_sales(business)
        assert rows[0]["sales_amount"] == Decimal("1.5432") and rows[1]["sales_amount"] is None
        conn.execute("DROP SCHEMA price_restart_check CASCADE")
        print("PostgreSQL restart persistence passed: prices, amounts, unknown history, attributes, inactive status, stock, and exports.")
    else:
        raise ValueError("Use setup or verify")
