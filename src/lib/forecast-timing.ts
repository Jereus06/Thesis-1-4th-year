export function formatForecastDuration(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "Unavailable";
  return value < 1000 ? `${value.toFixed(1)} ms` : `${(value / 1000).toFixed(2)} s`;
}
