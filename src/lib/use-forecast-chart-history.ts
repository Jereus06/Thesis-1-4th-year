import { useEffect, useMemo, useState } from "react";
import { api, type ApiDashboard, type SessionUser } from "./api";
import { earlierChartPredictions, needsChartHistory } from "./forecast/chart-history";
import { useAppStore } from "./store";
import type { ProductForecast } from "./types";

type History = {
  session: SessionUser;
  runId: string;
  rows: ApiDashboard["predictions"];
  error?: string;
};

export function useForecastChartHistory(forecast: ProductForecast | undefined, runId?: string) {
  const session = useAppStore((state) => state.session);
  const mode = useAppStore((state) => state.dataMode);
  const [history, setHistory] = useState<History | null>(null);
  const [attempt, setAttempt] = useState(0);
  const needed = mode === "api" && Boolean(runId && session) && needsChartHistory(forecast);
  const matches = history?.session === session && history?.runId === runId;
  const ready = matches && !history?.error;

  useEffect(() => {
    if (!needed || !session || !runId || ready) return;
    let cancelled = false;
    void api.forecastPredictions(session.businessId, runId).then(
      (rows) => {
        if (!cancelled && useAppStore.getState().session === session)
          setHistory({ session, runId, rows });
      },
      () => {
        if (!cancelled && useAppStore.getState().session === session)
          setHistory({
            session,
            runId,
            rows: [],
            error: "Earlier saved predictions could not be loaded.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needed, session, runId, ready, attempt]);

  return {
    points: useMemo(
      () => (needed && ready ? earlierChartPredictions(history!.rows, forecast) : []),
      [needed, ready, history, forecast],
    ),
    error: needed && matches ? history?.error : undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}
