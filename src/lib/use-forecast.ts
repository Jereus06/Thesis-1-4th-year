import { useEffect, useMemo, useState } from "react";
import {
  attachCachePersist,
  peekPipeline,
  peekStalePipeline,
  pipelineKey,
  runServeCached,
} from "@/lib/forecast/cache";
import { requestBackgroundTrain, subscribeJob } from "@/lib/forecast/job";
import { localForecastCache } from "@/lib/forecast/persist";
import { buildReorderRows } from "@/lib/inventory/reorder";
import { useAppStore } from "@/lib/store";
import type { PipelineResult, ReorderRow, TrainProgress } from "@/lib/types";

export type ForecastState = {
  result: PipelineResult | null;
  rows: ReorderRow[];
  status: TrainProgress["status"];
  progress: TrainProgress;
};

export function useForecastCompute(initialResult: PipelineResult): ForecastState {
  const products = useAppStore((s) => s.products);
  const sales = useAppStore((s) => s.sales);
  const settings = useAppStore((s) => s.settings);
  const [result, setResult] = useState<PipelineResult>(initialResult);
  const [status, setStatus] = useState<TrainProgress["status"]>(
    initialResult.diagnostics.mode === "train" ? "ready" : "serving",
  );
  const [progress, setProgress] = useState<TrainProgress>({
    status: initialResult.diagnostics.mode === "train" ? "ready" : "serving",
    completed: initialResult.diagnostics.trainedProductCount,
    total: initialResult.diagnostics.mlProductIds.length,
    message:
      initialResult.diagnostics.mode === "train"
        ? "Serving pre-trained forecasts"
        : "Serving Moving Average while XGBoost trains",
  });

  const key = pipelineKey(products, sales, settings);

  useEffect(() => {
    attachCachePersist(localForecastCache);
    return subscribeJob((job) => {
      setProgress({
        status: job.status,
        completed: job.completed,
        total: job.total,
        currentProduct: job.currentProduct,
        message: job.message,
      });
      if (job.result) {
        setResult(job.result);
        setStatus(job.status === "ready" ? "ready" : "training");
      } else if (job.status === "training") {
        setStatus("training");
      }
    });
  }, []);

  useEffect(() => {
    attachCachePersist(localForecastCache);
    const state = useAppStore.getState();
    const hit = peekPipeline(state.products, state.sales, state.settings);
    if (hit?.diagnostics.mode === "train") {
      setResult(hit);
      setStatus("ready");
      return;
    }

    const stale = peekStalePipeline();
    if (stale) {
      setResult(stale);
      setStatus("serving");
    }

    let cancelled = false;
    void runServeCached(state.products, state.sales, state.settings).then((serve) => {
      if (cancelled) return;
      const trained = peekPipeline(state.products, state.sales, state.settings);
      if (trained?.diagnostics.mode === "train") {
        setResult(trained);
        setStatus("ready");
        return;
      }
      setResult(serve);
      setStatus("serving");
      requestBackgroundTrain();
    });
    if (!hit) requestBackgroundTrain();

    return () => {
      cancelled = true;
    };
  }, [key]);

  const rows = useMemo(() => {
    return buildReorderRows(products, result, settings);
  }, [products, result, settings]);

  return { result, rows, status, progress };
}
