import { addDays, enumerateDays } from "@/lib/dates";
import { AS_OF } from "@/lib/data/seed";
import { createFallbackSales, FALLBACK_LABEL } from "@/lib/data/fallback";
import type {
  Grain,
  PipelineDiagnostics,
  PipelineMode,
  PipelineResult,
  Product,
  ProductForecast,
  Sale,
  Settings,
} from "@/lib/types";
import {
  CV_FOLDS,
  DISCLAIMER,
  LOW_CONFIDENCE_OBS,
  MIN_WEEKS,
  RELIABLE_MONTHS_MAX,
  RELIABLE_MONTHS_MIN,
  SPARSE_ZERO_SHARE,
} from "./constants";
import { FEATURE_NAMES, uniqueCategories } from "./features";
import { hasMixedUnits, mae, rmse } from "./metrics";
import {
  aggregateWeekly,
  buildDailySeries,
  isDemoSale,
  saleDateRange,
  selectTrainScope,
  weeksCovered,
} from "./prepare";
import { DEFAULT_XGB } from "./xgboost";
import { demoSplit, forecastDemoProduct } from "./demo-product";

export type PipelineOptions = {
  mode?: PipelineMode;
  onProgress?: (completed: number, total: number, name?: string) => void;
  yieldFn?: () => Promise<void>;
};

const forecastRuleProduct = (opts: Parameters<typeof forecastDemoProduct>[0]) =>
  forecastDemoProduct(opts, false).forecast;
const forecastMlProduct = (
  opts: Parameters<typeof forecastDemoProduct>[0] & { mode: PipelineMode },
) => forecastDemoProduct(opts, true);

function resolveSales(
  products: Product[],
  sales: Sale[],
  settings: Settings,
): { sales: Sale[]; usedFallback: boolean; reason?: string } {
  const scenario = settings.dataScenario ?? "partner";
  let working = sales;
  if (scenario === "thin") {
    const { end } = saleDateRange(sales, AS_OF, AS_OF);
    const cut = addDays(end, -27);
    working = sales.filter((s) => s.date >= cut);
  }
  const range = saleDateRange(working, addDays(AS_OF, -56), addDays(AS_OF, -1));
  const weeks = weeksCovered(range.start, range.end);
  const minWeeks = settings.minWeeks ?? MIN_WEEKS;
  if (weeks < minWeeks && (settings.useFallbackIfThin ?? true)) {
    return {
      sales: createFallbackSales(products),
      usedFallback: true,
      reason:
        scenario === "thin"
          ? `Demonstration slice is ${weeks.toFixed(1)} weeks (< ${minWeeks}). ${FALLBACK_LABEL}.`
          : `History is ${weeks.toFixed(1)} weeks (< ${minWeeks}). ${FALLBACK_LABEL}.`,
    };
  }
  return { sales: working, usedFallback: false };
}

function productSeries(
  sales: Sale[],
  productId: string,
  dailyDates: string[],
  grain: Grain,
): { series: number[]; dates: string[] } {
  const productSales = sales.filter((sale) => sale.productId === productId);
  if (!productSales.length) return { series: [], dates: [] };
  if (!productSales.every(isDemoSale)) {
    // Browser imports have no reviewed-zero contract. Only a contiguous observed
    // tail can supply calendar lags; preserve stored sales without inventing zeros.
    const observed = new Set(productSales.map((sale) => sale.date));
    const last = productSales
      .map((sale) => sale.date)
      .sort()
      .at(-1)!;
    let first = last;
    while (observed.has(addDays(first, -1))) first = addDays(first, -1);
    dailyDates = enumerateDays(first, last);
  }
  const daily = buildDailySeries(sales, productId, dailyDates);
  if (grain === "weekly") return aggregateWeekly(dailyDates, daily);
  return { series: daily, dates: dailyDates };
}

