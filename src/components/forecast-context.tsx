import { createContext, useContext, type ReactNode } from "react";
import { useForecastCompute, type ForecastState } from "@/lib/use-forecast";
import type { PipelineResult } from "@/lib/types";

const ForecastContext = createContext<ForecastState | null>(null);

export function ForecastProvider({
  children,
  initialResult,
}: {
  children: ReactNode;
  initialResult: PipelineResult;
}) {
  const value = useForecastCompute(initialResult);
  return <ForecastContext.Provider value={value}>{children}</ForecastContext.Provider>;
}

export function useForecast(): ForecastState {
  const ctx = useContext(ForecastContext);
  if (!ctx) throw new Error("useForecast must be used within ForecastProvider");
  return ctx;
}
