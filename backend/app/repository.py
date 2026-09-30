from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import dict_row

from .schemas import MovementCreate, ProductCreate, ProductUpdate, SaleCreate, SettingsUpdate
from .security import Principal, new_token, token_hash, verify_password


def decimal_text(value: Decimal | str) -> str:
    return format(Decimal(value), "f")


def product_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]), "businessId": str(row["business_id"]),
        "sku": row["sku"], "name": row["name"], "category": row["category"],
        "unit": row["unit"], "currentStock": decimal_text(row["current_stock"]),
        "leadTimeDays": row["lead_time_days"], "safetyStock": decimal_text(row["safety_stock"]),
        "unitCost": decimal_text(row["unit_cost"]), "isActive": row["is_active"],
    }


class Repository:
    def __init__(self, conn: Connection):
        self.conn = conn
        self.conn.row_factory = dict_row

    def sign_in(self, business_id: UUID, email: str, password: str, hours: int):
        row = self.conn.execute(
            "SELECT * FROM users WHERE business_id=%s AND email=%s AND is_active",
            (business_id, email.strip().lower()),
        ).fetchone()
        if not row or not row["password_hash"] or not verify_password(password, row["password_hash"]):
            raise HTTPException(401, "Invalid business, email, or password")
        session, csrf = new_token(), new_token()
        expires = datetime.now(UTC) + timedelta(hours=hours)
        self.conn.execute(
            "INSERT INTO sessions(user_id,token_hash,csrf_token_hash,expires_at) VALUES(%s,%s,%s,%s)",
            (row["id"], token_hash(session), token_hash(csrf), expires),
        )
        return session, csrf, self._principal(row)

    def authenticate(self, session: str) -> tuple[Principal, str]:
        row = self.conn.execute(
            """UPDATE sessions s SET last_seen_at=now() FROM users u
               WHERE s.token_hash=%s AND s.expires_at>now() AND u.id=s.user_id AND u.is_active
               RETURNING u.id,u.business_id,u.email,u.display_name,u.role,s.csrf_token_hash""",
            (token_hash(session),),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Sign in is required")
        return self._principal(row), row["csrf_token_hash"]

    def sign_out(self, session: str) -> None:
        self.conn.execute("DELETE FROM sessions WHERE token_hash=%s", (token_hash(session),))

    def list_products(self, business_id: str):
        rows = self.conn.execute(
            "SELECT * FROM products WHERE business_id=%s ORDER BY name,id", (business_id,)
        ).fetchall()
        return [product_row(row) for row in rows]

    def create_product(self, principal: Principal, data: ProductCreate):
        with self.conn.transaction():
            row = self.conn.execute(
                """INSERT INTO products
                (business_id,sku,name,category,unit,current_stock,lead_time_days,safety_stock,unit_cost)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                (principal.business_id, data.sku.strip(), data.name.strip(), data.category.strip(),
                 data.unit.strip(), data.current_stock, data.lead_time_days, data.safety_stock,
                 data.unit_cost),
            ).fetchone()
            if data.current_stock > 0:
                self.conn.execute(
                    """INSERT INTO inventory_movements
                    (business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,
                     data_origin,note,recorded_by)
                    SELECT %s,%s,CURRENT_DATE,'opening_balance',%s,%s,data_origin,
                           'Initial product balance',%s FROM businesses WHERE id=%s""",
                    (principal.business_id, row["id"], data.current_stock, data.current_stock,
                     principal.user_id, principal.business_id),
                )
        return product_row(row)

    def update_product(self, principal: Principal, product_id: UUID, data: ProductUpdate):
        fields = data.model_dump(exclude_none=True)
        if not fields:
            raise HTTPException(422, "At least one field is required")
        names = {"lead_time_days", "safety_stock", "unit_cost", "is_active", "sku", "name", "category", "unit"}
        if not set(fields) <= names:
            raise HTTPException(422, "Unsupported product field")
        assignments = ",".join(f"{name}=%s" for name in fields)
        row = self.conn.execute(
            f"UPDATE products SET {assignments} WHERE business_id=%s AND id=%s RETURNING *",
            (*fields.values(), principal.business_id, product_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        return product_row(row)

    def record_sale(self, principal: Principal, data: SaleCreate):
        with self.conn.transaction():
            product = self.conn.execute(
                "SELECT current_stock FROM products WHERE business_id=%s AND id=%s AND is_active FOR UPDATE",
                (principal.business_id, data.product_id),
            ).fetchone()
            if not product:
                raise HTTPException(404, "Product not found")
            balance = product["current_stock"] - data.quantity
            if balance < 0:
                raise HTTPException(409, "Sale quantity exceeds current stock")
            sale = self.conn.execute(
                """INSERT INTO sales(business_id,product_id,sale_date,quantity,source,data_origin,recorded_by)
                SELECT %s,%s,%s,%s,'manual',data_origin,%s FROM businesses WHERE id=%s RETURNING *""",
                (principal.business_id, data.product_id, data.sale_date, data.quantity,
                 principal.user_id, principal.business_id),
            ).fetchone()
            self.conn.execute("UPDATE products SET current_stock=%s WHERE id=%s", (balance, data.product_id))
            self.conn.execute(
                """INSERT INTO inventory_movements
                (business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,
                 data_origin,sale_id,recorded_by)
                SELECT %s,%s,%s,'sale',%s,%s,data_origin,%s,%s FROM businesses WHERE id=%s""",
                (principal.business_id, data.product_id, data.sale_date, -data.quantity, balance,
                 sale["id"], principal.user_id, principal.business_id),
            )
        return {"id": str(sale["id"]), "businessId": principal.business_id,
                "productId": str(data.product_id), "saleDate": str(data.sale_date),
                "quantity": decimal_text(data.quantity), "source": "manual", "dataOrigin": sale["data_origin"]}

    def record_movement(self, principal: Principal, data: MovementCreate):
        allowed = {"receipt", "return", "write_off", "adjustment"}
        if data.movement_type not in allowed or data.quantity_delta == 0:
            raise HTTPException(422, "Invalid movement type or quantity")
        if data.movement_type in {"receipt", "return"} and data.quantity_delta < 0:
            raise HTTPException(409, "Receipt and return quantities must increase stock")
        if data.movement_type == "write_off" and data.quantity_delta > 0:
            raise HTTPException(409, "Write-off quantity must decrease stock")
        with self.conn.transaction():
            product = self.conn.execute(
                "SELECT current_stock FROM products WHERE business_id=%s AND id=%s AND is_active FOR UPDATE",
                (principal.business_id, data.product_id),
            ).fetchone()
            if not product:
                raise HTTPException(404, "Product not found")
            balance = product["current_stock"] + data.quantity_delta
            if balance < 0:
                raise HTTPException(409, "Movement would make stock negative")
            self.conn.execute("UPDATE products SET current_stock=%s WHERE id=%s", (balance, data.product_id))
            row = self.conn.execute(
                """INSERT INTO inventory_movements
                (business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,
                 data_origin,note,recorded_by)
                SELECT %s,%s,%s,%s,%s,%s,data_origin,%s,%s FROM businesses WHERE id=%s RETURNING *""",
                (principal.business_id, data.product_id, data.movement_date, data.movement_type,
                 data.quantity_delta, balance, data.note, principal.user_id, principal.business_id),
            ).fetchone()
        return self._movement(row)

    def list_sales(self, business_id: str, limit: int, offset: int):
        rows = self.conn.execute(
            "SELECT * FROM sales WHERE business_id=%s ORDER BY sale_date DESC,id DESC LIMIT %s OFFSET %s",
            (business_id, limit, offset),
        ).fetchall()
        return [{"id": str(r["id"]), "productId": str(r["product_id"]), "saleDate": str(r["sale_date"]),
                 "quantity": decimal_text(r["quantity"]), "source": r["source"], "dataOrigin": r["data_origin"]}
                for r in rows]

    def list_movements(self, business_id: str, limit: int, offset: int):
        rows = self.conn.execute(
            "SELECT * FROM inventory_movements WHERE business_id=%s ORDER BY movement_date DESC,created_at DESC,id DESC LIMIT %s OFFSET %s",
            (business_id, limit, offset),
        ).fetchall()
        return [self._movement(r) for r in rows]

    def get_settings(self, business_id: str):
        row = self.conn.execute("SELECT * FROM business_settings WHERE business_id=%s", (business_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Settings not found")
        return {"businessId": str(row["business_id"]), "movingAverageWindow": row["moving_average_window"],
                "forecastHorizonDays": row["forecast_horizon_days"], "targetCoverDays": row["target_cover_days"],
                "minimumHistoryWeeks": row["minimum_history_weeks"], "minimumNonzeroDays": row["minimum_nonzero_days"],
                "topNProducts": row["top_n_products"], "cvFolds": row["cv_folds"], "timezone": row["timezone"]}

    def put_settings(self, business_id: str, data: SettingsUpdate):
        values = data.model_dump()
        row = self.conn.execute(
            """UPDATE business_settings SET moving_average_window=%s,forecast_horizon_days=%s,
            target_cover_days=%s,minimum_history_weeks=%s,minimum_nonzero_days=%s,
            top_n_products=%s,cv_folds=%s,timezone=%s WHERE business_id=%s RETURNING *""",
            (*values.values(), business_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Settings not found")
        return self.get_settings(business_id)

    @staticmethod
    def _principal(row):
        return Principal(str(row["id"]), str(row["business_id"]), row["email"], row["display_name"], row["role"])

    @staticmethod
    def _movement(row):
        return {"id": str(row["id"]), "businessId": str(row["business_id"]), "productId": str(row["product_id"]),
                "movementDate": str(row["movement_date"]), "movementType": row["movement_type"],
                "quantityDelta": decimal_text(row["quantity_delta"]), "balanceAfter": decimal_text(row["balance_after"]),
                "dataOrigin": row["data_origin"], "saleId": str(row["sale_id"]) if row["sale_id"] else None,
                "note": row["note"], "recordedBy": str(row["recorded_by"]) if row["recorded_by"] else None}
