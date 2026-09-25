import {
  DomainError,
  type BusinessSettingsRecord,
  type MovementRecord,
  type ProductRecord,
  type SaleRecord,
} from "./domain.ts";
import type { CreateProductInput, StockCastRepository, UpdateProductInput } from "./repository.ts";

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number | null };
export type Queryable = { query(sql: string, values?: unknown[]): Promise<QueryResult> };
export type PoolLike = Queryable & { connect(): Promise<Queryable & { release(): void }> };

const productColumns = `id, business_id, sku, name, category, unit, current_stock::text,
  lead_time_days, safety_stock::text, unit_cost::text, is_active`;

function product(row: Record<string, unknown>): ProductRecord {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    sku: String(row.sku),
    name: String(row.name),
    category: String(row.category),
    unit: String(row.unit),
    currentStock: String(row.current_stock),
    leadTimeDays: Number(row.lead_time_days),
    safetyStock: String(row.safety_stock),
    unitCost: String(row.unit_cost),
    isActive: Boolean(row.is_active),
  };
}

function sale(row: Record<string, unknown>): SaleRecord {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    productId: String(row.product_id),
    saleDate: String(row.sale_date),
    quantity: String(row.quantity),
    source: "manual",
    dataOrigin: row.data_origin as "demo" | "partner",
    recordedBy: row.recorded_by ? String(row.recorded_by) : null,
  };
}

function movement(row: Record<string, unknown>): MovementRecord {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    productId: String(row.product_id),
    movementDate: String(row.movement_date),
    movementType: row.movement_type as MovementRecord["movementType"],
    quantityDelta: String(row.quantity_delta),
    balanceAfter: String(row.balance_after),
    dataOrigin: row.data_origin as "demo" | "partner",
    saleId: row.sale_id ? String(row.sale_id) : null,
    note: row.note ? String(row.note) : null,
    recordedBy: row.recorded_by ? String(row.recorded_by) : null,
  };
}

export class PostgresStockCastRepository implements StockCastRepository {
  private readonly pool: PoolLike;

  constructor(pool: PoolLike) {
    this.pool = pool;
  }

  async getBusinessOrigin(businessId: string) {
    const result = await this.pool.query(
      "SELECT data_origin FROM businesses WHERE id = $1 AND is_active",
      [businessId],
    );
    return (result.rows[0]?.data_origin as "demo" | "partner" | undefined) ?? null;
  }

  async listProducts(businessId: string) {
    const result = await this.pool.query(
      `SELECT ${productColumns} FROM products WHERE business_id = $1 ORDER BY name, id`,
      [businessId],
    );
    return result.rows.map(product);
  }

