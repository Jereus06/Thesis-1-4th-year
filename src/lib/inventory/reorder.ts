import type {
  ConfidenceLevel,
  PipelineResult,
  Product,
  ReorderRow,
  Settings,
  StockStatus,
} from "@/lib/types";

export function stockStatus(current: number, rop: number, daysOfCover: number): StockStatus {
  if (current <= 0) return "stockout";
  if (current <= rop) return "reorder";
  if (daysOfCover <= 10) return "watch";
  return "healthy";
}

export function buildReorderRows(
  products: Product[],
  pipeline: PipelineResult,
  settings: Settings,
): ReorderRow[] {
  return products
    .map((product) => {
      const forecast = pipeline.byProduct[product.id];
      const dailyDemand = forecast?.dailyDemand ?? 0;
      const demandDuringLead = dailyDemand * product.leadTimeDays;
      const reorderPoint = demandDuringLead + product.safetyStock;
      const targetStock =
        dailyDemand * (product.leadTimeDays + settings.coverDays) + product.safetyStock;
      const reorderQty = Math.max(0, Math.ceil(targetStock - product.currentStock));
      const daysOfCover = dailyDemand > 0 ? product.currentStock / dailyDemand : 99;
      const status = stockStatus(product.currentStock, reorderPoint, daysOfCover);
      const confidence: ConfidenceLevel = forecast?.confidence ?? "low";
      return {
        product,
        dailyDemand,
        demandDuringLead,
        reorderPoint,
        targetStock,
        reorderQty,
        daysOfCover,
        status,
        winnerModel: forecast?.method ?? forecast?.winner ?? pipeline.winner,
        confidence,
      };
    })
    .sort((a, b) => {
      const rank = { stockout: 0, reorder: 1, watch: 2, healthy: 3 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return a.daysOfCover - b.daysOfCover;
    });
}
