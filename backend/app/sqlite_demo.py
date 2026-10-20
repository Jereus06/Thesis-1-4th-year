"""Explicitly local, synthetic SQLite demo API.

This process never connects to PostgreSQL and never imports the browser's localStorage records.
It exists for laptop demonstrations only; production must run :mod:`app.main`.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .schemas import (
    MovementCreate,
    ProductCreate,
    ProductUpdate,
    SaleCreate,
    SettingsUpdate,
    SignIn,
)
from .security import Principal, hash_password, new_token, token_hash, verify_password

DEMO_BUSINESS_ID = "00000000-0000-4000-8000-000000000001"
DEMO_OWNER_ID = "00000000-0000-4000-8000-000000000002"
DEMO_EMAIL = "owner@example.com"
DEMO_PASSWORD = "stockcast-demo-password"
DB_PATH = Path(os.getenv("STOCKCAST_DEMO_DB", "backend/data/stockcast-demo.sqlite3"))

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL,data_origin TEXT NOT NULL CHECK(data_origin='demo'));
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,email TEXT NOT NULL,display_name TEXT NOT NULL,role TEXT NOT NULL,password_hash TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,UNIQUE(business_id,email));
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf_token_hash TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,unit TEXT NOT NULL,current_stock TEXT NOT NULL,lead_time_days INTEGER NOT NULL,safety_stock TEXT NOT NULL,unit_cost TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,UNIQUE(business_id,sku));
CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,product_id TEXT NOT NULL,sale_date TEXT NOT NULL,quantity TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'manual',data_origin TEXT NOT NULL DEFAULT 'demo',recorded_by TEXT NOT NULL,voided_at TEXT);
CREATE TABLE IF NOT EXISTS inventory_movements(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,product_id TEXT NOT NULL,movement_date TEXT NOT NULL,movement_type TEXT NOT NULL,quantity_delta TEXT NOT NULL,balance_after TEXT NOT NULL,data_origin TEXT NOT NULL DEFAULT 'demo',sale_id TEXT,note TEXT,recorded_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS business_settings(business_id TEXT PRIMARY KEY,moving_average_window INTEGER NOT NULL DEFAULT 7,forecast_horizon_days INTEGER NOT NULL DEFAULT 14,target_cover_days INTEGER NOT NULL DEFAULT 7,minimum_history_weeks INTEGER NOT NULL DEFAULT 8,minimum_nonzero_days INTEGER NOT NULL DEFAULT 100,top_n_products INTEGER NOT NULL DEFAULT 8,cv_folds INTEGER NOT NULL DEFAULT 3,timezone TEXT NOT NULL DEFAULT 'Asia/Manila');
CREATE TABLE IF NOT EXISTS idempotency_keys(
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    operation TEXT NOT NULL CHECK(trim(operation) <> ''),
    key TEXT NOT NULL CHECK(trim(key) <> ''),
    request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
    response_status INTEGER CHECK(response_status BETWEEN 200 AND 599),
    response_body TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL CHECK(expires_at > created_at),
    UNIQUE(business_id,user_id,operation,key),
    CHECK((response_status IS NULL) = (response_body IS NULL))
);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def initialize() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        # Preserve files created by earlier explicit SQLite demonstrations.
        if "voided_at" not in {row["name"] for row in conn.execute("PRAGMA table_info(sales)")}:
            conn.execute("ALTER TABLE sales ADD COLUMN voided_at TEXT")
        conn.execute(
            "INSERT OR IGNORE INTO businesses VALUES(?,?,?)",
            (DEMO_BUSINESS_ID, "StockCast SQLite Demo", "demo"),
        )
        conn.execute(
            "INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?,1)",
            (
                DEMO_OWNER_ID,
                DEMO_BUSINESS_ID,
                DEMO_EMAIL,
                "Demo Owner",
                "owner",
                hash_password(DEMO_PASSWORD),
            ),
        )
        conn.execute(
            "INSERT OR IGNORE INTO business_settings(business_id) VALUES(?)", (DEMO_BUSINESS_ID,)
        )


def db():
    with connect() as conn:
        yield conn


def product(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "businessId": row["business_id"],
        "sku": row["sku"],
        "name": row["name"],
        "category": row["category"],
        "unit": row["unit"],
        "currentStock": row["current_stock"],
        "leadTimeDays": row["lead_time_days"],
        "safetyStock": row["safety_stock"],
        "unitCost": row["unit_cost"],
        "isActive": bool(row["is_active"]),
    }


def decimal_text(value: Decimal | str) -> str:
    return format(Decimal(value), "f")


def authenticated(
    stockcast_session: str | None = Cookie(None), conn: sqlite3.Connection = Depends(db)
) -> tuple[Principal, str]:
    if not stockcast_session:
        raise HTTPException(401, "Sign in is required")
    row = conn.execute(
        "SELECT u.*,s.csrf_token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.is_active=1",
        (token_hash(stockcast_session), datetime.now(UTC).isoformat()),
    ).fetchone()
    if not row:
        raise HTTPException(401, "Sign in is required")
    return Principal(
        row["id"], row["business_id"], row["email"], row["display_name"], row["role"]
    ), row["csrf_token_hash"]


def csrf(
    session: tuple[Principal, str] = Depends(authenticated),
    csrf_cookie: str | None = Cookie(None, alias="stockcast_csrf"),
    csrf_header: str | None = Header(None, alias="X-CSRF-Token"),
) -> Principal:
    if not csrf_cookie or csrf_cookie != csrf_header or token_hash(csrf_cookie) != session[1]:
        raise HTTPException(403, "CSRF token is missing or invalid")
    return session[0]


def member(business_id: str, user: Principal) -> None:
    if user.business_id != business_id:
        raise HTTPException(403, "You do not belong to this business")


def write_once(conn, user, key, operation, data, callback, *, status_code=200):
    """Atomically save a request and its result in the optional demo database."""
    if key and (not key.strip() or len(key) > 200):
        raise HTTPException(422, "Idempotency-Key must contain 1 to 200 characters")
    encoded = json.dumps(data.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    request_hash = hashlib.sha256(encoded.encode()).hexdigest()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if key:
            existing = conn.execute(
                """SELECT request_hash,response_body FROM idempotency_keys
                   WHERE business_id=? AND user_id=? AND operation=? AND key=?""",
                (user.business_id, user.user_id, operation, key),
            ).fetchone()
            if existing:
                if existing["request_hash"] != request_hash:
                    raise HTTPException(409, "Idempotency key was already used for another request")
                if existing["response_body"] is None:
                    raise HTTPException(409, "An identical request is still being processed")
                result = json.loads(existing["response_body"])
                if operation == "record_sale":
                    sale = conn.execute(
                        "SELECT voided_at FROM sales WHERE business_id=? AND id=?",
                        (user.business_id, result["id"]),
                    ).fetchone()
                    if not sale or sale["voided_at"] is not None:
                        raise HTTPException(
                            409,
                            "This recorded sale was deleted; record a new sale with a new idempotency key",
                        )
                conn.execute("COMMIT")
                return result
            now = datetime.now(UTC)
            conn.execute(
                """INSERT INTO idempotency_keys
                   (id,business_id,user_id,operation,key,request_hash,created_at,expires_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (str(uuid4()), user.business_id, user.user_id, operation, key, request_hash,
                 now.isoformat(), (now + timedelta(hours=24)).isoformat()),
            )
        result = callback()
        if key:
            conn.execute(
                """UPDATE idempotency_keys SET response_status=?,response_body=?
                   WHERE business_id=? AND user_id=? AND operation=? AND key=?""",
                (status_code, json.dumps(result), user.business_id, user.user_id, operation, key),
            )
        conn.execute("COMMIT")
        return result
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


