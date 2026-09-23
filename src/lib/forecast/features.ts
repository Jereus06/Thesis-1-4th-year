import { parseDate } from "@/lib/dates";
import { mean } from "./metrics";

export const LOOKBACK = 30;

export const FEATURE_NAMES = [
  "lag_1",
  "lag_7",
  "lag_14",
  "roll_mean_7",
  "roll_mean_30",
  "day_of_week",
  "month",
  "product_category",
  "holiday_flag",
  "promotion_flag",
] as const;

export const WEEKLY_FEATURE_NAMES = [
  "lag_1w",
  "lag_2w",
  "lag_4w",
  "roll_mean_4w",
  "roll_mean_8w",
  "week_of_year",
  "month",
  "product_category",
  "holiday_flag",
  "promotion_flag",
] as const;

const PH_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-04-02",
  "2026-04-03",
  "2026-04-09",
  "2026-05-01",
  "2026-06-12",
  "2026-08-21",
  "2026-08-31",
  "2026-11-30",
  "2026-12-25",
  "2026-12-30",
  "2026-12-31",
]);

export function isHoliday(iso: string): boolean {
  if (PH_HOLIDAYS_2026.has(iso)) return true;
  const [, month, day] = iso.split("-").map(Number);
  return (month === 1 && day === 1) || (month === 12 && (day === 25 || day === 30 || day === 31));
}

export function isPromo(iso: string): boolean {
  const date = parseDate(iso);
  const dom = date.getDate();
  const dow = date.getDay();
  return (dom >= 14 && dom <= 16) || (dow === 6 && dom <= 7);
}

export function categoryIndex(category: string, categories: string[]): number {
  const index = categories.indexOf(category);
  return index < 0 ? 0 : index;
}

export function uniqueCategories(products: { category: string }[]): string[] {
  return [...new Set(products.map((p) => p.category))].sort();
}

export type FeatureContext = {
  trainMean: number;
  categoryIndex: number;
  grain: "daily" | "weekly";
};

export function extractFeatures(
  series: number[],
  t: number,
  dateISO: string,
  ctx: FeatureContext,
): number[] {
  if (ctx.grain === "weekly") return extractWeeklyFeatures(series, t, dateISO, ctx);
  const lag = (k: number) => (t >= k ? series[t - k] : ctx.trainMean);
  const slice7 = series.slice(Math.max(0, t - 7), t);
  const slice30 = series.slice(Math.max(0, t - 30), t);
  const date = parseDate(dateISO);
  return [
    lag(1),
    lag(7),
    lag(14),
    slice7.length ? mean(slice7) : ctx.trainMean,
    slice30.length ? mean(slice30) : ctx.trainMean,
    date.getDay(),
    date.getMonth() + 1,
    ctx.categoryIndex,
    isHoliday(dateISO) ? 1 : 0,
    isPromo(dateISO) ? 1 : 0,
  ];
}

function extractWeeklyFeatures(
  series: number[],
  t: number,
  dateISO: string,
  ctx: FeatureContext,
): number[] {
  const lag = (k: number) => (t >= k ? series[t - k] : ctx.trainMean);
  const slice4 = series.slice(Math.max(0, t - 4), t);
  const slice8 = series.slice(Math.max(0, t - 8), t);
  const date = parseDate(dateISO);
  const start = new Date(date.getFullYear(), 0, 1);
  const week = Math.floor((date.getTime() - start.getTime()) / (7 * 86400000)) + 1;
  return [
    lag(1),
    lag(2),
    lag(4),
    slice4.length ? mean(slice4) : ctx.trainMean,
    slice8.length ? mean(slice8) : ctx.trainMean,
    week,
    date.getMonth() + 1,
    ctx.categoryIndex,
    isHoliday(dateISO) ? 1 : 0,
    isPromo(dateISO) ? 1 : 0,
  ];
}
