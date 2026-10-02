import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .inventory import calculate_reorder
from .schemas import (
    BusinessUpdate,
    DataQualityDelete,
    DataQualityUpsert,
    ForecastRunCreate,
    InventoryImportCreate,
    MovementCreate,
    ProductCreate,
    ProductUpdate,
    RecommendationGenerate,
    SaleCreate,
    SalesImportCreate,
    SettingsUpdate,
)
from .security import Principal, new_token, token_hash, verify_password


def decimal_text(value: Decimal | str) -> str:
    return format(Decimal(value), "f")


def product_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "businessId": str(row["business_id"]),
        "sku": row["sku"],
        "name": row["name"],
        "category": row["category"],
        "unit": row["unit"],
        "currentStock": decimal_text(row["current_stock"]),
        "leadTimeDays": row["lead_time_days"],
        "safetyStock": decimal_text(row["safety_stock"]),
        "unitCost": decimal_text(row["unit_cost"]),
        "isActive": row["is_active"],
    }


class Repository:
    def __init__(self, conn: Connection):
        self.conn = conn
        self.conn.row_factory = dict_row

    def business_day(self, business_id: str):
        return datetime.now(ZoneInfo(self.get_settings(business_id)["timezone"])).date()

    def sign_in(self, business_id: UUID, email: str, password: str, hours: int):
        row = self.conn.execute(
            "SELECT * FROM users WHERE business_id=%s AND email=%s AND is_active",
            (business_id, email.strip().lower()),
        ).fetchone()
        if (
            not row
            or not row["password_hash"]
            or not verify_password(password, row["password_hash"])
        ):
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

    def idempotent(self, principal: Principal, operation: str, key: str, payload: dict, callback):
        if not key.strip() or len(key) > 200:
            raise HTTPException(422, "Idempotency-Key must contain 1 to 200 characters")
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        request_hash = hashlib.sha256(encoded).hexdigest()
        expires = datetime.now(UTC) + timedelta(hours=24)
        with self.conn.transaction():
            inserted = self.conn.execute(
                """INSERT INTO idempotency_keys
                (business_id,user_id,operation,key,request_hash,expires_at)
                VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id""",
                (principal.business_id, principal.user_id, operation, key, request_hash, expires),
            ).fetchone()
            if not inserted:
                existing = self.conn.execute(
                    """SELECT request_hash,response_body FROM idempotency_keys
                       WHERE business_id=%s AND user_id=%s AND operation=%s AND key=%s""",
                    (principal.business_id, principal.user_id, operation, key),
                ).fetchone()
                if existing["request_hash"] != request_hash:
                    raise HTTPException(409, "Idempotency key was already used for another request")
                if existing["response_body"] is None:
                    raise HTTPException(409, "An identical request is still being processed")
                return existing["response_body"]
            result = callback()
            self.conn.execute(
                """UPDATE idempotency_keys SET response_status=201,response_body=%s WHERE id=%s""",
                (Jsonb(result), inserted["id"]),
            )
            return result

    def list_data_quality(self, business_id: str):
        rows = self.conn.execute(
            """SELECT q.id,q.product_id,p.sku,p.name,q.classification_date,q.classification,
                      q.note,q.created_at,q.updated_at
               FROM sales_day_quality q LEFT JOIN products p
                 ON p.business_id=q.business_id AND p.id=q.product_id
               WHERE q.business_id=%s ORDER BY q.classification_date DESC,q.product_id NULLS FIRST""",
            (business_id,),
        ).fetchall()
        return [self._quality_row(row) for row in rows]

    def upsert_data_quality(self, principal: Principal, data: DataQualityUpsert):
        with self.conn.transaction():
            if data.product_id is not None:
                product = self.conn.execute(
                    "SELECT 1 FROM products WHERE business_id=%s AND id=%s",
                    (principal.business_id, data.product_id),
                ).fetchone()
                if not product:
                    raise HTTPException(404, "Product not found")
            old = self.conn.execute(
                """SELECT * FROM sales_day_quality WHERE business_id=%s
                   AND product_id IS NOT DISTINCT FROM %s AND classification_date=%s FOR UPDATE""",
                (principal.business_id, data.product_id, data.classification_date),
            ).fetchone()
            row = self.conn.execute(
                """INSERT INTO sales_day_quality
                   (business_id,product_id,classification_date,classification,note,created_by,updated_by)
                   VALUES(%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (business_id,product_id,classification_date)
                   DO UPDATE SET classification=excluded.classification,note=excluded.note,
                                 updated_by=excluded.updated_by,updated_at=now()
                   RETURNING *""",
                (
                    principal.business_id,
                    data.product_id,
                    data.classification_date,
                    data.classification,
                    data.note,
                    principal.user_id,
                    principal.user_id,
                ),
            ).fetchone()
            self.conn.execute(
                """INSERT INTO sales_day_quality_audit
                   (business_id,quality_id,product_id,classification_date,previous_classification,
                    classification,previous_note,note,action,changed_by)
                   VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    principal.business_id,
                    row["id"],
                    data.product_id,
                    data.classification_date,
                    old["classification"] if old else None,
                    data.classification,
                    old["note"] if old else None,
                    data.note,
                    "updated" if old else "created",
                    principal.user_id,
                ),
            )
        return self._quality_row(row)

    def delete_data_quality(self, principal: Principal, data: DataQualityDelete):
        with self.conn.transaction():
            old = self.conn.execute(
                """DELETE FROM sales_day_quality WHERE business_id=%s
                   AND product_id IS NOT DISTINCT FROM %s AND classification_date=%s RETURNING *""",
                (principal.business_id, data.product_id, data.classification_date),
            ).fetchone()
            if not old:
                raise HTTPException(404, "Classification not found")
            self.conn.execute(
                """INSERT INTO sales_day_quality_audit
                   (business_id,quality_id,product_id,classification_date,previous_classification,
                    previous_note,action,changed_by) VALUES(%s,%s,%s,%s,%s,%s,'deleted',%s)""",
                (
                    principal.business_id,
                    old["id"],
                    old["product_id"],
                    old["classification_date"],
                    old["classification"],
                    old["note"],
                    principal.user_id,
                ),
            )
        return {"deleted": True}

    def data_quality_audit(self, business_id: str):
        return self.conn.execute(
            """SELECT a.id,a.product_id,p.sku,a.classification_date,a.previous_classification,
                      a.classification,a.previous_note,a.note,a.action,a.changed_at,u.email AS changed_by
               FROM sales_day_quality_audit a
               LEFT JOIN products p ON p.business_id=a.business_id AND p.id=a.product_id
               JOIN users u ON u.business_id=a.business_id AND u.id=a.changed_by
               WHERE a.business_id=%s ORDER BY a.changed_at DESC,a.id DESC""",
            (business_id,),
        ).fetchall()

    @staticmethod
    def _quality_row(row):
        return {
            "id": str(row["id"]),
            "productId": str(row["product_id"]) if row["product_id"] else None,
            "sku": row.get("sku"),
            "productName": row.get("name"),
            "classificationDate": str(row["classification_date"]),
            "classification": row["classification"],
            "note": row["note"],
            "createdAt": row["created_at"].isoformat(),
            "updatedAt": row["updated_at"].isoformat(),
        }

    def list_products(self, business_id: str):
        rows = self.conn.execute(
            "SELECT * FROM products WHERE business_id=%s ORDER BY name,id", (business_id,)
        ).fetchall()
        return [product_row(row) for row in rows]

    def get_business(self, business_id: str):
        row = self.conn.execute(
            "SELECT id,name,location,data_origin,is_active FROM businesses WHERE id=%s",
            (business_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Business not found")
        return self._business(row)

    def update_business(self, business_id: str, data: BusinessUpdate):
        fields = data.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(422, "At least one field is required")
        if "name" in fields:
            if fields["name"] is None or not fields["name"].strip():
                raise HTTPException(422, "Business name is required")
            fields["name"] = fields["name"].strip()
        if "location" in fields and fields["location"] is not None:
            fields["location"] = fields["location"].strip() or None
        assignments = ",".join(f"{name}=%s" for name in fields)
        row = self.conn.execute(
            f"UPDATE businesses SET {assignments} WHERE id=%s RETURNING id,name,location,data_origin,is_active",
            (*fields.values(), business_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Business not found")
        return self._business(row)

    def create_product(self, principal: Principal, data: ProductCreate):
        with self.conn.transaction():
            row = self.conn.execute(
                """INSERT INTO products
                (business_id,sku,name,category,unit,current_stock,lead_time_days,safety_stock,unit_cost)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                (
                    principal.business_id,
                    data.sku.strip(),
                    data.name.strip(),
                    data.category.strip(),
                    data.unit.strip(),
                    data.current_stock,
                    data.lead_time_days,
                    data.safety_stock,
                    data.unit_cost,
                ),
            ).fetchone()
            if data.current_stock > 0:
                self.conn.execute(
                    """INSERT INTO inventory_movements
                    (business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,
                     data_origin,note,recorded_by)
                    SELECT %s,%s,%s,'opening_balance',%s,%s,data_origin,
                           'Initial product balance',%s FROM businesses WHERE id=%s""",
                    (
                        principal.business_id,
                        row["id"],
                        self.business_day(principal.business_id),
                        data.current_stock,
                        data.current_stock,
                        principal.user_id,
                        principal.business_id,
                    ),
                )
        return product_row(row)

    def update_product(self, principal: Principal, product_id: UUID, data: ProductUpdate):
        fields = data.model_dump(exclude_none=True)
        if not fields:
            raise HTTPException(422, "At least one field is required")
        names = {
            "current_stock",
            "lead_time_days",
            "safety_stock",
            "unit_cost",
            "is_active",
            "sku",
            "name",
            "category",
            "unit",
        }
        if not set(fields) <= names:
            raise HTTPException(422, "Unsupported product field")
        with self.conn.transaction():
            previous = self.conn.execute(
                "SELECT * FROM products WHERE business_id=%s AND id=%s FOR UPDATE",
                (principal.business_id, product_id),
            ).fetchone()
            if not previous:
                raise HTTPException(404, "Product not found")
            assignments = ",".join(f"{name}=%s" for name in fields)
            row = self.conn.execute(
                f"UPDATE products SET {assignments} WHERE business_id=%s AND id=%s RETURNING *",
                (*fields.values(), principal.business_id, product_id),
            ).fetchone()
            delta = row["current_stock"] - previous["current_stock"]
            if delta:
                self.conn.execute(
                    """INSERT INTO inventory_movements
                    (business_id,product_id,movement_date,movement_type,quantity_delta,
                     balance_after,data_origin,note,recorded_by)
                    SELECT %s,%s,%s,'adjustment',%s,%s,data_origin,%s,%s
                    FROM businesses WHERE id=%s""",
                    (
                        principal.business_id,
                        product_id,
                        self.business_day(principal.business_id),
                        delta,
                        row["current_stock"],
                        "Catalog stock count adjustment",
                        principal.user_id,
                        principal.business_id,
                    ),
                )
        return product_row(row)

    def import_inventory(self, principal: Principal, data: InventoryImportCreate):
        created = updated = 0
        with self.conn.transaction():
            # Serialize imports/catalog counts within a business; the whole snapshot is atomic.
            self.conn.execute(
                "SELECT id FROM businesses WHERE id=%s FOR NO KEY UPDATE", (principal.business_id,)
            )
            for item in data.rows:
                existing = self.conn.execute(
                    "SELECT id FROM products WHERE business_id=%s AND lower(sku)=lower(%s)",
                    (principal.business_id, item.sku.strip()),
                ).fetchone()
                if existing:
                    self.update_product(
                        principal,
                        existing["id"],
                        ProductUpdate(**item.model_dump(), is_active=True),
                    )
                    updated += 1
                else:
                    self.create_product(principal, item)
                    created += 1
        return {"created": created, "updated": updated}

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
                (
                    principal.business_id,
                    data.product_id,
                    data.sale_date,
                    data.quantity,
                    principal.user_id,
                    principal.business_id,
                ),
            ).fetchone()
            self.conn.execute(
                "UPDATE products SET current_stock=%s WHERE id=%s", (balance, data.product_id)
            )
            self.conn.execute(
                """INSERT INTO inventory_movements
                (business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,
                 data_origin,sale_id,recorded_by)
                SELECT %s,%s,%s,'sale',%s,%s,data_origin,%s,%s FROM businesses WHERE id=%s""",
                (
                    principal.business_id,
                    data.product_id,
                    data.sale_date,
                    -data.quantity,
                    balance,
                    sale["id"],
                    principal.user_id,
                    principal.business_id,
                ),
            )
        return {
            "id": str(sale["id"]),
            "businessId": principal.business_id,
            "productId": str(data.product_id),
            "saleDate": str(data.sale_date),
            "quantity": decimal_text(data.quantity),
            "source": "manual",
            "dataOrigin": sale["data_origin"],
        }

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
            self.conn.execute(
                "UPDATE products SET current_stock=%s WHERE id=%s", (balance, data.product_id)
            )
            row = self.conn.execute(
                """INSERT INTO inventory_movements
                (business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,
                 data_origin,note,recorded_by)
                SELECT %s,%s,%s,%s,%s,%s,data_origin,%s,%s FROM businesses WHERE id=%s RETURNING *""",
                (
                    principal.business_id,
                    data.product_id,
                    data.movement_date,
                    data.movement_type,
                    data.quantity_delta,
                    balance,
                    data.note,
                    principal.user_id,
                    principal.business_id,
                ),
            ).fetchone()
        return self._movement(row)

    def list_sales(self, business_id: str, limit: int, offset: int):
        rows = self.conn.execute(
            "SELECT * FROM sales WHERE business_id=%s ORDER BY sale_date DESC,id DESC LIMIT %s OFFSET %s",
            (business_id, limit, offset),
        ).fetchall()
        return [
            {
                "id": str(r["id"]),
                "productId": str(r["product_id"]),
                "saleDate": str(r["sale_date"]),
                "quantity": decimal_text(r["quantity"]),
                "source": r["source"],
                "dataOrigin": r["data_origin"],
            }
            for r in rows
        ]

    def export_sales(self, business_id: str):
        return self.conn.execute(
            """SELECT s.id,p.sku,s.sale_date,s.quantity,s.source,s.data_origin
               FROM sales s JOIN products p ON p.business_id=s.business_id AND p.id=s.product_id
               WHERE s.business_id=%s ORDER BY s.sale_date,s.id""",
            (business_id,),
        ).fetchall()

    def export_movements(self, business_id: str):
        return self.conn.execute(
            """SELECT m.id,p.sku,m.movement_date,m.movement_type,m.quantity_delta,
                      m.balance_after,m.data_origin,m.note
               FROM inventory_movements m
               JOIN products p ON p.business_id=m.business_id AND p.id=m.product_id
               WHERE m.business_id=%s ORDER BY m.movement_date,m.created_at,m.id""",
            (business_id,),
        ).fetchall()

    def list_movements(self, business_id: str, limit: int, offset: int):
        rows = self.conn.execute(
            "SELECT * FROM inventory_movements WHERE business_id=%s ORDER BY movement_date DESC,created_at DESC,id DESC LIMIT %s OFFSET %s",
            (business_id, limit, offset),
        ).fetchall()
        return [self._movement(r) for r in rows]

    def get_settings(self, business_id: str):
        row = self.conn.execute(
            "SELECT * FROM business_settings WHERE business_id=%s", (business_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Settings not found")
        return {
            "businessId": str(row["business_id"]),
            "movingAverageWindow": row["moving_average_window"],
            "forecastHorizonDays": row["forecast_horizon_days"],
            "targetCoverDays": row["target_cover_days"],
            "minimumHistoryWeeks": row["minimum_history_weeks"],
            "minimumNonzeroDays": row["minimum_nonzero_days"],
            "topNProducts": row["top_n_products"],
            "cvFolds": row["cv_folds"],
            "timezone": row["timezone"],
        }

    def put_settings(self, business_id: str, data: SettingsUpdate):
        values = data.model_dump(exclude={"business_name", "business_location"})
        with self.conn.transaction():
            row = self.conn.execute(
                """UPDATE business_settings SET moving_average_window=%s,forecast_horizon_days=%s,
                target_cover_days=%s,minimum_history_weeks=%s,minimum_nonzero_days=%s,
                top_n_products=%s,cv_folds=%s,timezone=%s WHERE business_id=%s RETURNING *""",
                (*values.values(), business_id),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Settings not found")
            profile = {}
            if data.business_name is not None:
                profile["name"] = data.business_name
            if data.business_location is not None:
                profile["location"] = data.business_location
            if profile:
                self.update_business(business_id, BusinessUpdate(**profile))
        return self.get_settings(business_id)

    def create_sales_import(self, principal: Principal, data: SalesImportCreate):
        canonical = json.dumps(
            {"source": data.source, "rows": [row.model_dump(mode="json") for row in data.rows]},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        digest = hashlib.sha256(canonical).hexdigest()
        existing = self.conn.execute(
            "SELECT id FROM data_imports WHERE business_id=%s AND content_sha256=%s",
            (principal.business_id, digest),
        ).fetchone()
        if existing:
            raise HTTPException(409, f"This import was already submitted as {existing['id']}")

        sku_rows = self.conn.execute(
            "SELECT id,lower(sku) AS sku FROM products WHERE business_id=%s AND is_active",
            (principal.business_id,),
        ).fetchall()
        product_by_sku = {row["sku"]: row["id"] for row in sku_rows}
        errors = []
        accepted = []
        seen_keys: set[str] = set()
        for number, item in enumerate(data.rows, start=1):
            product_id = product_by_sku.get(item.sku.strip().lower())
            if not product_id:
                errors.append({"row": number, "code": "unknown_sku", "sku": item.sku})
                continue
            if item.source_record_key and item.source_record_key in seen_keys:
                errors.append({"row": number, "code": "duplicate_source_record_key"})
                continue
            if item.source_record_key:
                seen_keys.add(item.source_record_key)
            accepted.append((number, item, product_id))

        source_map = {
            "csv": "csv_import",
            "pos_export": "pos_import",
            "spreadsheet": "csv_import",
            "migration": "migration",
        }
        with self.conn.transaction():
            batch = self.conn.execute(
                """INSERT INTO data_imports
                (business_id,source,data_origin,original_filename,content_sha256,status,total_rows,
                 accepted_rows,rejected_rows,error_summary,imported_by,started_at,completed_at)
                SELECT %s,%s,data_origin,%s,%s,'processing',%s,0,0,'[]'::jsonb,%s,now(),NULL
                FROM businesses WHERE id=%s RETURNING *""",
                (
                    principal.business_id,
                    data.source,
                    data.original_filename,
                    digest,
                    len(data.rows),
                    principal.user_id,
                    principal.business_id,
                ),
            ).fetchone()
            for number, item, product_id in accepted:
                self.conn.execute(
                    """INSERT INTO sales
                    (business_id,product_id,sale_date,quantity,source,data_origin,import_id,
                     source_row_number,source_record_key,recorded_by)
                    SELECT %s,%s,%s,%s,%s,data_origin,%s,%s,%s,%s
                    FROM businesses WHERE id=%s""",
                    (
                        principal.business_id,
                        product_id,
                        item.sale_date,
                        item.quantity,
                        source_map[data.source],
                        batch["id"],
                        number,
                        item.source_record_key,
                        principal.user_id,
                        principal.business_id,
                    ),
                )
            batch = self.conn.execute(
                """UPDATE data_imports SET status='completed',accepted_rows=%s,rejected_rows=%s,
                   error_summary=%s,completed_at=now() WHERE id=%s RETURNING *""",
                (len(accepted), len(errors), Jsonb(errors), batch["id"]),
            ).fetchone()
        return self._data_import(batch)

    def list_data_imports(self, business_id: str, limit: int, offset: int):
        rows = self.conn.execute(
            "SELECT * FROM data_imports WHERE business_id=%s ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s",
            (business_id, limit, offset),
        ).fetchall()
        return [self._data_import(row) for row in rows]

    def get_data_import(self, business_id: str, import_id: UUID):
        row = self.conn.execute(
            "SELECT * FROM data_imports WHERE business_id=%s AND id=%s", (business_id, import_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Import not found")
        return self._data_import(row)

    def create_forecast_run(self, principal: Principal, data: ForecastRunCreate):
        self.conn.execute(
            "SELECT id FROM businesses WHERE id=%s FOR NO KEY UPDATE", (principal.business_id,)
        )
        pending = self.conn.execute(
            "SELECT id FROM forecast_runs WHERE business_id=%s AND status IN ('queued','running')",
            (principal.business_id,),
        ).fetchone()
        if pending:
            raise HTTPException(409, "A forecast run is already queued or running")
        snapshot = self.conn.execute(
            """SELECT count(*) AS sales_count,min(sale_date) AS first_sale_date,
               max(sale_date) AS last_sale_date FROM sales WHERE business_id=%s
               AND sale_date<=%s""",
            (principal.business_id, data.final_test_end),
        ).fetchone()
        daily_rows = self.conn.execute(
            """SELECT product_id,sale_date,sum(quantity) AS quantity FROM sales
               WHERE business_id=%s AND sale_date BETWEEN %s AND %s
               GROUP BY product_id,sale_date ORDER BY product_id,sale_date""",
            (principal.business_id, data.training_start, data.final_test_end),
        ).fetchall()
        settings = self.conn.execute(
            "SELECT * FROM business_settings WHERE business_id=%s", (principal.business_id,)
        ).fetchone()
        quality_rows = self.conn.execute(
            """SELECT product_id,classification_date,classification,note FROM sales_day_quality
               WHERE business_id=%s AND classification_date BETWEEN %s AND %s
               ORDER BY classification_date,product_id NULLS FIRST""",
            (principal.business_id, data.training_start, data.final_test_end),
        ).fetchall()
        product_ids = [
            str(row["id"])
            for row in self.conn.execute(
                "SELECT id FROM products WHERE business_id=%s AND is_active ORDER BY id",
                (principal.business_id,),
            ).fetchall()
        ]
        row = self.conn.execute(
            """INSERT INTO forecast_runs
            (business_id,data_origin,status,algorithm_name,algorithm_version,xgboost_verified,
             training_start,training_end,validation_start,validation_end,final_test_start,
             final_test_end,forecast_horizon_days,configuration,data_snapshot,requested_by)
            SELECT %s,data_origin,'queued','xgboost.XGBRegressor',NULL,false,%s,%s,%s,%s,%s,%s,
                   %s,%s,%s,%s FROM businesses WHERE id=%s RETURNING *""",
            (
                principal.business_id,
                data.training_start,
                data.training_end,
                data.validation_start,
                data.validation_end,
                data.final_test_start,
                data.final_test_end,
                data.forecast_horizon_days,
                Jsonb(data.configuration),
                Jsonb(
                    {
                        "salesCount": snapshot["sales_count"],
                        "firstSaleDate": str(snapshot["first_sale_date"])
                        if snapshot["first_sale_date"]
                        else None,
                        "lastSaleDate": str(snapshot["last_sale_date"])
                        if snapshot["last_sale_date"]
                        else None,
                        "capturedAt": datetime.now(UTC).isoformat(),
                        "products": product_ids,
                        "settings": {
                            key: value
                            for key, value in settings.items()
                            if key not in {"business_id", "updated_at", "created_at"}
                        },
                        "dataQuality": [
                            {
                                "productId": str(item["product_id"])
                                if item["product_id"]
                                else None,
                                "date": str(item["classification_date"]),
                                "classification": item["classification"],
                                "note": item["note"],
                            }
                            for item in quality_rows
                        ],
                        "dailySales": [
                            {
                                "productId": str(row["product_id"]),
                                "date": str(row["sale_date"]),
                                "quantity": decimal_text(row["quantity"]),
                            }
                            for row in daily_rows
                        ],
                    }
                ),
                principal.user_id,
                principal.business_id,
            ),
        ).fetchone()
        return self._forecast_run(row)

    def refresh_forecast(self, principal: Principal):
        span = self.conn.execute(
            "SELECT min(sale_date) AS start,max(sale_date) AS finish FROM sales WHERE business_id=%s",
            (principal.business_id,),
        ).fetchone()
        if not span["start"]:
            raise HTTPException(422, "Add or import sales before refreshing forecasts")
        end = span["finish"]
        if end > self.business_day(principal.business_id):
            raise HTTPException(422, "Forecast history cannot include future-dated sales")
        days = (end - span["start"]).days + 1
        if days < 3:
            raise HTTPException(
                422,
                "At least three calendar days are needed for train/validation/test; the baseline remains available",
            )
        holdout = max(1, min(14, days // 5))
        settings = self.get_settings(principal.business_id)
        return self.create_forecast_run(
            principal,
            ForecastRunCreate(
                training_start=span["start"],
                training_end=end - timedelta(days=2 * holdout),
                validation_start=end - timedelta(days=2 * holdout - 1),
                validation_end=end - timedelta(days=holdout),
                final_test_start=end - timedelta(days=holdout - 1),
                final_test_end=end,
                forecast_horizon_days=settings["forecastHorizonDays"],
                configuration={
                    "requestedFrom": "web",
                    "missingDayPolicy": "explicit_classification_required",
                },
            ),
        )

    def list_forecast_runs(self, business_id: str, limit: int, offset: int):
        rows = self.conn.execute(
            "SELECT * FROM forecast_runs WHERE business_id=%s ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s",
            (business_id, limit, offset),
        ).fetchall()
        return [self._forecast_run(row) for row in rows]

    def get_forecast_run(self, business_id: str, run_id: UUID):
        row = self.conn.execute(
            "SELECT * FROM forecast_runs WHERE business_id=%s AND id=%s", (business_id, run_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Forecast run not found")
        return self._forecast_run(row)

    def list_predictions(self, business_id: str, run_id: UUID, limit: int, offset: int):
        self.get_forecast_run(business_id, run_id)
        rows = self.conn.execute(
            """SELECT * FROM forecast_predictions WHERE business_id=%s AND forecast_run_id=%s
               ORDER BY prediction_date,product_id,method LIMIT %s OFFSET %s""",
            (business_id, run_id, limit, offset),
        ).fetchall()
        return [self._prediction(row) for row in rows]

    def list_metrics(self, business_id: str, run_id: UUID):
        self.get_forecast_run(business_id, run_id)
        rows = self.conn.execute(
            """SELECT * FROM forecast_metrics WHERE business_id=%s AND forecast_run_id=%s
               ORDER BY dataset_split,method,product_id NULLS FIRST""",
            (business_id, run_id),
        ).fetchall()
        return [self._metric(row) for row in rows]

    def generate_recommendations(self, principal: Principal, data: RecommendationGenerate):
        settings = self.conn.execute(
            "SELECT target_cover_days FROM business_settings WHERE business_id=%s",
            (principal.business_id,),
        ).fetchone()
        if not settings:
            raise HTTPException(404, "Settings not found")
        start = data.recommendation_date - timedelta(days=data.lookback_days - 1)
        products = self.conn.execute(
            """SELECT p.*,coalesce(sum(s.quantity),0) AS recent_quantity
               FROM products p LEFT JOIN sales s ON s.business_id=p.business_id
               AND s.product_id=p.id AND s.sale_date BETWEEN %s AND %s
               WHERE p.business_id=%s AND p.is_active GROUP BY p.id ORDER BY p.name,p.id""",
            (start, data.recommendation_date, principal.business_id),
        ).fetchall()
        results = []
        with self.conn.transaction():
            self.conn.execute(
                """DELETE FROM reorder_recommendations WHERE business_id=%s
                   AND recommendation_date=%s AND method='rule' AND forecast_run_id IS NULL""",
                (principal.business_id, data.recommendation_date),
            )
            for product in products:
                calculation = calculate_reorder(
                    current_stock=product["current_stock"],
                    recent_quantity=Decimal(product["recent_quantity"]),
                    lookback_days=data.lookback_days,
                    lead_time_days=product["lead_time_days"],
                    safety_stock=product["safety_stock"],
                    target_cover_days=settings["target_cover_days"],
                )
                daily = calculation["daily_demand"]
                lead_demand = calculation["demand_during_lead_time"]
                reorder_point = calculation["reorder_point"]
                target = calculation["target_stock"]
                suggested = calculation["suggested_quantity"]
                status = calculation["status"]
                row = self.conn.execute(
                    """INSERT INTO reorder_recommendations
                    (business_id,product_id,forecast_run_id,method,recommendation_date,
                     forecast_daily_demand,current_stock,lead_time_days,safety_stock,
                     target_cover_days,demand_during_lead_time,reorder_point,target_stock,
                     suggested_quantity,status,confidence_level,calculation_version)
                    VALUES(%s,%s,NULL,'rule',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'low','rule-v1')
                    RETURNING *""",
                    (
                        principal.business_id,
                        product["id"],
                        data.recommendation_date,
                        daily,
                        product["current_stock"],
                        product["lead_time_days"],
                        product["safety_stock"],
                        settings["target_cover_days"],
                        lead_demand,
                        reorder_point,
                        target,
                        suggested,
                        status,
                    ),
                ).fetchone()
                if row:
                    results.append(self._recommendation(row))
        return results

    def list_recommendations(self, business_id: str, limit: int, offset: int):
        rows = self.conn.execute(
            """SELECT * FROM reorder_recommendations WHERE business_id=%s
               ORDER BY recommendation_date DESC,created_at DESC,id DESC LIMIT %s OFFSET %s""",
            (business_id, limit, offset),
        ).fetchall()
        return [self._recommendation(row) for row in rows]

    @staticmethod
    def _principal(row):
        return Principal(
            str(row["id"]), str(row["business_id"]), row["email"], row["display_name"], row["role"]
        )

    @staticmethod
    def _business(row):
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "location": row["location"],
            "dataOrigin": row["data_origin"],
            "isActive": row["is_active"],
        }

    @staticmethod
    def _data_import(row):
        return {
            "id": str(row["id"]),
            "businessId": str(row["business_id"]),
            "source": row["source"],
            "dataOrigin": row["data_origin"],
            "originalFilename": row["original_filename"],
            "contentSha256": row["content_sha256"],
            "status": row["status"],
            "totalRows": row["total_rows"],
            "acceptedRows": row["accepted_rows"],
            "rejectedRows": row["rejected_rows"],
            "errors": row["error_summary"],
            "createdAt": row["created_at"].isoformat(),
        }

    @staticmethod
    def _forecast_run(row):
        return {
            "id": str(row["id"]),
            "businessId": str(row["business_id"]),
            "dataOrigin": row["data_origin"],
            "status": row["status"],
            "algorithmName": row["algorithm_name"],
            "algorithmVersion": row["algorithm_version"],
            "xgboostVerified": row["xgboost_verified"],
            "trainingStart": str(row["training_start"]),
            "trainingEnd": str(row["training_end"]),
            "validationStart": str(row["validation_start"]),
            "validationEnd": str(row["validation_end"]),
            "finalTestStart": str(row["final_test_start"]),
            "finalTestEnd": str(row["final_test_end"]),
            "forecastHorizonDays": row["forecast_horizon_days"],
            "configuration": row["configuration"],
            "dataSnapshot": row["data_snapshot"],
            "failureMessage": row["failure_message"],
            "timing": row.get("timing", {}),
            "createdAt": row["created_at"].isoformat(),
        }

    @staticmethod
    def _prediction(row):
        return {
            "id": str(row["id"]),
            "productId": str(row["product_id"]),
            "predictionDate": str(row["prediction_date"]),
            "method": row["method"],
            "datasetSplit": row["dataset_split"],
            "predictedQuantity": decimal_text(row["predicted_quantity"]),
            "actualQuantity": decimal_text(row["actual_quantity"])
            if row["actual_quantity"] is not None
            else None,
            "lowerBound": decimal_text(row["lower_bound"])
            if row["lower_bound"] is not None
            else None,
            "upperBound": decimal_text(row["upper_bound"])
            if row["upper_bound"] is not None
            else None,
            "fallbackReason": row["fallback_reason"],
        }

    @staticmethod
    def _metric(row):
        return {
            "id": str(row["id"]),
            "productId": str(row["product_id"]) if row["product_id"] else None,
            "method": row["method"],
            "datasetSplit": row["dataset_split"],
            "mae": decimal_text(row["mae"]),
            "rmse": decimal_text(row["rmse"]),
            "observationCount": row["observation_count"],
        }

    @staticmethod
    def _recommendation(row):
        decimal_fields = (
            "forecast_daily_demand",
            "current_stock",
            "safety_stock",
            "demand_during_lead_time",
            "reorder_point",
            "target_stock",
            "suggested_quantity",
        )
        result = {
            "id": str(row["id"]),
            "productId": str(row["product_id"]),
            "forecastRunId": str(row["forecast_run_id"]) if row["forecast_run_id"] else None,
            "method": row["method"],
            "recommendationDate": str(row["recommendation_date"]),
            "leadTimeDays": row["lead_time_days"],
            "targetCoverDays": row["target_cover_days"],
            "status": row["status"],
            "confidenceLevel": row["confidence_level"],
            "calculationVersion": row["calculation_version"],
        }
        for field in decimal_fields:
            result[
                "".join([field.split("_")[0], *[part.title() for part in field.split("_")[1:]]])
            ] = decimal_text(row[field])
        return result

    @staticmethod
    def _movement(row):
        return {
            "id": str(row["id"]),
            "businessId": str(row["business_id"]),
            "productId": str(row["product_id"]),
            "movementDate": str(row["movement_date"]),
            "movementType": row["movement_type"],
            "quantityDelta": decimal_text(row["quantity_delta"]),
            "balanceAfter": decimal_text(row["balance_after"]),
            "dataOrigin": row["data_origin"],
            "saleId": str(row["sale_id"]) if row["sale_id"] else None,
            "note": row["note"],
            "recordedBy": str(row["recorded_by"]) if row["recorded_by"] else None,
        }
