import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type ApiDashboard } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { currentForecastDashboard } from "@/lib/forecast-validity";
import { toReorderRows, toResult } from "@/lib/api-forecast";
import { usePermissions } from "@/lib/permissions";
import type { ForecastState } from "@/lib/use-forecast";
import { forecastProgressMessage } from "@/lib/forecast-schedule";

async function forecastRevision(businessId: string): Promise<string | null> {
  try {
    return (await api.forecastStatus(businessId)).revision;
  } catch (failure) {
    // The optional SQLite demonstration and older servers retain full polling.
    if (failure instanceof ApiError && failure.status === 404) return null;
    throw failure;
  }
}

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
  const [requestingSession, setRequestingSession] = useState<typeof session>(null);
  const requesting = Boolean(session && requestingSession === session);
  const loadedRevision = useRef<string | null>(null);
  const requestVersion = useRef(0);
  const businessId = session?.businessId;
  const load = useCallback(async () => {
    if (!businessId || useAppStore.getState().session !== session) return;
    const version = ++requestVersion.current;
    // Read the revision first so a write during the full read is observed by
    // the next poll rather than being mistaken for an already loaded change.
    const revision = await forecastRevision(businessId);
    if (useAppStore.getState().session !== session) return;
    const next = await api.dashboard(businessId);
    if (version !== requestVersion.current || useAppStore.getState().session !== session) return;
    loadedRevision.current = revision;
    setData(next);
    setError(undefined);
  }, [businessId, session]);
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    loadedRevision.current = null;
    const read = async (force = false) => {
      if (!businessId || useAppStore.getState().session !== session) return;
      if (pending) return;
      pending = true;
      const version = ++requestVersion.current;
      try {
        const revision = await forecastRevision(businessId);
        if (
          cancelled ||
          version !== requestVersion.current ||
          useAppStore.getState().session !== session
        )
          return;
        if (!force && revision !== null && loadedRevision.current === revision) {
          setError(undefined);
          return;
        }
        const next = await api.dashboard(businessId);
        if (
          !cancelled &&
          version === requestVersion.current &&
          useAppStore.getState().session === session
        ) {
          loadedRevision.current = revision;
          setData(next);
          setError(undefined);
        }
      } catch (failure) {
        if (
          !cancelled &&
          version === requestVersion.current &&
          useAppStore.getState().session === session
        )
          setError(failure instanceof Error ? failure.message : "Unable to load forecasts");
      } finally {
        pending = false;
      }
    };
    void read(true);
    // Poll the persisted queue, including runs started by another signed-in browser.
    const timer = window.setInterval(() => {
      setClock(Date.now());
      void read();
    }, 5000);
    return () => {
      cancelled = true;
      requestVersion.current += 1;
      window.clearInterval(timer);
    };
  }, [businessId, session, products, sales, settings]);
  const refresh = useCallback(async () => {
    if (!businessId || !canRefreshForecast) throw new Error("Only an owner can refresh forecasts.");
    if (useAppStore.getState().session !== session) return;
    setRequestingSession(session);
    try {
      await api.refreshForecast(businessId);
      if (useAppStore.getState().session !== session) return;
      await load();
    } finally {
      setRequestingSession((current) => (current === session ? null : current));
    }
  }, [businessId, session, canRefreshForecast, load]);
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
  return {
    result,
    rows,
    status,
    refresh,
    error: failure,
    expired: data?.expired ?? false,
    forecastThrough: data?.forecastThrough,
    schedule: data?.forecastSchedule,
    progress: {
      status,
      total: products.length,
      completed: busy ? 0 : products.length,
      message: forecastProgressMessage(data, {
        requesting,
        dateChanged,
        canRefreshForecast,
        error: failure,
      }),
    },
  };
}
