import type { ApiDashboard } from "./api";

function businessDate(data: ApiDashboard, now: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: data.businessTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function currentForecastDashboard(data: ApiDashboard, now: Date): ApiDashboard {
  // Never move the server's business day backward because of a client's clock.
  const day = [data.businessDay, businessDate(data, now)].sort().at(-1)!;
  const dateChanged = day > data.businessDay;
  const expired = data.expired || Boolean(data.forecastThrough && data.forecastThrough < day);
  const predictions = data.predictions.filter(
    (point) => point.datasetSplit !== "future" || point.predictionDate >= day,
  );
  return {
    ...data,
    businessDay: day,
    expired,
    predictions,
    recommendations: data.recommendations.map((row) => {
      if (!dateChanged || !row.demandAvailable) return row;
      const remaining = predictions.some(
        (point) => point.productId === row.productId && point.datasetSplit === "future",
      );
      const forecastExpired = row.forecastExpired || !remaining;
      // The API recalculates demand from the remaining dates. Until it responds,
      // withhold yesterday's advice instead of reusing its average after midnight.
      return {
        ...row,
        forecastExpired,
        demandAvailable: false,
        unavailableReason: forecastExpired
          ? "Forecast expired. Review recent sales and refresh forecasts."
          : "Business date changed. Waiting for current recommendations.",
        daily_demand: null,
        demand_during_lead_time: null,
        reorder_point: null,
        target_stock: null,
        suggested_quantity: "0",
        days_of_cover: null,
      };
    }),
  };
}
