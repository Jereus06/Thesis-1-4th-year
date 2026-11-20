import { saleRevenue } from "./sale-pricing";
import { isImportedSale } from "./sales-import";
import type { Product, Sale } from "./types";

export type DailySalesProduct = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  unitCost: number;
  isActive: boolean;
  quantity: number;
  totalAmount: number | null;
  unpricedCount: number;
  recordCount: number;
  recordedCount: number;
  importedCount: number;
};

export type DailySalesRow = DailySalesProduct & { date: string };

export type DailySalesSummary = {
  products: DailySalesProduct[];
  rows: DailySalesRow[];
  totals: { unit: string; quantity: number; totalAmount: number | null; unpricedCount: number }[];
  totalAmount: number | null;
  unpricedCount: number;
  recordCount: number;
  recordedCount: number;
  importedCount: number;
};

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function compareProducts(a: DailySalesProduct, b: DailySalesProduct): number {
  return (
    a.name.localeCompare(b.name) ||
    a.sku.localeCompare(b.sku) ||
    a.productId.localeCompare(b.productId)
  );
}

/** Summarize saved sale dates from the complete history, preserving each catalog counting unit. */
export function summarizeDailySales(
  sales: readonly Sale[],
  products: readonly Product[],
  startDate: string,
  endDate = startDate,
  search = "",
): DailySalesSummary {
  const summary: DailySalesSummary = {
    products: [],
    rows: [],
    totals: [],
    recordCount: 0,
    recordedCount: 0,
    importedCount: 0,
    totalAmount: null,
    unpricedCount: 0,
  };
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) return summary;

  const catalog = new Map(products.map((product) => [product.id, product]));
  const byProduct = new Map<string, DailySalesProduct>();
  const byDateProduct = new Map<string, DailySalesRow>();
  const byUnit = new Map<
    string,
    { quantity: number; totalAmount: number | null; unpricedCount: number; recordCount: number }
  >();
  const query = search.trim().toLocaleLowerCase();
  for (const sale of sales) {
    if (sale.date < startDate || sale.date > endDate) continue;
    const product = catalog.get(sale.productId);
    const details = {
      productId: sale.productId,
      name: product?.name ?? sale.productId,
      sku: product?.sku ?? "Unavailable",
      unit: product?.unit ?? "Unknown unit",
      unitCost: product?.unitCost ?? 0,
      isActive: product?.isActive !== false,
    };
    if (
      query &&
      !details.name.toLocaleLowerCase().includes(query) &&
      !details.sku.toLocaleLowerCase().includes(query) &&
      ![product?.brand, product?.model, product?.variant, product?.category].some((value) =>
        value?.toLocaleLowerCase().includes(query),
      )
    ) {
      continue;
    }
    const row = byProduct.get(sale.productId) ?? {
      ...details,
      quantity: 0,
      totalAmount: 0,
      unpricedCount: 0,
      recordCount: 0,
      recordedCount: 0,
      importedCount: 0,
    };
    const dateKey = JSON.stringify([sale.date, sale.productId]);
    const datedRow = byDateProduct.get(dateKey) ?? {
      ...details,
      date: sale.date,
      quantity: 0,
      totalAmount: 0,
      unpricedCount: 0,
      recordCount: 0,
      recordedCount: 0,
      importedCount: 0,
    };
    // Saved quantities have at most three decimals. Sum thousandths to avoid float noise.
    const thousandths = Math.round(sale.qty * 1000);
    // Saved selling prices allow four decimals. Accumulate integer ten-millionths so fractional
    // quantities retain their full value without rounding each sale to whole cents.
    const revenue = saleRevenue(sale);
    const amount = revenue == null ? 0 : Math.round(revenue * 1e7);
    const imported = isImportedSale(sale);
    for (const group of [row, datedRow]) {
      group.quantity += thousandths;
      group.totalAmount = (group.totalAmount ?? 0) + amount;
      if (revenue == null) group.unpricedCount++;
      group.recordCount += 1;
      if (imported) group.importedCount += 1;
      else group.recordedCount += 1;
    }
    summary.recordCount += 1;
    if (revenue == null) summary.unpricedCount++;
    if (imported) {
      summary.importedCount += 1;
    } else {
      summary.recordedCount += 1;
    }
    byProduct.set(sale.productId, row);
    byDateProduct.set(dateKey, datedRow);
    const unit = byUnit.get(row.unit) ?? {
      quantity: 0,
      totalAmount: 0,
      unpricedCount: 0,
      recordCount: 0,
    };
    unit.quantity += thousandths;
    unit.recordCount++;
    unit.totalAmount = (unit.totalAmount ?? 0) + amount;
    if (revenue == null) unit.unpricedCount++;
    byUnit.set(row.unit, unit);
    summary.totalAmount = (summary.totalAmount ?? 0) + amount;
  }

  summary.products = [...byProduct.values()]
    .map((row) => ({
      ...row,
      quantity: row.quantity / 1000,
      totalAmount: row.unpricedCount === row.recordCount ? null : (row.totalAmount ?? 0) / 1e7,
    }))
    .sort(compareProducts);
  summary.rows = [...byDateProduct.values()]
    .map((row) => ({
      ...row,
      quantity: row.quantity / 1000,
      totalAmount: row.unpricedCount === row.recordCount ? null : (row.totalAmount ?? 0) / 1e7,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || compareProducts(a, b));
  summary.totals = [...byUnit]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unit, totals]) => ({
      unit,
      quantity: totals.quantity / 1000,
      totalAmount:
        totals.unpricedCount === totals.recordCount ? null : (totals.totalAmount ?? 0) / 1e7,
      unpricedCount: totals.unpricedCount,
    }));
  summary.totalAmount =
    summary.unpricedCount === summary.recordCount ? null : (summary.totalAmount ?? 0) / 1e7;
  return summary;
}
