import type { DailySalesProduct, DailySalesRow } from "./daily-sales";

export type SalesView = "quantity" | "revenue";
export type SalesReportChartType = "bar" | "line" | "area" | "pie";

export type SalesTrendSeries = { key: string; unit: string };
export type SalesTrendPoint = {
  date: string;
  timestamp: number;
  unpricedCount: number;
  values: Record<string, number | null>;
};
export type SalesProductShare = {
  id: string;
  name: string;
  value: number;
  percentage: number;
};

export function salesSharePercentage(value: number): string {
  if (value > 0 && value < 0.01) return "<0.01%";
  return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(value)}%`;
}

/** Place percentage labels outside the circle with room between labels on the same side. */
export function salesPieLayout(
  shares: readonly SalesProductShare[],
  width: number,
  height: number,
) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(24, Math.min(104, width / 2 - 70, height / 2 - 34));
  let angle = 0;
  const labels = shares.map((share, index) => {
    const sweep = share.percentage * 3.6;
    const midAngle = (-(angle + sweep / 2) * Math.PI) / 180;
    angle += sweep;
    const side = Math.cos(midAngle) >= 0 ? 1 : -1;
    return {
      index,
      x: cx + side * (radius + 24),
      y: cy + (radius + 20) * Math.sin(midAngle),
      side,
      startX: cx + radius * Math.cos(midAngle),
      startY: cy + radius * Math.sin(midAngle),
      elbowX: cx + side * (radius + 12),
      elbowY: cy + radius * Math.sin(midAngle),
      text: salesSharePercentage(share.percentage),
    };
  });
  for (const side of [-1, 1]) {
    const group = labels.filter((label) => label.side === side).sort((a, b) => a.y - b.y);
    group.forEach((label, index) => {
      label.y = Math.max(16, label.y, index ? group[index - 1].y + 18 : 16);
    });
    for (let index = group.length - 1; index >= 0; index--) {
      group[index].y = Math.min(
        group[index].y,
        index === group.length - 1 ? height - 16 : group[index + 1].y - 18,
      );
    }
  }
  return { cx, cy, radius, labels };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function salesTimestamp(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
    ? timestamp
    : null;
}

/** Keep catalog counting units distinct and leave unrecorded dates unknown. */
export function buildSalesTrend(
  rows: readonly DailySalesRow[],
  view: SalesView = "quantity",
): {
  points: SalesTrendPoint[];
  series: SalesTrendSeries[];
  domain: [number, number];
} {
  const scale = view === "revenue" ? 1e7 : 1000;
  const validRows = rows.filter(
    (row) => salesTimestamp(row.date) !== null && Number.isFinite(row.quantity),
  );
  const units = [...new Set(validRows.map((row) => (view === "revenue" ? "PHP" : row.unit)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const series = units.map((unit, index) => ({ unit, key: `unit${index}` }));
  const keys = new Map(series.map((item) => [item.unit, item.key]));
  const missingPrices = new Map<number, number>();
  const observed = new Map<number, Record<string, number>>();
  for (const row of validRows) {
    const timestamp = salesTimestamp(row.date)!;
    const quantities = observed.get(timestamp) ?? {};
    missingPrices.set(timestamp, (missingPrices.get(timestamp) ?? 0) + (row.unpricedCount ?? 0));
    const key = keys.get(view === "revenue" ? "PHP" : row.unit)!;
    if (view === "quantity" || row.totalAmount != null)
      quantities[key] =
        (quantities[key] ?? 0) +
        Math.round((view === "revenue" ? row.totalAmount! : row.quantity) * scale);
    observed.set(timestamp, quantities);
  }
  const timestamps = [...observed.keys()].sort((a, b) => a - b);
  if (!timestamps.length) return { points: [], series: [], domain: [0, DAY_MS] };
  const first = timestamps[0];
  const last = timestamps.at(-1)!;
  const points: SalesTrendPoint[] = [];
  // Break the path at gaps without allocating every unrecorded calendar date.
  const chartDates = timestamps.flatMap((timestamp, index) => {
    const previous = timestamps[index - 1];
    return index > 0 && timestamp - previous > DAY_MS
      ? [previous + DAY_MS, timestamp]
      : [timestamp];
  });
  for (const timestamp of chartDates) {
    const recorded = observed.get(timestamp);
    points.push({
      date: new Date(timestamp).toISOString().slice(0, 10),
      timestamp,
      unpricedCount: missingPrices.get(timestamp) ?? 0,
      values: Object.fromEntries(
        series.map(({ key }) => [key, recorded?.[key] == null ? null : recorded[key] / scale]),
      ),
    });
  }
  // Half a day of padding keeps end bars visible and gives single-day charts a real domain.
  return { points, series, domain: [first - DAY_MS / 2, last + DAY_MS / 2] };
}

/** Revenue shares use saved revenue; quantity shares require one counting unit. */
export function buildSalesShares(
  products: readonly DailySalesProduct[],
  view: SalesView = "quantity",
): SalesProductShare[] {
  if (view === "quantity" && new Set(products.map((product) => product.unit)).size > 1) return [];
  const value = (product: DailySalesProduct) =>
    view === "revenue" ? product.totalAmount : product.quantity;
  const ranked = products
    .filter(
      (product) => value(product) != null && Number.isFinite(value(product)) && value(product)! > 0,
    )
    .map((product) => ({
      id: product.productId,
      name: `${product.name} (${product.sku})`,
      value: value(product)!,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const total = ranked.reduce((sum, product) => sum + product.value, 0);
  if (!total) return [];
  const slices =
    ranked.length > 8
      ? [
          ...ranked.slice(0, 7),
          {
            id: "other-products",
            name: `Other products (${ranked.length - 7})`,
            value: ranked.slice(7).reduce((sum, product) => sum + product.value, 0),
          },
        ]
      : ranked;
  return slices.map((slice) => ({ ...slice, percentage: (slice.value / total) * 100 }));
}
