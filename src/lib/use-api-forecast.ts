import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ApiDashboard } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { currentForecastDashboard } from "@/lib/forecast-validity";
import { toReorderRows, toResult } from "@/lib/api-forecast";
import { usePermissions } from "@/lib/permissions";
import type { ForecastState } from "@/lib/use-forecast";

export function useApiForecast(): ForecastState {
  const session = useAppStore((s) => s.session);
  const catalog = useAppStore((s) => s.products);
  const products = useMemo(
    () => catalog.filter((product) => product.isActive !== false),
    [catalog],
  );
  const { canRefreshForecast } = usePermissions();
  const sales = useAppStore((s) => s.sales);
  const settings = useAppStore((s) => s.settings);
  const [snapshot, setData] = useState<ApiDashboard | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [error, setError] = useState<string | undefined>();
  const [requesting, setRequesting] = useState(false);
  const businessId = session?.businessId;
  const load = useCallback(async () => {
    if (!businessId) return;
    const next = await api.dashboard(businessId);
    setData(next);
    setError(undefined);
  }, [businessId]);
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      if (!businessId) return;
      try {
        const next = await api.dashboard(businessId);
        if (!cancelled) {
          setData(next);
          setError(undefined);
        }
      } catch (failure) {
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : "Unable to load forecasts");
      }
    };
    void read();
    // Poll the persisted queue, including runs started by another signed-in browser.
    const timer = window.setInterval(() => {
      setClock(Date.now());
      void read();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [businessId, products, sales, settings]);
  const refresh = useCallback(async () => {
    if (!businessId || !canRefreshForecast) throw new Error("Only an owner can refresh forecasts.");
    setRequesting(true);
    try {
      await api.refreshForecast(businessId);
      await load();
    } finally {
      setRequesting(false);
    }
  }, [businessId, canRefreshForecast, load]);
  const data = useMemo(
    () => (snapshot ? currentForecastDashboard(snapshot, new Date(clock)) : null),
    [snapshot, clock],
  );
  const dateChanged = Boolean(snapshot && data && snapshot.businessDay < data.businessDay);
  const result = useMemo(
    () => (data ? toResult(data, products, settings.minWeeks, settings.topNProducts) : null),
    [data, products, settings.minWeeks, settings.topNProducts],
  );
  const rows = useMemo(() => (data ? toReorderRows(data, products) : []), [data, products]);
  const latest = data?.latestRun;
  const busy = requesting || latest?.status === "queued" || latest?.status === "running";
  const status = busy
    ? "training"
    : data?.expired
      ? "expired"
      : data?.run && !data.stale && !dateChanged
        ? "ready"
        : "serving";
  const failure =
    error ??
    (latest?.status === "failed" ? (latest.failureMessage ?? "Forecast failed") : undefined);
  const refreshAdvice = canRefreshForecast
    ? "refresh forecasts"
    : "ask the owner to refresh forecasts";
  return {
    result,
    rows,
    status,
    refresh,
    error: failure,
    expired: data?.expired ?? false,
    forecastThrough: data?.forecastThrough,
    progress: {
      status,
      total: products.length,
      completed: busy ? 0 : products.length,
      message: busy
        ? "Python worker is evaluating and saving forecasts…"
        : (failure ??
          (data?.expired
            ? `Forecast expired after ${data.forecastThrough}; review recent sales and ${refreshAdvice}.`
            : dateChanged
              ? "Business date changed. Waiting for current recommendations."
              : data?.run
                ? `Saved Python forecast through ${data.forecastThrough ?? data.run.finalTestEnd}${data.stale ? `. New records or settings detected; ${refreshAdvice}.` : ""}`
                : `Python Moving Average baseline. Record sales, then ${refreshAdvice} to evaluate models.`)),
    },
  };
}
