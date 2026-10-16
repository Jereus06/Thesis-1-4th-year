import type { ForecastPoint, ProductForecast } from "./types";

export function chartIntervalBounds(point: ForecastPoint): [number, number] | null {
  return Number.isFinite(point.p10) && Number.isFinite(point.p90) && point.p90 >= point.p10
    ? [point.p10, point.p90]
    : null;
}

export function intervalAvailability(
  forecast: ProductForecast,
  mode: "api" | "browser-demo",
): string {
  if (mode === "browser-demo")
    return [...forecast.holdout, ...forecast.future].some(
      (point) => chartIntervalBounds(point) !== null,
    )
      ? "Demo forecast range"
      : "No demo forecast range";
  if (!forecast.interval)
    return forecast.trainedWithMl
      ? "Forecast range could not be checked"
      : "Forecast range unavailable";
  if (!forecast.interval.available)
    return forecast.interval.calibrationSplit === "late_validation_reserved_after_selection" &&
      forecast.interval.calibrationObservations !== undefined &&
      forecast.interval.calibrationObservations < 10
      ? "Not enough records to estimate a range"
      : "Forecast range unavailable";
  if (forecast.forecastExpired) return "Forecast range expired";
  if (!forecast.future.some((point) => chartIntervalBounds(point) !== null))
    return "Current forecast range unavailable";
  return forecast.interval.calibrationSplit === "late_validation_reserved_after_selection"
    ? "Forecast range available"
    : "Saved forecast range available";
}
