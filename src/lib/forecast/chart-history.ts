import { addDays } from "../dates";
import type { ApiDashboard } from "../api";
import type { ForecastPoint, ProductForecast } from "../types";

export function needsChartHistory(forecast?: ProductForecast): boolean {
  const lastTest = forecast?.holdout.at(-1)?.date;
  if (!lastTest) return false;
  const next = forecast?.future[0]?.date;
  return !next || next > addDays(lastTest, forecast?.grain === "weekly" ? 7 : 1);
}

/** Restore saved forecasts for elapsed dates only; never turn them into test actuals. */
export function earlierChartPredictions(
  rows: ApiDashboard["predictions"],
  forecast?: ProductForecast,
): ForecastPoint[] {
  if (!forecast || !needsChartHistory(forecast)) return [];
  const lastTest = forecast.holdout.at(-1)!.date;
  const firstCurrent = forecast.future[0]?.date;
  const points = new Map<string, ForecastPoint>();
  for (const row of rows) {
    if (
      row.productId !== forecast.productId ||
      row.datasetSplit !== "future" ||
      row.predictionDate <= lastTest ||
      (firstCurrent && row.predictionDate >= firstCurrent)
    )
      continue;
    const key =
      row.method === "xgboost"
        ? "xgb"
        : row.method === "ensemble"
          ? "ensemble"
          : ["moving_average", "movingAverage", "fallback"].includes(row.method)
            ? "ma"
            : null;
    const predicted = Number(row.predictedQuantity);
    if (!key || !Number.isFinite(predicted) || predicted < 0) continue;
    const point = points.get(row.predictionDate) ?? {
      date: row.predictionDate,
      actual: null,
      ma: NaN,
      xgb: NaN,
      ensemble: NaN,
      p10: NaN,
      p50: NaN,
      p90: NaN,
    };
    point[key] = predicted;
    if (row.lowerBound !== null && row.upperBound !== null) {
      point.p10 = Number(row.lowerBound);
      point.p50 = predicted;
      point.p90 = Number(row.upperBound);
    }
    points.set(point.date, point);
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}
