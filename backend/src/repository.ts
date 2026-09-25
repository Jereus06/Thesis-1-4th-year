import type {
  BusinessSettingsRecord,
  DataOrigin,
  InventoryMovementType,
  MovementRecord,
  ProductRecord,
  SaleRecord,
} from "./domain.ts";

export type CreateProductInput = Omit<ProductRecord, "id" | "businessId" | "isActive">;
export type UpdateProductInput = Partial<
  Pick<
    ProductRecord,
    "sku" | "name" | "category" | "unit" | "leadTimeDays" | "safetyStock" | "unitCost" | "isActive"
  >
>;

export interface StockCastRepository {
  getBusinessOrigin(businessId: string): Promise<DataOrigin | null>;
  listProducts(businessId: string): Promise<ProductRecord[]>;
  createProduct(
    businessId: string,
    origin: DataOrigin,
    input: CreateProductInput,
    actorId: string | null,
  ): Promise<ProductRecord>;
  updateProduct(
    businessId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductRecord | null>;
  getSettings(businessId: string): Promise<BusinessSettingsRecord | null>;
  putSettings(settings: BusinessSettingsRecord): Promise<BusinessSettingsRecord>;
  listSales(businessId: string): Promise<SaleRecord[]>;
  recordManualSale(input: {
    businessId: string;
    productId: string;
    saleDate: string;
    quantity: string;
    origin: DataOrigin;
    actorId: string | null;
  }): Promise<SaleRecord>;
  listMovements(businessId: string): Promise<MovementRecord[]>;
  recordMovement(input: {
    businessId: string;
    productId: string;
    movementDate: string;
    movementType: InventoryMovementType;
    quantityDelta: string;
    origin: DataOrigin;
    note: string | null;
    actorId: string | null;
  }): Promise<MovementRecord>;
}
