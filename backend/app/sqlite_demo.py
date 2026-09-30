"""Explicitly local, synthetic SQLite demo API.

This process never connects to PostgreSQL and never imports the browser's localStorage records.
It exists for laptop demonstrations only; production must run :mod:`app.main`.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

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
DEMO_EMAIL = "owner@example.test"
DEMO_PASSWORD = "stockcast-demo-password"
DB_PATH = Path(os.getenv("STOCKCAST_DEMO_DB", "backend/data/stockcast-demo.sqlite3"))

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL,data_origin TEXT NOT NULL CHECK(data_origin='demo'));
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,email TEXT NOT NULL,display_name TEXT NOT NULL,role TEXT NOT NULL,password_hash TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,UNIQUE(business_id,email));
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf_token_hash TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,unit TEXT NOT NULL,current_stock TEXT NOT NULL,lead_time_days INTEGER NOT NULL,safety_stock TEXT NOT NULL,unit_cost TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,UNIQUE(business_id,sku));
CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,product_id TEXT NOT NULL,sale_date TEXT NOT NULL,quantity TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'manual',data_origin TEXT NOT NULL DEFAULT 'demo',recorded_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_movements(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,product_id TEXT NOT NULL,movement_date TEXT NOT NULL,movement_type TEXT NOT NULL,quantity_delta TEXT NOT NULL,balance_after TEXT NOT NULL,data_origin TEXT NOT NULL DEFAULT 'demo',sale_id TEXT,note TEXT,recorded_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS business_settings(business_id TEXT PRIMARY KEY,moving_average_window INTEGER NOT NULL DEFAULT 7,forecast_horizon_days INTEGER NOT NULL DEFAULT 14,target_cover_days INTEGER NOT NULL DEFAULT 7,minimum_history_weeks INTEGER NOT NULL DEFAULT 8,minimum_nonzero_days INTEGER NOT NULL DEFAULT 100,top_n_products INTEGER NOT NULL DEFAULT 8,cv_folds INTEGER NOT NULL DEFAULT 3,timezone TEXT NOT NULL DEFAULT 'Asia/Manila');
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


app = FastAPI(title="StockCast SQLite Demo API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "http://127.0.0.1:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
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
):
    member(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    product_id = str(uuid4())
    try:
        conn.execute("BEGIN IMMEDIATE")
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
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {
        "data": product(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())
    }


@app.patch("/api/v1/businesses/{business_id}/products/{product_id}")
def update_product(
    business_id: str,
    product_id: str,
    data: ProductUpdate,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
):
    member(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    fields = data.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(422, "At least one field is required")
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
    return {
        "data": product(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())
    }


@app.post("/api/v1/businesses/{business_id}/sales", status_code=201)
def record_sale(
    business_id: str,
    data: SaleCreate,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
):
    member(business_id, user)
    try:
        conn.execute("BEGIN IMMEDIATE")
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
            "INSERT INTO sales VALUES(?,?,?,?,?,?,?,?)",
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
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {
        "data": {
            "id": sale_id,
            "businessId": business_id,
            "productId": str(data.product_id),
            "saleDate": str(data.sale_date),
            "quantity": decimal_text(data.quantity),
            "source": "manual",
            "dataOrigin": "demo",
        }
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
        "SELECT * FROM sales WHERE business_id=? ORDER BY sale_date DESC,id DESC LIMIT ? OFFSET ?",
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


@app.post("/api/v1/businesses/{business_id}/inventory-movements", status_code=201)
def movement(
    business_id: str,
    data: MovementCreate,
    conn: sqlite3.Connection = Depends(db),
    user: Principal = Depends(csrf),
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
    try:
        conn.execute("BEGIN IMMEDIATE")
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
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {
        "data": {
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
    row = conn.execute(
        "SELECT * FROM business_settings WHERE business_id=?", (business_id,)
    ).fetchone()
    return {"data": _settings(row)}


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
    values = data.model_dump()
    assignments = ",".join(f"{key}=?" for key in values)
    conn.execute(
        f"UPDATE business_settings SET {assignments} WHERE business_id=?",
        (*values.values(), business_id),
    )
    return {
        "data": _settings(
            conn.execute(
                "SELECT * FROM business_settings WHERE business_id=?", (business_id,)
            ).fetchone()
        )
    }


def _settings(row: sqlite3.Row) -> dict:
    return {
        "businessId": row["business_id"],
        "movingAverageWindow": row["moving_average_window"],
        "forecastHorizonDays": row["forecast_horizon_days"],
        "targetCoverDays": row["target_cover_days"],
        "minimumHistoryWeeks": row["minimum_history_weeks"],
        "minimumNonzeroDays": row["minimum_nonzero_days"],
        "topNProducts": row["top_n_products"],
        "cvFolds": row["cv_folds"],
        "timezone": row["timezone"],
    }
