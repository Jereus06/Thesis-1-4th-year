import { runPipeline } from "@/lib/forecast/pipeline";
import type { PipelineResult, Product, Sale, Settings } from "@/lib/types";

type CacheEntry = {
  key: string;
  result: PipelineResult;
};

let memory: CacheEntry | null = null;
let persistHandle: PersistAdapter | null = null;

export type PersistAdapter = {
  read(): CacheEntry | null;
  write(entry: CacheEntry): void;
  clear(): void;
};

export function pipelineKey(products: Product[], sales: Sale[], settings: Settings): string {
  const last = sales.length ? sales[sales.length - 1]?.id : "";
  return [
    products.map((p) => `${p.id}:${p.currentStock}`).join(","),
    sales.length,
    last,
    settings.maWindow,
    settings.forecastHorizon,
    settings.holdoutDays,
    settings.topNProducts,
    settings.minWeeks,
    settings.cvFolds,
    settings.dataScenario,
    settings.useFallbackIfThin ? "1" : "0",
  ].join("|");
}

export function attachCachePersist(adapter: PersistAdapter) {
  persistHandle = adapter;
  if (!memory) {
    const stored = adapter.read();
    if (stored) memory = stored;
  }
}

export function peekPipeline(
  products: Product[],
  sales: Sale[],
  settings: Settings,
): PipelineResult | null {
  const key = pipelineKey(products, sales, settings);
  if (memory && memory.key === key) return memory.result;
  return null;
}

export function peekStalePipeline(): PipelineResult | null {
  return memory?.result ?? persistHandle?.read()?.result ?? null;
}

export function putPipeline(
  products: Product[],
  sales: Sale[],
  settings: Settings,
  result: PipelineResult,
) {
  const key = pipelineKey(products, sales, settings);
  const entry = { key, result };
  memory = entry;
  persistHandle?.write(entry);
}

export async function runServeCached(
  products: Product[],
  sales: Sale[],
  settings: Settings,
): Promise<PipelineResult> {
  const hit = peekPipeline(products, sales, settings);
  if (hit && hit.diagnostics.mode === "train") return hit;
  if (hit && hit.diagnostics.mode === "serve") return hit;
  const result = await runPipeline(products, sales, settings, { mode: "serve" });
  result.diagnostics.servingFromCache = false;
  if (!peekPipeline(products, sales, settings)) {
    putPipeline(products, sales, settings, result);
  }
  return result;
}

export function invalidatePipelineCache() {
  memory = null;
  persistHandle?.clear();
}
