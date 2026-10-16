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
    .filter((product) => product.isActive !== false)
    .map((product) => {
      const forecast = pipeline.byProduct[product.id];
      const demandAvailable =
        Boolean(forecast) &&
        forecast?.demandAvailable !== false &&
        Number.isFinite(forecast?.dailyDemand) &&
        (forecast?.dailyDemand ?? -1) >= 0 &&
        (forecast?.observationCount ?? 0) > 0;
      const dailyDemand = demandAvailable ? forecast!.dailyDemand : NaN;
      const demandDuringLead = dailyDemand * product.leadTimeDays;
      const reorderPoint = demandDuringLead + product.safetyStock;
      const targetStock =
        dailyDemand * (product.leadTimeDays + settings.coverDays) + product.safetyStock;
      const reorderQty =
        product.currentStock <= reorderPoint
          ? Math.max(0, Math.ceil(targetStock - product.currentStock))
          : 0;
      const daysOfCover = !demandAvailable
        ? NaN
        : dailyDemand > 0
          ? product.currentStock / dailyDemand
          : Infinity;
      const status = stockStatus(product.currentStock, reorderPoint, daysOfCover);
      const confidence: ConfidenceLevel = forecast?.confidence ?? "low";
      return {
        product,
        demandAvailable,
        forecastExpired: forecast?.forecastExpired,
        unavailableReason: demandAvailable
          ? undefined
          : (forecast?.unavailableReason ?? "No usable demand history is available."),
        fallbackReason: forecast?.fallbackReason,
        unknownDays: forecast?.unknownDays,
        excludedDays: forecast?.excludedDays,
        qualityWarnings: forecast?.qualityWarnings,
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