export async function runPipeline(
  products: Product[],
  sales: Sale[],
  settings: Settings,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  products = products.filter((product) => product.isActive !== false);
  const activeIds = new Set(products.map((product) => product.id));
  sales = sales.filter((sale) => activeIds.has(sale.productId));
  const started = Date.now();
  const mode: PipelineMode = options.mode ?? "train";
  const minWeeks = settings.minWeeks ?? MIN_WEEKS;
  const topN = settings.topNProducts ?? 8;
  const cvFolds = settings.cvFolds ?? CV_FOLDS;
  const resolved = resolveSales(products, sales, settings);
  const range = saleDateRange(resolved.sales, addDays(AS_OF, -56), addDays(AS_OF, -1));
  const weeks = weeksCovered(range.start, range.end);
  const months = weeks / 4.345;
  const trainingDatesById: Record<string, string[]> = {};
  const grainById: Record<string, Grain> = {};
  for (const product of products) {
    const daily = productSeries(resolved.sales, product.id, range.dates, "daily");
    const dailyTraining = daily.series.slice(
      0,
      demoSplit(daily.series.length, "daily", settings.holdoutDays).trainEnd,
    );
    const nonzero = dailyTraining.filter((quantity) => quantity > 0).length;
    const grain: Grain =
      dailyTraining.length && 1 - nonzero / dailyTraining.length > SPARSE_ZERO_SHARE
        ? "weekly"
        : "daily";
    grainById[product.id] = grain;
    const prepared = productSeries(resolved.sales, product.id, range.dates, grain);
    const end = demoSplit(prepared.series.length, grain, settings.holdoutDays).trainEnd;
    const last = prepared.dates[Math.min(end, prepared.dates.length) - 1];
    trainingDatesById[product.id] = last
      ? enumerateDays(prepared.dates[0], grain === "weekly" ? addDays(last, 6) : last)
      : [];
  }
  const scope = selectTrainScope(
    products,
    resolved.sales,
    range.dates,
    topN,
    minWeeks,
    settings.minimumNonzeroDays,
    trainingDatesById,
  );
  scope.grainById = grainById;
  const categories = uniqueCategories(products);
  const horizon = settings.forecastHorizon;
  const maWindow = settings.maWindow;

  const byProduct: Record<string, ProductForecast> = {};
  const allMaActual: number[] = [];
  const allMaPred: number[] = [];
  const baselineActual: number[] = [];
  const baselinePred: number[] = [];
  const allXgbActual: number[] = [];
  const allXgbPred: number[] = [];
  const allEnsActual: number[] = [];
  const allEnsPred: number[] = [];
  let treesUsed = 0;
  let ensembleUsedCount = 0;
  let xgbUnstableCount = 0;
  let weeklyProductCount = 0;

  const worklist = [...scope.ml, ...scope.rule];
  let completed = 0;
  options.onProgress?.(0, worklist.length);

  for (const product of worklist) {
    const grain = scope.grainById[product.id] ?? "daily";
    if (grain === "weekly") weeklyProductCount += 1;
    const { series, dates } = productSeries(resolved.sales, product.id, range.dates, grain);
    const isMl = scope.ml.some((p) => p.id === product.id) && mode === "train";
    const horizonUsed = grain === "weekly" ? Math.max(2, Math.ceil(horizon / 7)) : horizon;
    const maUsed = grain === "weekly" ? Math.max(2, Math.round(maWindow / 7) || 4) : maWindow;

    if (!isMl) {
      const forecast = forecastRuleProduct({
        product,
        series,
        dates,
        grain,
        maWindow: maUsed,
        horizon: horizonUsed,
        holdoutDays: settings.holdoutDays,
        reason:
          mode === "serve" && scope.ml.some((p) => p.id === product.id)
            ? "Serving cached path — Moving Average until background training finishes"
            : scope.reasons[product.id],
        minWeeks,
        weeks,
      });
      if (mode === "serve" && scope.ml.some((p) => p.id === product.id)) {
        forecast.method = "ma";
        forecast.winner = "ma";
        forecast.fallbackReason = "Serving path — XGBoost trains asynchronously";
      }
      byProduct[product.id] = forecast;
    } else {
      const { forecast, treesUsed: used } = forecastMlProduct({
        product,
        series,
        dates,
        grain,
        maWindow: maUsed,
        horizon: horizonUsed,
        holdoutDays: settings.holdoutDays,
        mode,
        categories,
        cvFolds,
        minWeeks,
        weeks,
      });
      treesUsed = Math.max(treesUsed, used);
      if (forecast.method === "ensemble") ensembleUsedCount += 1;
      if (forecast.fallbackReason?.includes("unstable")) xgbUnstableCount += 1;
      byProduct[product.id] = forecast;
    }

    const f = byProduct[product.id];
    const holdAct = f.holdout.map((p) => p.actual ?? NaN);
    const holdMa = f.holdout.map((p) => p.ma);
    baselineActual.push(...holdAct);
    baselinePred.push(...holdMa);
    if (f.trainedWithMl) {
      allMaActual.push(...holdAct);
      allMaPred.push(...holdMa);
      allXgbActual.push(...holdAct);
      allXgbPred.push(...f.holdout.map((p) => p.xgb));
      allEnsActual.push(...holdAct);
      allEnsPred.push(...f.holdout.map((p) => p.ensemble));
    }

    completed += 1;
    options.onProgress?.(completed, worklist.length, product.name);
    if (options.yieldFn) await options.yieldFn();
  }

  const mixedUnits = hasMixedUnits(
    worklist.filter((product) =>
      allXgbActual.length
        ? byProduct[product.id].trainedWithMl
        : byProduct[product.id].holdout.length > 0,
    ),
  );
  const comparableGrains =
    new Set(
      Object.values(byProduct)
        .filter((f) => (allXgbActual.length ? f.trainedWithMl : f.holdout.length > 0))
        .map((f) => f.grain),
    ).size <= 1;
  const canPool = !mixedUnits && comparableGrains;
  const maMae = canPool
    ? mae(
        allMaActual.length ? allMaActual : baselineActual,
        allMaActual.length ? allMaPred : baselinePred,
      )
    : NaN;
  const maRmse = canPool
    ? rmse(
        allMaActual.length ? allMaActual : baselineActual,
        allMaActual.length ? allMaPred : baselinePred,
      )
    : NaN;
  const xgbMae = canPool && allXgbActual.length ? mae(allXgbActual, allXgbPred) : Number.NaN;
  const xgbRmse = canPool && allXgbActual.length ? rmse(allXgbActual, allXgbPred) : Number.NaN;
  const ensembleMae = canPool && allEnsActual.length ? mae(allEnsActual, allEnsPred) : NaN;
  const ensembleRmse = canPool && allEnsActual.length ? rmse(allEnsActual, allEnsPred) : NaN;
  // Per-product operating methods were frozen on validation; final-test errors never select one.
  const methods = new Set(Object.values(byProduct).map((forecast) => forecast.method));
  const winner = methods.size === 1 ? Object.values(byProduct)[0].method : "ma";

  const lowConfidenceCount = Object.values(byProduct).filter(
    (p) => p.nonzeroCount < LOW_CONFIDENCE_OBS,
  ).length;
  const sparseProductCount = Object.values(byProduct).filter((p) => p.grain === "weekly").length;

  const diagnostics: PipelineDiagnostics = {
    maWindow,
    minWeeksRequired: minWeeks,
    weeksCovered: weeks,
    meetsMinimum: weeks >= minWeeks && !resolved.usedFallback,
    reliableRange: months >= RELIABLE_MONTHS_MIN && months <= RELIABLE_MONTHS_MAX + 0.5,
    usedFallbackDataset: resolved.usedFallback,
    fallbackReason: resolved.reason,
    sparseProductCount,
    weeklyProductCount,
    dailyProductCount: products.length - weeklyProductCount,
    mlProductIds: scope.ml.map((p) => p.id),
    ruleProductIds: scope.rule.map((p) => p.id),
    skippedReasons: scope.reasons,
    featureNames: [...FEATURE_NAMES],
    avoidedProductIds: true,
    maxDepth: DEFAULT_XGB.maxDepth,
    learningRate: DEFAULT_XGB.learningRate,
    nEstimatorsCap: DEFAULT_XGB.nEstimators,
    cvFolds,
    earlyStopping: true,
    chronologicalSplit: true,
    ensembleUsedCount,
    xgbUnstableCount,
    lowConfidenceCount,
    comparisonMixedUnits: mixedUnits,
    comparisonWinnerAvailable:
      canPool &&
      methods.size === 1 &&
      Object.values(byProduct).every((f) => Number.isFinite(f.cvMaeMa)),
    disclaimer: DISCLAIMER,
    topN,
    trainedProductCount: Object.values(byProduct).filter((p) => p.trainedWithMl).length,
    servingFromCache: mode === "serve",
    mode,
  };

  return {
    runId: mode === "train" ? `demo-${crypto.randomUUID()}` : undefined,
    forecastHorizonDays: horizon,
    trainedAt: AS_OF,
    trainedMs: Date.now() - started,
    holdoutStart:
      range.dates[Math.max(0, range.dates.length - settings.holdoutDays)] ?? range.start,
    holdoutEnd: range.end,
    horizonEnd: addDays(range.end, horizon),
    dates: range.dates,
    maMae,
    maRmse,
    xgbMae,
    xgbRmse,
    ensembleMae,
    ensembleRmse,
    winner,
    treesUsed,
    byProduct,
    diagnostics,
  };
}
