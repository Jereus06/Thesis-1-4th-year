import type { ApiDashboard } from "./api";

export type ForecastSchedule = {
  enabled: boolean;
  localTime: string;
  timezone: string;
};

type DataMode = "api" | "browser-demo";

/** Older APIs and demonstration mode must not claim an automatic schedule. */
export function forecastScheduleMessage(
  mode: DataMode,
  schedule?: ForecastSchedule,
): string | null {
  if (
    mode !== "api" ||
    schedule?.enabled !== true ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime) ||
    !schedule.timezone?.trim()
  )
    return null;
  return `Automatic forecast refresh is scheduled daily at ${schedule.localTime} (${schedule.timezone}).`;
}

export function forecastRefreshAdvice(
  mode: DataMode,
  canRefreshForecast: boolean,
  schedule?: ForecastSchedule,
): string {
  if (forecastScheduleMessage(mode, schedule))
    return canRefreshForecast
      ? "refresh forecasts now or wait for the daily automatic refresh"
      : "wait for the daily automatic refresh";
  return canRefreshForecast ? "refresh forecasts" : "ask the owner to refresh forecasts";
}

/** Describe persisted queue status without inventing a completed-product fraction. */
export function forecastProgressMessage(
  data: ApiDashboard | null,
  options: {
    requesting: boolean;
    dateChanged: boolean;
    canRefreshForecast: boolean;
    error?: string;
  },
): string {
  if (options.requesting) return "Requesting a forecast refresh…";
  if (data?.latestRun?.status === "queued" || data?.latestRun?.status === "running")
    return `Forecast refresh is ${data.latestRun.status}.${data.run ? " The last completed forecast remains visible." : ""}`;
  if (options.error) return options.error;
  const advice = forecastRefreshAdvice("api", options.canRefreshForecast, data?.forecastSchedule);
  if (data?.expired)
    return `Forecast expired${data.forecastThrough ? ` after ${data.forecastThrough}` : ""}; review recent sales and ${advice}.`;
  if (options.dateChanged) return "Business date changed. Waiting for current recommendations.";
  if (data?.run)
    return `Saved Python forecast through ${data.forecastThrough ?? data.run.finalTestEnd}${data.stale ? `. New records or settings detected; ${advice}.` : ""}`;
  return `Python Moving Average baseline. Record sales, then ${advice} to evaluate models.`;
}
