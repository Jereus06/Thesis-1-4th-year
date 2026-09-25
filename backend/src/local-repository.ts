import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  DomainError,
  type BusinessSettingsRecord,
  type DataOrigin,
  type MovementRecord,
  type ProductRecord,
  type SaleRecord,
} from "./domain.ts";
import type { CreateProductInput, StockCastRepository, UpdateProductInput } from "./repository.ts";

const localSchema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, data_origin TEXT NOT NULL CHECK(data_origin IN ('demo','partner')), is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), sku TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL, current_stock TEXT NOT NULL, lead_time_days INTEGER NOT NULL, safety_stock TEXT NOT NULL, unit_cost TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, UNIQUE(business_id, sku));
CREATE TABLE IF NOT EXISTS business_settings (business_id TEXT PRIMARY KEY REFERENCES businesses(id), moving_average_window INTEGER NOT NULL, forecast_horizon_days INTEGER NOT NULL, target_cover_days INTEGER NOT NULL, minimum_history_weeks INTEGER NOT NULL, minimum_nonzero_days INTEGER NOT NULL, top_n_products INTEGER NOT NULL, cv_folds INTEGER NOT NULL, timezone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), product_id TEXT NOT NULL REFERENCES products(id), sale_date TEXT NOT NULL, quantity TEXT NOT NULL, data_origin TEXT NOT NULL, recorded_by TEXT);
CREATE TABLE IF NOT EXISTS inventory_movements (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), product_id TEXT NOT NULL REFERENCES products(id), movement_date TEXT NOT NULL, movement_type TEXT NOT NULL, quantity_delta TEXT NOT NULL, balance_after TEXT NOT NULL, data_origin TEXT NOT NULL, sale_id TEXT REFERENCES sales(id), note TEXT, recorded_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS local_sales_product_date ON sales(product_id, sale_date, id);
CREATE INDEX IF NOT EXISTS local_movements_product_date ON inventory_movements(product_id, movement_date, created_at, id);
`;

type Row = Record<string, unknown>;

export class LocalStockCastRepository implements StockCastRepository {
  readonly database: DatabaseSync;

  constructor(filename: string) {
    this.database = new DatabaseSync(filename);
    this.database.exec(localSchema);
  }

  close() {
    this.database.close();
  }

  bootstrapDemo(businessId: string, name = "StockCast Demo Store") {
    this.database
      .prepare("INSERT OR IGNORE INTO businesses (id,name,data_origin) VALUES (?,?,'demo')")
      .run(businessId, name);
    this.database
      .prepare(`INSERT OR IGNORE INTO business_settings VALUES (?,7,14,7,8,100,8,3,'Asia/Manila')`)
      .run(businessId);
  }

  async getBusinessOrigin(businessId: string) {
    const row = this.database
      .prepare("SELECT data_origin FROM businesses WHERE id=? AND is_active=1")
      .get(businessId) as Row | undefined;
    return (row?.data_origin as DataOrigin | undefined) ?? null;
  }

  async listProducts(businessId: string) {
    return (
      this.database
        .prepare("SELECT * FROM products WHERE business_id=? ORDER BY name,id")
        .all(businessId) as Row[]
    ).map(mapProduct);
  }

  async createProduct(
    businessId: string,
    origin: DataOrigin,
    input: CreateProductInput,
    actorId: string | null,
  ) {
    return this.transaction(() => {
      const id = randomUUID();
      this.database
        .prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,1)")
        .run(
          id,
          businessId,
          input.sku,
          input.name,
          input.category,
          input.unit,
          input.currentStock,
          input.leadTimeDays,
          input.safetyStock,
          input.unitCost,
        );
      if (Number(input.currentStock) > 0)
        this.insertMovement({
          businessId,
          productId: id,
          movementDate: today(),
          movementType: "opening_balance",
          quantityDelta: input.currentStock,
          balanceAfter: input.currentStock,
          origin,
          saleId: null,
          note: "Initial product balance",
          actorId,
        });
      return mapProduct(this.database.prepare("SELECT * FROM products WHERE id=?").get(id) as Row);
    });
  }

  async updateProduct(businessId: string, productId: string, input: UpdateProductInput) {
    const allowed: Record<string, string> = {
      sku: "sku",
      name: "name",
      category: "category",
      unit: "unit",
      leadTimeDays: "lead_time_days",
      safetyStock: "safety_stock",
      unitCost: "unit_cost",
      isActive: "is_active",
    };
    const entries = Object.entries(input);
    const assignments = entries.map(([key]) => `${allowed[key]}=?`).join(",");
    this.database
      .prepare(`UPDATE products SET ${assignments} WHERE business_id=? AND id=?`)
      .run(
        ...entries.map(([, value]) => (typeof value === "boolean" ? Number(value) : value)),
        businessId,
        productId,
      );
    const row = this.database
      .prepare("SELECT * FROM products WHERE business_id=? AND id=?")
      .get(businessId, productId) as Row | undefined;
    return row ? mapProduct(row) : null;
  }

  async getSettings(businessId: string) {
    const row = this.database
      .prepare("SELECT * FROM business_settings WHERE business_id=?")
      .get(businessId) as Row | undefined;
    return row ? mapSettings(row) : null;
  }

  async putSettings(value: BusinessSettingsRecord) {
    this.database
      .prepare(
        `INSERT INTO business_settings VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET moving_average_window=excluded.moving_average_window,forecast_horizon_days=excluded.forecast_horizon_days,target_cover_days=excluded.target_cover_days,minimum_history_weeks=excluded.minimum_history_weeks,minimum_nonzero_days=excluded.minimum_nonzero_days,top_n_products=excluded.top_n_products,cv_folds=excluded.cv_folds,timezone=excluded.timezone`,
      )
      .run(
        value.businessId,
        value.movingAverageWindow,
        value.forecastHorizonDays,
        value.targetCoverDays,
        value.minimumHistoryWeeks,
        value.minimumNonzeroDays,
        value.topNProducts,
        value.cvFolds,
        value.timezone,
      );
    return value;
  }

  async listSales(businessId: string) {
    return (
      this.database
        .prepare("SELECT * FROM sales WHERE business_id=? ORDER BY sale_date,id")
        .all(businessId) as Row[]
    ).map(mapSale);
  }

  async recordManualSale(input: Parameters<StockCastRepository["recordManualSale"]>[0]) {
    return this.transaction(() => {
      const row = this.database
        .prepare("SELECT current_stock FROM products WHERE business_id=? AND id=? AND is_active=1")
        .get(input.businessId, input.productId) as Row | undefined;
      if (!row) throw new DomainError("not_found", "Product not found");
      const balance = Number(row.current_stock) - Number(input.quantity);
      if (balance < 0)
        throw new DomainError("insufficient_stock", "Sale quantity exceeds current stock");
      const id = randomUUID();
      this.database
        .prepare("INSERT INTO sales VALUES (?,?,?,?,?,?,?)")
        .run(
          id,
          input.businessId,
          input.productId,
          input.saleDate,
          input.quantity,
          input.origin,
          input.actorId,
        );
      this.database
        .prepare("UPDATE products SET current_stock=? WHERE id=?")
        .run(String(balance), input.productId);
      this.insertMovement({
        ...input,
        movementDate: input.saleDate,
        movementType: "sale",
        quantityDelta: `-${input.quantity}`,
        balanceAfter: String(balance),
        saleId: id,
        note: null,
      });
      return mapSale(this.database.prepare("SELECT * FROM sales WHERE id=?").get(id) as Row);
    });
  }

  async listMovements(businessId: string) {
    return (
      this.database
        .prepare(
          "SELECT * FROM inventory_movements WHERE business_id=? ORDER BY movement_date,rowid",
        )
        .all(businessId) as Row[]
    ).map(mapMovement);
  }

  async recordMovement(input: Parameters<StockCastRepository["recordMovement"]>[0]) {
    return this.transaction(() => {
      const row = this.database
        .prepare("SELECT current_stock FROM products WHERE business_id=? AND id=? AND is_active=1")
        .get(input.businessId, input.productId) as Row | undefined;
      if (!row) throw new DomainError("not_found", "Product not found");
      const balance = Number(row.current_stock) + Number(input.quantityDelta);
      if (balance < 0)
        throw new DomainError("insufficient_stock", "Movement would make stock negative");
      this.database
        .prepare("UPDATE products SET current_stock=? WHERE id=?")
        .run(String(balance), input.productId);
      return this.insertMovement({ ...input, balanceAfter: String(balance), saleId: null });
    });
  }

  private insertMovement(input: {
    businessId: string;
    productId: string;
    movementDate: string;
    movementType: MovementRecord["movementType"];
    quantityDelta: string;
    balanceAfter: string;
    origin: DataOrigin;
    saleId: string | null;
    note: string | null;
    actorId: string | null;
  }) {
    const id = randomUUID();
    this.database
      .prepare(
        "INSERT INTO inventory_movements (id,business_id,product_id,movement_date,movement_type,quantity_delta,balance_after,data_origin,sale_id,note,recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        input.businessId,
        input.productId,
        input.movementDate,
        input.movementType,
        input.quantityDelta,
        input.balanceAfter,
        input.origin,
        input.saleId,
        input.note,
        input.actorId,
      );
    return mapMovement(
      this.database.prepare("SELECT * FROM inventory_movements WHERE id=?").get(id) as Row,
    );
  }

  private transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function mapProduct(row: Row): ProductRecord {
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
function mapSale(row: Row): SaleRecord {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    productId: String(row.product_id),
    saleDate: String(row.sale_date),
    quantity: String(row.quantity),
    source: "manual",
    dataOrigin: row.data_origin as DataOrigin,
    recordedBy: row.recorded_by ? String(row.recorded_by) : null,
  };
}
function mapMovement(row: Row): MovementRecord {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    productId: String(row.product_id),
    movementDate: String(row.movement_date),
    movementType: row.movement_type as MovementRecord["movementType"],
    quantityDelta: String(row.quantity_delta),
    balanceAfter: String(row.balance_after),
    dataOrigin: row.data_origin as DataOrigin,
    saleId: row.sale_id ? String(row.sale_id) : null,
    note: row.note ? String(row.note) : null,
    recordedBy: row.recorded_by ? String(row.recorded_by) : null,
  };
}
function mapSettings(row: Row): BusinessSettingsRecord {
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
function today() {
  return new Date().toISOString().slice(0, 10);
}
