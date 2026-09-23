import { peekPipeline, pipelineKey, putPipeline } from "@/lib/forecast/cache";
import { runPipeline } from "@/lib/forecast/pipeline";
import { useAppStore } from "@/lib/store";
import type { PipelineResult, TrainProgress } from "@/lib/types";

type Listener = (state: JobState) => void;

export type JobState = TrainProgress & {
  result: PipelineResult | null;
};

const listeners = new Set<Listener>();

let state: JobState = {
  status: "idle",
  completed: 0,
  total: 0,
  message: "Idle",
  result: null,
};

let running = false;
let queued = false;
let forceNext = false;

function emit(next: Partial<JobState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function getJobState(): JobState {
  return state;
}

export function subscribeJob(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function requestBackgroundTrain(force = false) {
  if (force) forceNext = true;
  if (running) {
    queued = true;
    return;
  }
  void runJob();
}

async function runJob() {
  running = true;
  queued = false;
  const snap = useAppStore.getState();
  const key = pipelineKey(snap.products, snap.sales, snap.settings);
  const fresh = peekPipeline(snap.products, snap.sales, snap.settings);
  const shouldSkip = !forceNext && fresh?.diagnostics.mode === "train";
  forceNext = false;
  if (shouldSkip && fresh) {
    emit({
      status: "ready",
      completed: fresh.diagnostics.trainedProductCount,
      total: fresh.diagnostics.trainedProductCount,
      message: "Serving pre-trained forecasts",
      result: fresh,
    });
    running = false;
    return;
  }

  emit({
    status: "training",
    completed: 0,
    total: snap.settings.topNProducts,
    message: "Training XGBoost in the background",
    currentProduct: undefined,
  });

  try {
    const result = await runPipeline(snap.products, snap.sales, snap.settings, {
      mode: "train",
      yieldFn: yieldToMain,
      onProgress: (completed, total, name) => {
        emit({
          status: "training",
          completed,
          total,
          currentProduct: name,
          message: name ? `Training ${name}` : `Training ${completed}/${total}`,
        });
      },
    });
    const latest = useAppStore.getState();
    const latestKey = pipelineKey(latest.products, latest.sales, latest.settings);
    if (latestKey === key) {
      result.diagnostics.servingFromCache = true;
      result.diagnostics.mode = "train";
      putPipeline(latest.products, latest.sales, latest.settings, result);
      emit({
        status: "ready",
        completed: result.diagnostics.trainedProductCount,
        total: result.diagnostics.mlProductIds.length,
        message: `Cached ${result.diagnostics.trainedProductCount} models in ${formatMs(result.trainedMs)}`,
        result,
        currentProduct: undefined,
      });
    }
  } catch (err) {
    emit({
      status: "serving",
      message: err instanceof Error ? err.message : "Training failed — still serving last forecast",
    });
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void runJob();
    }
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
