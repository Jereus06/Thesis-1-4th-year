export type DataOrigin = "demo" | "partner";
export type InventoryMovementType =
  "opening_balance" | "receipt" | "adjustment" | "return" | "write_off";

export type ProductRecord = {
  id: string;
  businessId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currentStock: string;
  leadTimeDays: number;
  safetyStock: string;
  unitCost: string;
  isActive: boolean;
};

export type SaleRecord = {
  id: string;
  businessId: string;
  productId: string;
  saleDate: string;
  quantity: string;
  source: "manual";
  dataOrigin: DataOrigin;
  recordedBy: string | null;
};

export type MovementRecord = {
  id: string;
  businessId: string;
  productId: string;
  movementDate: string;
  movementType: InventoryMovementType | "sale";
  quantityDelta: string;
  balanceAfter: string;
  dataOrigin: DataOrigin;
  saleId: string | null;
  note: string | null;
  recordedBy: string | null;
};

export type BusinessSettingsRecord = {
  businessId: string;
  movingAverageWindow: number;
  forecastHorizonDays: number;
  targetCoverDays: number;
  minimumHistoryWeeks: number;
  minimumNonzeroDays: number;
  topNProducts: number;
  cvFolds: number;
  timezone: string;
};

export class DomainError extends Error {
  readonly code: "not_found" | "conflict" | "insufficient_stock" | "forbidden";

  constructor(
    code: "not_found" | "conflict" | "insufficient_stock" | "forbidden",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}
