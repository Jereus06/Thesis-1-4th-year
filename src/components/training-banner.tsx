import { useForecast } from "@/components/forecast-context";

export function TrainingBanner() {
  const { status, progress, result } = useForecast();
  if (status === "ready" || status === "idle") return null;
  const total = Math.max(1, progress.total);
  const pct = Math.min(100, Math.round((progress.completed / total) * 100));
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {status === "training"
            ? progress.message
            : "Serving cached Moving Average · XGBoost trains separately"}
        </p>
        <p className="font-mono text-xs text-muted tabular">
          {progress.completed}/{total}
          {result?.diagnostics.mode === "serve" ? " · serving" : ""}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${status === "training" ? pct : 18}%` }}
        />
      </div>
    </div>
  );
}
