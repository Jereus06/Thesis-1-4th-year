import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ApiDashboard } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type {
  ForecastMethod,
  ForecastPoint,
  PipelineResult,
  Product,
  ProductForecast,
  ReorderRow,
} from "@/lib/types";
import type { ForecastState } from "@/lib/use-forecast";

const methodName = (method: string): ForecastMethod =>
  method === "xgboost"
    ? "xgb"
    : method === "ensemble"
      ? "ensemble"
      : method === "movingAverage" || method === "moving_average"
        ? "ma"
        : "rule";

export function useApiForecast(): ForecastState {
  const session = useAppStore((s) => s.session);
  const products = useAppStore((s) => s.products);
  const sales = useAppStore((s) => s.sales);
  const settings = useAppStore((s) => s.settings);
  const [data, setData] = useState<ApiDashboard | null>(null);
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
    const timer = window.setInterval(() => void read(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [businessId, products, sales, settings]);
  const refresh = useCallback(async () => {
    if (!businessId) return;
    setRequesting(true);
    try {
      await api.refreshForecast(businessId);
      await load();
    } finally {
      setRequesting(false);
    }
  }, [businessId, load]);
  const result = useMemo(
    () => (data ? toResult(data, products, settings.minWeeks, settings.topNProducts) : null),
    [data, products, settings.minWeeks, settings.topNProducts],
  );
  const rows = useMemo(
    () =>
      data?.recommendations.flatMap((row): ReorderRow[] => {
        const product = products.find((item) => item.id === row.productId);
        return product
          ? [
              {
                product,
                demandAvailable: row.demandAvailable,
                unavailableReason: row.unavailableReason ?? undefined,
                dailyDemand: row.daily_demand === null ? NaN : Number(row.daily_demand),
                demandDuringLead:
                  row.demand_during_lead_time === null ? NaN : Number(row.demand_during_lead_time),
                reorderPoint: row.reorder_point === null ? NaN : Number(row.reorder_point),
                targetStock: row.target_stock === null ? NaN : Number(row.target_stock),
                reorderQty: Number(row.suggested_quantity),
                daysOfCover: row.days_of_cover === null ? Infinity : Number(row.days_of_cover),
                status: row.status,
                winnerModel: methodName(row.method),
                confidence: row.confidenceLevel,
              },
            ]
          : [];
      }) ?? [],
    [data, products],
  );
  const latest = data?.latestRun;
  const busy = requesting || latest?.status === "queued" || latest?.status === "running";
  const status = busy ? "training" : data?.run && !data.stale ? "ready" : "serving";
  const failure =
    error ??
    (latest?.status === "failed" ? (latest.failureMessage ?? "Forecast failed") : undefined);
  return {
    result,
    rows,
    status,
    refresh,
    error: failure,
    progress: {
      status,
      total: products.length,
      completed: busy ? 0 : products.length,
      message: busy
        ? "Python worker is evaluating and saving forecasts…"
        : (failure ??
          (data?.run
            ? `Saved Python forecast through ${data.run.finalTestEnd}${data.stale ? ". New records or settings detected; refresh forecasts." : ""}`
            : "Python Moving Average baseline. Add sales and refresh to evaluate models.")),
    },
  };
}

function toResult(
  data: ApiDashboard,
  products: Product[],
  minWeeks: number,
  topN: number,
): PipelineResult {
  const byProduct: Record<string, ProductForecast> = {};
  const mlIds = products.filter((p) => data.summaries[p.id]?.eligible).map((p) => p.id);
  const aggregate = (method: string, field: "mae" | "rmse", split = "final_test") => {
    const metrics = data.metrics.filter(
      (m) =>
        m.method === method &&
        m.datasetSplit === split &&
        (mlIds.length ? mlIds.includes(m.productId) : method === "moving_average"),
    );
    const count = metrics.reduce((sum, metric) => sum + metric.observationCount, 0);
    if (!count) return NaN;
    const mean =
      metrics.reduce(
        (sum, metric) =>
          sum +
          metric.observationCount *
            (field === "rmse" ? Number(metric[field]) ** 2 : Number(metric[field])),
        0,
      ) / count;
    return field === "rmse" ? Math.sqrt(mean) : mean;
  };
  for (const product of products) {
    const summary = data.summaries[product.id];
    const points = (split: string): ForecastPoint[] => {
      const grouped = new Map<string, ForecastPoint>();
      for (const row of data.predictions.filter(
        (p) => p.productId === product.id && p.datasetSplit === split,
      )) {
        const point = grouped.get(row.predictionDate) ?? {
          date: row.predictionDate,
          actual: row.actualQuantity === null ? null : Number(row.actualQuantity),
          ma: NaN,
          xgb: NaN,
          ensemble: NaN,
          p10: NaN,
          p50: NaN,
          p90: NaN,
        };
        const method = methodName(row.method);
        if (row.lowerBound !== null && row.upperBound !== null) {
          point.p10 = Number(row.lowerBound);
          point.p50 = Number(row.predictedQuantity);
          point.p90 = Number(row.upperBound);
        }
        if (method === "ma" || method === "rule") point.ma = Number(row.predictedQuantity);
        else point[method] = Number(row.predictedQuantity);
        grouped.set(row.predictionDate, point);
      }
      return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
    };
    const metric = (method: string, field: "mae" | "rmse", split = "final_test") => {
      const value = data.metrics.find(
        (m) => m.productId === product.id && m.method === method && m.datasetSplit === split,
      );
      return value ? Number(value[field]) : NaN;
    };
    const recommendation = data.recommendations.find((r) => r.productId === product.id);
    const method = methodName(summary?.operatingMethod ?? "fallback");
    const weight = summary?.xgbWeight ?? 0;
    byProduct[product.id] = {
      productId: product.id,
      maMae: metric("moving_average", "mae"),
      maRmse: metric("moving_average", "rmse"),
      xgbMae: metric("xgboost", "mae"),
      xgbRmse: metric("xgboost", "rmse"),
      ensembleMae: metric("ensemble", "mae"),
      ensembleRmse: metric("ensemble", "rmse"),
      winner: method,
      method,
      xgbWeight: weight,
      maWeight: 1 - weight,
      holdout: points("final_test"),
      future: points("future"),
      dailyDemand: recommendation?.daily_demand == null ? NaN : Number(recommendation.daily_demand),
      seriesMean: recommendation?.daily_demand == null ? NaN : Number(recommendation.daily_demand),
      confidence: "low",
      confidenceScore: NaN,
      observationCount: summary?.historyDays ?? 0,
      nonzeroCount: summary?.nonzeroDays ?? 0,
      grain: "daily",
      trainedWithMl: summary?.eligible ?? false,
      fallbackReason: summary?.fallbackReason,
      cvMaeXgb: metric("xgboost", "mae", "validation"),
      cvMaeMa: metric("moving_average", "mae", "validation"),
    };
  }
  const validation = ["moving_average", "xgboost", "ensemble"]
    .map((method) => ({ method, mae: aggregate(method, "mae", "validation") }))
    .filter((value) => Number.isFinite(value.mae))
    .sort((a, b) => a.mae - b.mae);
  const summaries = products.map((p) => data.summaries[p.id]).filter(Boolean);
  const maxDays = Math.max(0, ...summaries.map((s) => s.historyDays));
  const parameters = summaries.find((s) => s.parameters)?.parameters;
  const allPoints = Object.values(byProduct).flatMap((f) => [...f.holdout, ...f.future]);
  return {
    trainedAt: data.run?.createdAt ?? "",
    trainedMs: data.run?.timing.totalProcessingMs ?? NaN,
    holdoutStart: data.run?.finalTestStart ?? "",
    holdoutEnd: data.run?.finalTestEnd ?? "",
    horizonEnd:
      allPoints
        .map((p) => p.date)
        .sort()
        .at(-1) ?? data.asOf,
    dates: [...new Set(allPoints.map((p) => p.date))].sort(),
    maMae: aggregate("moving_average", "mae"),
    maRmse: aggregate("moving_average", "rmse"),
    xgbMae: aggregate("xgboost", "mae"),
    xgbRmse: aggregate("xgboost", "rmse"),
    ensembleMae: aggregate("ensemble", "mae"),
    ensembleRmse: aggregate("ensemble", "rmse"),
    winner: methodName(validation[0]?.method ?? "fallback"),
    treesUsed: parameters?.n_estimators ?? 0,
    byProduct,
    diagnostics: {
      minWeeksRequired: minWeeks,
      weeksCovered: maxDays / 7,
      meetsMinimum: maxDays >= minWeeks * 7,
      reliableRange: maxDays >= 180 && maxDays <= 366,
      usedFallbackDataset: false,
      sparseProductCount: products.length - mlIds.length,
      weeklyProductCount: 0,
      dailyProductCount: products.length,
      mlProductIds: mlIds,
      ruleProductIds: products.filter((p) => !mlIds.includes(p.id)).map((p) => p.id),
      skippedReasons: Object.fromEntries(
        products.map((p) => [p.id, data.summaries[p.id]?.fallbackReason ?? ""]),
      ),
      featureNames: ["lag 1", "lag 7", "lag 14", "mean 7", "mean 30", "weekday", "month"],
      avoidedProductIds: true,
      maxDepth: parameters?.max_depth ?? 0,
      learningRate: parameters?.learning_rate ?? 0,
      nEstimatorsCap: parameters?.n_estimators ?? 0,
      cvFolds: Math.max(0, ...summaries.map((s) => s.effectiveFolds ?? 0)),
      earlyStopping: summaries.some((s) => Boolean(s.earlyStoppingUsed)),
      chronologicalSplit: Boolean(data.run),
      ensembleUsedCount: summaries.filter((s) => s.operatingMethod === "ensemble").length,
      xgbUnstableCount: 0,
      lowConfidenceCount: products.length,
      disclaimer: data.message,
      topN,
      trainedProductCount: mlIds.length,
      servingFromCache: Boolean(data.run),
      mode: data.run ? "train" : "serve",
    },
  };
}
