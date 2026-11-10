import type { Product, ReorderRow } from "@/lib/types";
import { stockStatus } from "./reorder";

export type LowStockAlert = {
  product: Product;
  status: "stockout" | "reorder";
  threshold: number;
  thresholdSource: "reorder_point" | "safety_stock";
};

function alertThreshold(
  product: Product,
  row: ReorderRow | undefined,
  expired: boolean,
): Pick<LowStockAlert, "threshold" | "thresholdSource"> {
  if (
    row &&
    !expired &&
    !row.forecastExpired &&
    row.demandAvailable !== false &&
    Number.isFinite(row.dailyDemand) &&
    row.dailyDemand >= 0 &&
    Number.isFinite(row.reorderPoint) &&
    row.reorderPoint >= 0
  ) {
    // The API adapter can attach live catalog details to an older calculation.
    // Recheck the existing formula even when row.product already looks current.
    const expectedPoint = row.dailyDemand * product.leadTimeDays + product.safetyStock;
    const tolerance =
      Number.EPSILON * 8 * Math.max(1, Math.abs(expectedPoint), Math.abs(row.reorderPoint));
    // Preserve the saved raw boundary when the only difference is floating point.
    const threshold =
      Math.abs(row.reorderPoint - expectedPoint) <= tolerance ? row.reorderPoint : expectedPoint;
    if (Number.isFinite(threshold) && threshold >= 0) {
      return { threshold, thresholdSource: "reorder_point" };
    }
  }

  // An inventory minimum remains meaningful without a usable sales forecast.
  return { threshold: product.safetyStock, thresholdSource: "safety_stock" };
}

function thresholdRatio(alert: LowStockAlert): number {
  if (alert.threshold > 0) return alert.product.currentStock / alert.threshold;
  return alert.product.currentStock < 0 ? -Infinity : 0;
}

/** Catalog-first alerts: a product never needs sales history to be out of stock. */
export function buildLowStockAlerts(
  products: readonly Product[],
  rows: readonly ReorderRow[],
  expired = false,
): LowStockAlert[] {
  const rowsByProduct = new Map(rows.map((row) => [row.product.id, row]));
  const alerts: LowStockAlert[] = [];
  for (const product of products) {
    if (product.isActive === false) continue;
    const threshold = alertThreshold(product, rowsByProduct.get(product.id), expired);
    const status = stockStatus(product.currentStock, threshold.threshold, Infinity);
    if (status === "stockout" || status === "reorder") {
      alerts.push({ product, status, ...threshold });
    }
  }

  return alerts.sort((a, b) => {
    if (a.status !== b.status) return a.status === "stockout" ? -1 : 1;
    const aRatio = thresholdRatio(a);
    const bRatio = thresholdRatio(b);
    if (aRatio !== bRatio) return aRatio < bRatio ? -1 : 1;
    return (
      a.product.name.localeCompare(b.product.name, "en") ||
      a.product.sku.localeCompare(b.product.sku, "en") ||
      a.product.id.localeCompare(b.product.id, "en")
    );
  });
}