app = FastAPI(title="StockCast SQLite Demo API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "http://127.0.0.1:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
)


@app.on_event("startup")
def startup() -> None:
    initialize()


@app.get("/api/v1/health")
def health():
    with connect() as conn:
        conn.execute("SELECT 1").fetchone()
    return {"status": "ok", "database": "connected", "mode": "sqlite_demo", "dataOrigin": "demo"}


@app.post("/api/v1/auth/sign-in")
def sign_in(data: SignIn, response: Response, conn: sqlite3.Connection = Depends(db)):
    row = conn.execute(
        "SELECT * FROM users WHERE business_id=? AND email=? AND is_active=1",
        (str(data.business_id), str(data.email).lower()),
    ).fetchone()
    if not row or not verify_password(data.password, row["password_hash"]):
        raise HTTPException(401, "Invalid business, email, or password")
    session, csrf_value = new_token(), new_token()
    conn.execute(
        "INSERT INTO sessions VALUES(?,?,?,?)",
        (
            token_hash(session),
            row["id"],
            token_hash(csrf_value),
            (datetime.now(UTC) + timedelta(hours=12)).isoformat(),
        ),
    )
    response.set_cookie(
        "stockcast_session", session, httponly=True, samesite="strict", max_age=43200
    )
    response.set_cookie("stockcast_csrf", csrf_value, samesite="strict", max_age=43200)
    return {
        "data": {
            "userId": row["id"],
            "businessId": row["business_id"],
            "email": row["email"],
            "displayName": row["display_name"],
            "role": row["role"],
        }
    }


