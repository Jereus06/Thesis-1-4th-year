import { useState } from "react";
import type { ForecastChartType } from "@/components/demand-chart";
import { useAppStore } from "./store";

export type ForecastView = "daily" | "weekly" | "monthly";
type Preferences = {
  view: ForecastView;
  compare: boolean;
  chartType: ForecastChartType;
};
const defaults: Preferences = { view: "daily", compare: false, chartType: "line" };

function read(scope: string): Preferences {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(`stockcast-forecast-view:${scope}`) ?? "null",
    );
    return {
      view: ["daily", "weekly", "monthly"].includes(saved?.view) ? saved.view : defaults.view,
      compare: typeof saved?.compare === "boolean" ? saved.compare : defaults.compare,
      chartType:
        saved?.chartType === "bar"
          ? "candlestick"
          : ["line", "area", "candlestick", "step"].includes(saved?.chartType)
            ? saved.chartType
            : defaults.chartType,
    };
  } catch {
    return defaults;
  }
}

export function useForecastView() {
  const session = useAppStore((state) => state.session);
  const scope = session ? `${session.businessId}:${session.userId}` : "browser-demo";
  const [state, setState] = useState(() => ({ scope, preferences: read(scope) }));
  const preferences = state.scope === scope ? state.preferences : read(scope);
  if (state.scope !== scope) setState({ scope, preferences });
  function update(patch: Partial<Preferences>) {
    const next = { ...preferences, ...patch };
    setState({ scope, preferences: next });
    try {
      window.localStorage.setItem(`stockcast-forecast-view:${scope}`, JSON.stringify(next));
    } catch {
      /* The current page remains usable when storage is unavailable. */
    }
  }
  return { preferences, update };
}