  async createProduct(
    businessId: string,
    origin: "demo" | "partner",
    input: CreateProductInput,
    actorId: string | null,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO products (business_id, sku, name, category, unit, current_stock, lead_time_days, safety_stock, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${productColumns}`,
        [
          businessId,
          input.sku,
          input.name,
          input.category,
          input.unit,
          input.currentStock,
          input.leadTimeDays,
          input.safetyStock,
          input.unitCost,
        ],
      );
      const created = product(result.rows[0]);
      if (Number(input.currentStock) > 0) {
        await client.query(
          `INSERT INTO inventory_movements
           (business_id, product_id, movement_date, movement_type, quantity_delta, balance_after, data_origin, note, recorded_by)
           VALUES ($1,$2,CURRENT_DATE,'opening_balance',$3,$3,$4,'Initial product balance',$5)`,
          [businessId, created.id, input.currentStock, origin, actorId],
        );
      }
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateProduct(businessId: string, productId: string, input: UpdateProductInput) {
    const entries = Object.entries(input);
    const columns: Record<string, string> = {
      sku: "sku",
      name: "name",
      category: "category",
      unit: "unit",
      leadTimeDays: "lead_time_days",
      safetyStock: "safety_stock",
      unitCost: "unit_cost",
      isActive: "is_active",
    };
    const sets = entries.map(([key], index) => `${columns[key]} = $${index + 3}`);
    const result = await this.pool.query(
      `UPDATE products SET ${sets.join(", ")} WHERE business_id = $1 AND id = $2 RETURNING ${productColumns}`,
      [businessId, productId, ...entries.map(([, value]) => value)],
    );
    return result.rows[0] ? product(result.rows[0]) : null;
  }

  async getSettings(businessId: string) {
    const result = await this.pool.query("SELECT * FROM business_settings WHERE business_id = $1", [
      businessId,
    ]);
    return result.rows[0] ? this.mapSettings(result.rows[0]) : null;
  }

  async putSettings(settings: BusinessSettingsRecord) {
    const values = [
      settings.businessId,
      settings.movingAverageWindow,
      settings.forecastHorizonDays,
      settings.targetCoverDays,
      settings.minimumHistoryWeeks,
      settings.minimumNonzeroDays,
      settings.topNProducts,
      settings.cvFolds,
      settings.timezone,
    ];
    const result = await this.pool.query(
      `INSERT INTO business_settings (business_id, moving_average_window, forecast_horizon_days, target_cover_days, minimum_history_weeks, minimum_nonzero_days, top_n_products, cv_folds, timezone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (business_id) DO UPDATE SET
       moving_average_window=EXCLUDED.moving_average_window, forecast_horizon_days=EXCLUDED.forecast_horizon_days,
       target_cover_days=EXCLUDED.target_cover_days, minimum_history_weeks=EXCLUDED.minimum_history_weeks,
       minimum_nonzero_days=EXCLUDED.minimum_nonzero_days, top_n_products=EXCLUDED.top_n_products,
       cv_folds=EXCLUDED.cv_folds, timezone=EXCLUDED.timezone RETURNING *`,
      values,
    );
    return this.mapSettings(result.rows[0]);
  }

  async listSales(businessId: string) {
    const result = await this.pool.query(
      "SELECT id,business_id,product_id,sale_date::text,quantity::text,data_origin,recorded_by FROM sales WHERE business_id=$1 ORDER BY sale_date,id",
      [businessId],
    );
    return result.rows.map(sale);
  }

  async recordManualSale(input: Parameters<StockCastRepository["recordManualSale"]>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT current_stock::text FROM products WHERE business_id=$1 AND id=$2 AND is_active FOR UPDATE",
        [input.businessId, input.productId],
      );
      if (!locked.rows[0]) throw new DomainError("not_found", "Product not found");
      const balance = Number(locked.rows[0].current_stock) - Number(input.quantity);
      if (balance < 0)
        throw new DomainError("insufficient_stock", "Sale quantity exceeds current stock");
      const inserted = await client.query(
        "INSERT INTO sales (business_id,product_id,sale_date,quantity,source,data_origin,recorded_by) VALUES ($1,$2,$3,$4,'manual',$5,$6) RETURNING id,business_id,product_id,sale_date::text,quantity::text,data_origin,recorded_by",
        [
          input.businessId,
          input.productId,
          input.saleDate,
          input.quantity,
          input.origin,
          input.actorId,
        ],
      );
      await client.query("UPDATE products SET current_stock=$3 WHERE business_id=$1 AND id=$2", [
        input.businessId,
        input.productId,
        String(balance),
      ]);
      await client.query(
        "INSERT INTO inventory_movements (business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,data_origin,sale_id,recorded_by) VALUES ($1,$2,$3,'sale',$4,$5,$6,$7,$8)",
        [
          input.businessId,
          input.productId,
          input.saleDate,
          `-${input.quantity}`,
          String(balance),
          input.origin,
          inserted.rows[0].id,
          input.actorId,
        ],
      );
      await client.query("COMMIT");
      return sale(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMovements(businessId: string) {
    const result = await this.pool.query(
      "SELECT id,business_id,product_id,movement_date::text,movement_type,quantity_delta::text,balance_after::text,data_origin,sale_id,note,recorded_by FROM inventory_movements WHERE business_id=$1 ORDER BY movement_date,created_at,id",
      [businessId],
    );
    return result.rows.map(movement);
  }

  async recordMovement(input: Parameters<StockCastRepository["recordMovement"]>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT current_stock::text FROM products WHERE business_id=$1 AND id=$2 AND is_active FOR UPDATE",
        [input.businessId, input.productId],
      );
      if (!locked.rows[0]) throw new DomainError("not_found", "Product not found");
      const balance = Number(locked.rows[0].current_stock) + Number(input.quantityDelta);
      if (balance < 0)
        throw new DomainError("insufficient_stock", "Movement would make stock negative");
      await client.query("UPDATE products SET current_stock=$3 WHERE business_id=$1 AND id=$2", [
        input.businessId,
        input.productId,
        String(balance),
      ]);
      const inserted = await client.query(
        "INSERT INTO inventory_movements (business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,data_origin,note,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,business_id,product_id,movement_date::text,movement_type,quantity_delta::text,balance_after::text,data_origin,sale_id,note,recorded_by",
        [
          input.businessId,
          input.productId,
          input.movementDate,
          input.movementType,
          input.quantityDelta,
          String(balance),
          input.origin,
          input.note,
          input.actorId,
        ],
      );
      await client.query("COMMIT");
      return movement(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private mapSettings(row: Record<string, unknown>): BusinessSettingsRecord {
    return {
      businessId: String(row.business_id),
      movingAverageWindow: Number(row.moving_average_window),
      forecastHorizonDays: Number(row.forecast_horizon_days),
      targetCoverDays: Number(row.target_cover_days),
      minimumHistoryWeeks: Number(row.minimum_history_weeks),
      minimumNonzeroDays: Number(row.minimum_nonzero_days),
      topNProducts: Number(row.top_n_products),
      cvFolds: Number(row.cv_folds),
      timezone: String(row.timezone),
    };
  }
}
