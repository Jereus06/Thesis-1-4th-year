import { useForecast } from "@/components/forecast-context";
import { usePermissions } from "@/lib/permissions";
import { forecastRefreshAdvice, forecastScheduleMessage } from "@/lib/forecast-schedule";
import { useAppStore } from "@/lib/store";

export function TrainingBanner() {
  const { status, progress, result, error, expired, forecastThrough, schedule } = useForecast();
  const { canRefreshForecast } = usePermissions();
  const mode = useAppStore((state) => state.dataMode);
  const scheduleMessage = forecastScheduleMessage(mode, schedule);
  const advice = forecastRefreshAdvice(mode, canRefreshForecast, schedule);
  const showProgress =
    status === "training" || status === "serving" || Boolean(scheduleMessage && status === "ready");
  const showMeasuredProgress = mode === "browser-demo" && status === "training";
  if (!error && !expired && !showProgress && !scheduleMessage) return null;
  const total = Math.max(1, progress.total);
  const pct = Math.min(100, Math.round((progress.completed / total) * 100));
  return (
    <div className="flex flex-col gap-3">
      {scheduleMessage && (
        <p role="status" data-forecast-schedule className="text-sm text-muted">
          {scheduleMessage}
        </p>
      )}
      {expired && (
        <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <strong>Forecast expired.</strong>{" "}
          {forecastThrough && `Predictions through ${forecastThrough} have passed. `}
          Expired predictions are excluded from current reorder advice. Review recent sales, then{" "}
          {advice}.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 p-4 text-sm text-danger">
          {error}
        </p>
      )}
      {showProgress && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">{progress.message}</p>
            {showMeasuredProgress && (
              <p className="font-mono text-xs text-muted tabular">
                {progress.completed}/{total}
                {result?.diagnostics.mode === "serve" ? " · serving" : ""}
              </p>
            )}
          </div>
          {showMeasuredProgress && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