@app.get("/api/v1/auth/me")
def me(session: tuple[Principal, str] = Depends(authenticated)):
    user = session[0]
    return {
        "data": {
            "userId": user.user_id,
            "businessId": user.business_id,
            "email": user.email,
            "displayName": user.display_name,
            "role": user.role,
        }
    }


@app.post("/api/v1/auth/sign-out")
def sign_out(
    response: Response,
    stockcast_session: str | None = Cookie(None),
    conn: sqlite3.Connection = Depends(db),
    _user: Principal = Depends(csrf),
):
    if stockcast_session:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(stockcast_session),))
    response.delete_cookie("stockcast_session")
    response.delete_cookie("stockcast_csrf")
    return {"data": {"signedOut": True}}


@app.get("/api/v1/businesses/{business_id}/products")
def products(
    business_id: str,
    conn: sqlite3.Connection = Depends(db),
    session: tuple[Principal, str] = Depends(authenticated),
):
    member(business_id, session[0])
    return {
        "data": [
            product(row)
            for row in conn.execute(
                "SELECT * FROM products WHERE business_id=? ORDER BY name", (business_id,)
            )
        ]
    }


@app.post("/api/v1/businesses/{business_id}/products", status_code=201)
def create_product(
    business_id: str,
    data: ProductCreate,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    member(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")

    def apply_creation():
        product_id = str(uuid4())
        conn.execute(
            "INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,1)",
            (
                product_id,
                business_id,
                data.sku.strip(),
                data.name.strip(),
                data.category.strip(),
                data.unit.strip(),
                decimal_text(data.current_stock),
                data.lead_time_days,
                decimal_text(data.safety_stock),
                decimal_text(data.unit_cost),
            ),
        )
        if data.current_stock:
            conn.execute(
                "INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    str(uuid4()),
                    business_id,
                    product_id,
                    str(datetime.now(UTC).date()),
                    "opening_balance",
                    decimal_text(data.current_stock),
                    decimal_text(data.current_stock),
                    "demo",
                    None,
                    "Initial product balance",
                    user.user_id,
                    datetime.now(UTC).isoformat(),
                ),
            )
        return product(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())

    return {
        "data": write_once(
            conn, user, idempotency_key, "create_product", data, apply_creation, status_code=201,
        )
    }


@app.patch("/api/v1/businesses/{business_id}/products/{product_id}")
def update_product(
    business_id: str,
    product_id: str,
    data: ProductUpdate,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    member(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    fields = data.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(422, "At least one field is required")

    def apply_update():
        row = conn.execute(
            "SELECT * FROM products WHERE id=? AND business_id=?", (product_id, business_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        for key, value in fields.items():
            conn.execute(
                f"UPDATE products SET {key}=? WHERE id=?",
                (decimal_text(value) if isinstance(value, Decimal) else value, product_id),
            )
        return product(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())

    return {
        "data": write_once(
            conn, user, idempotency_key, f"update_product:{product_id}", data, apply_update,
        )
    }


@app.post("/api/v1/businesses/{business_id}/sales", status_code=201)
def record_sale(
    business_id: str,
    data: SaleCreate,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    member(business_id, user)

    def apply_sale():
        timezone = conn.execute(
            "SELECT timezone FROM business_settings WHERE business_id=?", (business_id,),
        ).fetchone()["timezone"]
        if data.sale_date > datetime.now(ZoneInfo(timezone)).date():
            raise HTTPException(422, "Sales cannot be dated after the business's current date")
        row = conn.execute(
            "SELECT current_stock FROM products WHERE id=? AND business_id=? AND is_active=1",
            (str(data.product_id), business_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        balance = Decimal(row["current_stock"]) - data.quantity
        if balance < 0:
            raise HTTPException(409, "Sale quantity exceeds current stock")
        sale_id = str(uuid4())
        conn.execute(
            "INSERT INTO sales(id,business_id,product_id,sale_date,quantity,source,data_origin,recorded_by) VALUES(?,?,?,?,?,?,?,?)",
            (
                sale_id,
                business_id,
                str(data.product_id),
                str(data.sale_date),
                decimal_text(data.quantity),
                "manual",
                "demo",
                user.user_id,
            ),
        )
        conn.execute(
            "UPDATE products SET current_stock=? WHERE id=?",
            (decimal_text(balance), str(data.product_id)),
        )
        conn.execute(
            "INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                str(uuid4()),
                business_id,
                str(data.product_id),
                str(data.sale_date),
                "sale",
                decimal_text(-data.quantity),
                decimal_text(balance),
                "demo",
                sale_id,
                None,
                user.user_id,
                datetime.now(UTC).isoformat(),
            ),
        )
        return {
            "id": sale_id,
            "businessId": business_id,
            "productId": str(data.product_id),
            "saleDate": str(data.sale_date),
            "quantity": decimal_text(data.quantity),
            "source": "manual",
            "dataOrigin": "demo",
        }

    return {
        "data": write_once(
            conn, user, idempotency_key, "record_sale", data, apply_sale, status_code=201,
        )
    }


@app.get("/api/v1/businesses/{business_id}/sales")
def sales(
    business_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(db),
    session: tuple[Principal, str] = Depends(authenticated),
):
    member(business_id, session[0])
    rows = conn.execute(
        "SELECT * FROM sales WHERE business_id=? AND voided_at IS NULL ORDER BY sale_date DESC,id DESC LIMIT ? OFFSET ?",
        (business_id, limit, offset),
    )
    return {
        "data": [
            {
                "id": r["id"],
                "productId": r["product_id"],
                "saleDate": r["sale_date"],
                "quantity": r["quantity"],
                "source": r["source"],
                "dataOrigin": "demo",
            }
            for r in rows
        ]
    }


@app.delete("/api/v1/businesses/{business_id}/sales/{sale_id}")
def delete_sale(
    business_id: str,
    sale_id: UUID,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
):
    member(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    try:
        conn.execute("BEGIN IMMEDIATE")
        sale = conn.execute(
            "SELECT * FROM sales WHERE business_id=? AND id=?", (business_id, str(sale_id)),
        ).fetchone()
        if not sale or sale["voided_at"] is not None:
            conn.execute("COMMIT")
            return {"data": {"deletedRows": 0}}
        if sale["source"] != "manual":
            raise HTTPException(409, "Only manually recorded sales can be deleted in the SQLite demo")
        item = conn.execute(
            "SELECT current_stock FROM products WHERE business_id=? AND id=?",
            (business_id, sale["product_id"]),
        ).fetchone()
        audits = conn.execute(
            "SELECT * FROM inventory_movements WHERE business_id=? AND sale_id=?",
            (business_id, str(sale_id)),
        ).fetchall()
        quantity = Decimal(sale["quantity"])
        if (not item or len(audits) != 1 or audits[0]["movement_type"] != "sale"
                or audits[0]["product_id"] != sale["product_id"]
                or Decimal(audits[0]["quantity_delta"]) != -quantity):
            raise HTTPException(409, "Recorded sale stock audit is inconsistent; review it before deletion")
        balance = Decimal(item["current_stock"]) + quantity
        timezone = conn.execute(
            "SELECT timezone FROM business_settings WHERE business_id=?", (business_id,),
        ).fetchone()["timezone"]
        conn.execute(
            "UPDATE products SET current_stock=? WHERE business_id=? AND id=?",
            (decimal_text(balance), business_id, sale["product_id"]),
        )
        conn.execute(
            "INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (str(uuid4()), business_id, sale["product_id"],
             str(datetime.now(ZoneInfo(timezone)).date()), "adjustment", decimal_text(quantity),
             decimal_text(balance), sale["data_origin"], None,
             f"Recorded sale deleted: {sale_id}", user.user_id, datetime.now(UTC).isoformat()),
        )
        conn.execute(
            "UPDATE sales SET voided_at=? WHERE business_id=? AND id=?",
            (datetime.now(UTC).isoformat(), business_id, str(sale_id)),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {"data": {"deletedRows": 1}}


@app.post("/api/v1/businesses/{business_id}/inventory-movements", status_code=201)
def movement(
    business_id: str,
    data: MovementCreate,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    member(business_id, user)
    if data.movement_type in {"adjustment", "write_off"} and user.role != "owner":
        raise HTTPException(403, "Owner role required")
    if data.movement_type not in {"receipt", "return", "write_off", "adjustment"}:
        raise HTTPException(422, "Invalid movement type")
    if data.movement_type in {"receipt", "return"} and data.quantity_delta < 0:
        raise HTTPException(409, "Receipt and return quantities must increase stock")
    if data.movement_type == "write_off" and data.quantity_delta > 0:
        raise HTTPException(409, "Write-off quantity must decrease stock")

    def apply_movement():
        timezone = conn.execute(
            "SELECT timezone FROM business_settings WHERE business_id=?", (business_id,),
        ).fetchone()["timezone"]
        if data.movement_date > datetime.now(ZoneInfo(timezone)).date():
            raise HTTPException(422, "Stock movements cannot be dated after the business's current date")
        row = conn.execute(
            "SELECT current_stock FROM products WHERE id=? AND business_id=? AND is_active=1",
            (str(data.product_id), business_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        balance = Decimal(row["current_stock"]) + data.quantity_delta
        if balance < 0:
            raise HTTPException(409, "Movement would make stock negative")
        movement_id = str(uuid4())
        now = datetime.now(UTC).isoformat()
        conn.execute(
            "UPDATE products SET current_stock=? WHERE id=?",
            (decimal_text(balance), str(data.product_id)),
        )
        conn.execute(
            "INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                movement_id,
                business_id,
                str(data.product_id),
                str(data.movement_date),
                data.movement_type,
                decimal_text(data.quantity_delta),
                decimal_text(balance),
                "demo",
                None,
                data.note,
                user.user_id,
                now,
            ),
        )
        return {
            "id": movement_id,
            "businessId": business_id,
            "productId": str(data.product_id),
            "movementDate": str(data.movement_date),
            "movementType": data.movement_type,
            "quantityDelta": decimal_text(data.quantity_delta),
            "balanceAfter": decimal_text(balance),
            "dataOrigin": "demo",
            "saleId": None,
            "note": data.note,
            "recordedBy": user.user_id,
        }

    return {
        "data": write_once(
            conn, user, idempotency_key, "record_movement", data, apply_movement, status_code=201,
        )
    }


@app.get("/api/v1/businesses/{business_id}/inventory-movements")
def movements(
    business_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(db),
    session: tuple[Principal, str] = Depends(authenticated),
):
    member(business_id, session[0])
    rows = conn.execute(
        "SELECT * FROM inventory_movements WHERE business_id=? ORDER BY movement_date DESC,created_at DESC LIMIT ? OFFSET ?",
        (business_id, limit, offset),
    )
    return {
        "data": [
            {
                "id": r["id"],
                "businessId": business_id,
                "productId": r["product_id"],
                "movementDate": r["movement_date"],
                "movementType": r["movement_type"],
                "quantityDelta": r["quantity_delta"],
                "balanceAfter": r["balance_after"],
                "dataOrigin": "demo",
                "saleId": r["sale_id"],
                "note": r["note"],
                "recordedBy": r["recorded_by"],
            }
            for r in rows
        ]
    }


@app.get("/api/v1/businesses/{business_id}/settings")
def settings(
    business_id: str,
    conn: sqlite3.Connection = Depends(db),
    session: tuple[Principal, str] = Depends(authenticated),
):
    member(business_id, session[0])
    return {"data": _get_settings(conn, business_id)}


@app.put("/api/v1/businesses/{business_id}/settings")
def update_settings(
    business_id: str,
    data: SettingsUpdate,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
):
    member(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    values = data.model_dump(exclude={"business_name", "business_location", "expected_version"})
    try:
        conn.execute("BEGIN IMMEDIATE")
        current = _get_settings(conn, business_id)
        if data.expected_version is not None and data.expected_version != current["version"]:
            raise HTTPException(
                409,
                "Settings changed in another browser. Reload the saved settings before trying again.",
            )
        if data.business_location is not None and data.business_location.strip():
            raise HTTPException(422, "The SQLite demo cannot save a business location")
        if data.business_name is not None and not data.business_name.strip():
            raise HTTPException(422, "Business name is required")
        assignments = ",".join(f"{key}=?" for key in values)
        conn.execute(
            f"UPDATE business_settings SET {assignments} WHERE business_id=?",
            (*values.values(), business_id),
        )
        if data.business_name is not None:
            conn.execute(
                "UPDATE businesses SET name=? WHERE id=?", (data.business_name.strip(), business_id),
            )
        result = _get_settings(conn, business_id)
        conn.execute("COMMIT")
        return {"data": result}
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


def _get_settings(conn, business_id):
    row = conn.execute(
        """SELECT s.*,b.name AS business_name,b.data_origin
           FROM business_settings s JOIN businesses b ON b.id=s.business_id
           WHERE s.business_id=?""", (business_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Settings not found")
    return _settings(row)


def _settings(row: sqlite3.Row) -> dict:
    return {
        "businessId": row["business_id"],
        "businessName": row["business_name"],
        "businessLocation": None,
        "dataOrigin": row["data_origin"],
        "version": hashlib.sha256(json.dumps(dict(row), sort_keys=True).encode()).hexdigest(),
        "movingAverageWindow": row["moving_average_window"],
        "forecastHorizonDays": row["forecast_horizon_days"],
        "targetCoverDays": row["target_cover_days"],
        "minimumHistoryWeeks": row["minimum_history_weeks"],
        "minimumNonzeroDays": row["minimum_nonzero_days"],
        "topNProducts": row["top_n_products"],
        "cvFolds": row["cv_folds"],
        "timezone": row["timezone"],
    }
