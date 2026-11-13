import { addDays, enumerateDays } from "../dates";
import type { ForecastMethod, ForecastPoint, ProductForecast } from "../types";
import { weekStartMonday } from "./prepare";

export function predictionKey(method: ForecastMethod): "ma" | "xgb" | "ensemble" {
  return method === "rule" ? "ma" : method;
}

function missingPoint(date: string): ForecastPoint {
  return { date, actual: null, ma: NaN, xgb: NaN, ensemble: NaN, p10: NaN, p50: NaN, p90: NaN };
}

function fillGaps(points: ForecastPoint[]): ForecastPoint[] {
  if (!points.length) return [];
  const byDate = new Map(points.map((point) => [point.date, point]));
  const dates = [...byDate.keys()].sort();
  return enumerateDays(dates[0], dates[dates.length - 1]).map(
    (date) => byDate.get(date) ?? missingPoint(date),
  );
}

function periodTotals(points: ForecastPoint[], monthly = false): ForecastPoint[] {
  const weeks = new Map<string, ForecastPoint[]>();
  for (const point of points) {
    const key = monthly ? point.date.slice(0, 7) : weekStartMonday(point.date);
    weeks.set(key, [...(weeks.get(key) ?? []), point]);
  }
  return [...weeks.values()].map((batch) => {
    const sum = (key: keyof Omit<ForecastPoint, "date">) =>
      batch.every((point) => typeof point[key] === "number" && Number.isFinite(point[key]))
        ? batch.reduce((total, point) => total + (point[key] as number), 0)
        : NaN;
    return {
      date: batch[0].date,
      actual: Number.isFinite(sum("actual")) ? sum("actual") : null,
      ma: sum("ma"),
      xgb: sum("xgb"),
      ensemble: sum("ensemble"),
      // Daily marginal intervals cannot be added into a calibrated weekly interval.
      p10: NaN,
      p50: NaN,
      p90: NaN,
    };
  });
}

/** Keep test actuals and future estimates in separate calendar buckets. */
export function forecastChartPoints(
  forecast: ProductForecast,
  horizonDays: number,
  view: "daily" | "weekly" | "monthly",
  earlierPredictions: ForecastPoint[] = [],
): ForecastPoint[] {
  const futureStart = forecast.future[0]?.date;
  const futureEnd = futureStart
    ? addDays(futureStart, Math.max(1, Math.floor(horizonDays)) - 1)
    : "";
  const future = [
    ...earlierPredictions,
    ...forecast.future.filter((point) => point.date <= futureEnd),
  ];
  // Legacy demonstration results can contain native weekly totals already.
  if (forecast.grain === "weekly") return [...forecast.holdout, ...future];
  const historical = fillGaps(forecast.holdout);
  if (view !== "daily")
    return [
      ...periodTotals(historical, view === "monthly"),
      ...periodTotals(fillGaps(future), view === "monthly"),
    ];
  return fillGaps([...historical, ...future]);
}
