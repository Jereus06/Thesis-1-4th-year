import { addDays, enumerateDays, maxDate, minDate } from "@/lib/dates";
import type { Grain, Product, Sale } from "@/lib/types";
import { MIN_NONZERO_FOR_ML, SPARSE_ZERO_SHARE } from "./constants";
import { mean } from "./metrics";

export function buildDailySeries(sales: Sale[], productId: string, dates: string[]): number[] {
  const map = new Map<string, number>();
  for (const sale of sales) {
    if (sale.productId !== productId) continue;
    map.set(sale.date, (map.get(sale.date) ?? 0) + sale.qty);
  }
  return dates.map((date) => map.get(date) ?? 0);
}

export function weekStartMonday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + offset);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function aggregateWeekly(
  dates: string[],
  series: number[],
): { dates: string[]; series: number[] } {
  const buckets = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) {
    const key = weekStartMonday(dates[i]);
    buckets.set(key, (buckets.get(key) ?? 0) + series[i]);
  }
  const keys = [...buckets.keys()].sort();
  return { dates: keys, series: keys.map((k) => buckets.get(k) ?? 0) };
}

export function seriesStats(series: number[]): {
  observationCount: number;
  nonzeroCount: number;
  zeroShare: number;
  sparse: boolean;
} {
  const observationCount = series.length;
  const nonzeroCount = series.filter((v) => v > 0).length;
  const zeroShare = observationCount ? (observationCount - nonzeroCount) / observationCount : 1;
  return {
    observationCount,
    nonzeroCount,
    zeroShare,
    sparse: zeroShare > SPARSE_ZERO_SHARE,
  };
}

export function weeksCovered(start: string, end: string): number {
  const days = enumerateDays(start, end).length;
  return days / 7;
}

export function volumeByProduct(products: Product[], sales: Sale[]): Map<string, number> {
  const units = new Map<string, number>();
  for (const p of products) units.set(p.id, 0);
  for (const sale of sales) {
    units.set(sale.productId, (units.get(sale.productId) ?? 0) + sale.qty);
  }
  return units;
}

export function selectTrainScope(
  products: Product[],
  sales: Sale[],
  dates: string[],
  topN: number,
): {
  ml: Product[];
  rule: Product[];
  reasons: Record<string, string>;
  grainById: Record<string, Grain>;
} {
  const volume = volumeByProduct(products, sales);
  const ranked = [...products].sort((a, b) => (volume.get(b.id) ?? 0) - (volume.get(a.id) ?? 0));
  const reasons: Record<string, string> = {};
  const grainById: Record<string, Grain> = {};
  const eligible: Product[] = [];

  for (const product of ranked) {
    const daily = buildDailySeries(sales, product.id, dates);
    const stats = seriesStats(daily);
    grainById[product.id] = stats.sparse ? "weekly" : "daily";
    if (stats.nonzeroCount < MIN_NONZERO_FOR_ML) {
      reasons[product.id] =
        `${stats.nonzeroCount} non-zero days (need ${MIN_NONZERO_FOR_ML}) · simple reorder rule`;
      continue;
    }
    eligible.push(product);
  }

  const ml = eligible.slice(0, Math.max(1, topN));
  const mlIds = new Set(ml.map((p) => p.id));
  const rule: Product[] = [];
  for (const product of products) {
    if (mlIds.has(product.id)) continue;
    rule.push(product);
    if (!reasons[product.id]) {
      reasons[product.id] = `Outside top ${topN} by sales volume · simple reorder rule`;
    }
  }

  return { ml, rule, reasons, grainById };
}

export function recentMean(series: number[], window: number): number {
  return mean(series.slice(-Math.max(1, window)));
}

export function clipNonNeg(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function saleDateRange(sales: Sale[], fallbackStart: string, fallbackEnd: string): {
  start: string;
  end: string;
  dates: string[];
} {
  const saleDates = sales.map((s) => s.date);
  const start = saleDates.length ? minDate(saleDates) : fallbackStart;
  const end = saleDates.length ? maxDate(saleDates) : fallbackEnd;
  return { start, end, dates: enumerateDays(start, end) };
}

export { addDays };
