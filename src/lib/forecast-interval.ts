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
      ? "Illustrative band"
      : "No illustrative band";
  if (!forecast.interval)
    return forecast.trainedWithMl ? "Calibration evidence unavailable" : "Intervals unavailable";
  if (!forecast.interval.available)
    return forecast.interval.calibrationSplit === "late_validation_reserved_after_selection" &&
      forecast.interval.calibrationObservations !== undefined &&
      forecast.interval.calibrationObservations < 10
      ? "Insufficient calibration observations"
      : "Intervals unavailable";
  if (forecast.forecastExpired) return "Expired future interval";
  if (!forecast.future.some((point) => chartIntervalBounds(point) !== null))
    return "Current interval bounds unavailable";
  return forecast.interval.calibrationSplit === "late_validation_reserved_after_selection"
    ? "Validation-calibrated interval available"
    : "Saved interval available";
}
