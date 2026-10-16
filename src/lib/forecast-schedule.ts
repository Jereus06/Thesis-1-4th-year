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
  return `Forecasts update daily at ${schedule.localTime} (${schedule.timezone}).`;
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
  if (options.requesting) return "Starting forecast update…";
  if (data?.latestRun?.status === "queued" || data?.latestRun?.status === "running")
    return `${data.latestRun.status === "queued" ? "Waiting to update forecasts." : "Updating forecasts…"}${data.run ? " Your previous forecast is shown for now." : ""}`;
  if (options.error) return options.error;
  const advice = forecastRefreshAdvice("api", options.canRefreshForecast, data?.forecastSchedule);
  if (data?.expired)
    return `Forecast expired${data.forecastThrough ? ` after ${data.forecastThrough}` : ""}; review recent sales and ${advice}.`;
  if (options.dateChanged) return "A new day has started. Waiting for today's recommendations.";
  if (data?.run)
    return `Forecast saved through ${data.forecastThrough ?? data.run.finalTestEnd}${data.stale ? `. Sales records or settings changed; ${advice}.` : ""}`;
  return `Using a basic sales estimate. Record sales, then ${advice}.`;
}
