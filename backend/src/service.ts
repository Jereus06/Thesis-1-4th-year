import { DomainError, type BusinessSettingsRecord } from "./domain.ts";
import type { StockCastRepository } from "./repository.ts";
import {
  createProductSchema,
  movementSchema,
  saleSchema,
  settingsSchema,
  updateProductSchema,
  uuid,
} from "./schemas.ts";

export class StockCastService {
  private readonly repository: StockCastRepository;

  constructor(repository: StockCastRepository) {
    this.repository = repository;
  }

  private async origin(businessId: string) {
    uuid.parse(businessId);
    const origin = await this.repository.getBusinessOrigin(businessId);
    if (!origin) throw new DomainError("not_found", "Business not found");
    return origin;
  }

  async listProducts(businessId: string) {
    await this.origin(businessId);
    return this.repository.listProducts(businessId);
  }

  async createProduct(businessId: string, body: unknown, actorId: string | null = null) {
    const origin = await this.origin(businessId);
    return this.repository.createProduct(
      businessId,
      origin,
      createProductSchema.parse(body),
      actorId,
    );
  }

  async updateProduct(businessId: string, productId: string, body: unknown) {
    await this.origin(businessId);
    uuid.parse(productId);
    const product = await this.repository.updateProduct(
      businessId,
      productId,
      updateProductSchema.parse(body),
    );
    if (!product) throw new DomainError("not_found", "Product not found");
    return product;
  }

  async getSettings(businessId: string) {
    await this.origin(businessId);
    const settings = await this.repository.getSettings(businessId);
    if (!settings) throw new DomainError("not_found", "Business settings not found");
    return settings;
  }

  async putSettings(businessId: string, body: unknown) {
    await this.origin(businessId);
    const parsed = settingsSchema.parse(body);
    return this.repository.putSettings({ businessId, ...parsed } satisfies BusinessSettingsRecord);
  }

  async listSales(businessId: string) {
    await this.origin(businessId);
    return this.repository.listSales(businessId);
  }

  async recordSale(businessId: string, body: unknown, actorId: string | null = null) {
    const origin = await this.origin(businessId);
    const parsed = saleSchema.parse(body);
    return this.repository.recordManualSale({ businessId, origin, actorId, ...parsed });
  }

  async listMovements(businessId: string) {
    await this.origin(businessId);
    return this.repository.listMovements(businessId);
  }

  async recordMovement(businessId: string, body: unknown, actorId: string | null = null) {
    const origin = await this.origin(businessId);
    const parsed = movementSchema.parse(body);
    const delta = Number(parsed.quantityDelta);
    if ((parsed.movementType === "receipt" || parsed.movementType === "return") && delta < 0)
      throw new DomainError("conflict", `${parsed.movementType} must increase stock`);
    if (parsed.movementType === "write_off" && delta > 0)
      throw new DomainError("conflict", "A write-off must decrease stock");
    if (parsed.movementType === "opening_balance")
      throw new DomainError("conflict", "Opening balances are created with products");
    return this.repository.recordMovement({ businessId, origin, actorId, ...parsed });
  }
}
