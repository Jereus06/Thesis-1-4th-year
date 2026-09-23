import { addDays } from "@/lib/dates";
import { AS_OF } from "@/lib/data/seed";
import { createFallbackSales, FALLBACK_LABEL } from "@/lib/data/fallback";
import type {
  ForecastMethod,
  ForecastPoint,
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
} from "./constants";
import { timeSeriesSplit } from "./cv";
import { ensembleWeights, isXgbUnstable, mixPreds, pickWinner } from "./ensemble";
import {
  categoryIndex,
  extractFeatures,
  FEATURE_NAMES,
  LOOKBACK,
  uniqueCategories,
  type FeatureContext,
} from "./features";
import { mae, mean, rmse } from "./metrics";
import { rollingMovingAverage } from "./moving-average";
import {
  aggregateWeekly,
  buildDailySeries,
  clipNonNeg,
  recentMean,
  saleDateRange,
  selectTrainScope,
  seriesStats,
  weeksCovered,
} from "./prepare";
import { confidenceFromObs, residualQuantiles, withIntervals } from "./uncertainty";
import { DEFAULT_XGB, predictXgb, trainXgb } from "./xgboost";

export type PipelineOptions = {
  mode?: PipelineMode;
  onProgress?: (completed: number, total: number, name?: string) => void;
  yieldFn?: () => Promise<void>;
};

function lookbackFor(grain: Grain): number {
  return grain === "weekly" ? 8 : LOOKBACK;
}

function holdoutLen(n: number, grain: Grain, holdoutDays: number): number {
  if (grain === "weekly") return Math.min(4, Math.max(2, Math.floor(n * 0.2)));
  return Math.min(holdoutDays, Math.max(7, Math.floor(n * 0.25)));
}

function alignPreds(actual: number[], predicted: number[], fallback: number[]): number[] {
  return actual.map((_, i) => {
    const value = predicted[i];
    if (Number.isFinite(value)) return value as number;
    const alt = fallback[i];
    return Number.isFinite(alt) ? alt : 0;
  });
}

function points(
  dates: string[],
  actual: Array<number | null>,
  ma: number[],
  xgb: number[],
  ensemble: number[],
): ForecastPoint[] {
  return dates.map((date, i) => {
    const e = ensemble[i] ?? 0;
    return {
      date,
      actual: actual[i] ?? null,
      ma: ma[i] ?? 0,
      xgb: xgb[i] ?? 0,
      ensemble: e,
      p10: e,
      p50: e,
      p90: e,
    };
  });
}

function toDailyDemand(level: number, grain: Grain): number {
  return grain === "weekly" ? level / 7 : level;
}

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
          ? `Partner slice is ${weeks.toFixed(1)} weeks (< ${minWeeks}). ${FALLBACK_LABEL}.`
          : `History is ${weeks.toFixed(1)} weeks (< ${minWeeks}). ${FALLBACK_LABEL}.`,
    };
  }
  return { sales: working, usedFallback: false };
}

function forecastRuleProduct(opts: {
  product: Product;
  series: number[];
  dates: string[];
  grain: Grain;
  maWindow: number;
  horizon: number;
  holdoutDays: number;
  reason?: string;
  minWeeks: number;
  weeks: number;
}): ProductForecast {
  const { series, dates, grain, maWindow, horizon, holdoutDays } = opts;
  const lb = lookbackFor(grain);
  const holdoutDaysUsed = holdoutLen(dates.length, grain, holdoutDays);
  const holdoutStartIdx = Math.max(lb, dates.length - holdoutDaysUsed);
  const holdoutActual = series.slice(holdoutStartIdx);
  const maPred = rollingMovingAverage(series, holdoutStartIdx, series.length, maWindow);
  const lastMa = recentMean(series, maWindow);
  const step = grain === "weekly" ? 7 : 1;
  const futDates: string[] = [];
  let cursor = addDays(dates[dates.length - 1], step);
  for (let h = 0; h < horizon; h++) {
    futDates.push(cursor);
    cursor = addDays(cursor, step);
  }
  const futureMa = Array.from({ length: horizon }, () => lastMa);
  const maMae = mae(holdoutActual, maPred);
  const maRmse = rmse(holdoutActual, maPred);
  const stats = seriesStats(series);
  const conf = confidenceFromObs(stats.nonzeroCount, opts.weeks, opts.minWeeks);
  const holdoutPts = points(
    dates.slice(holdoutStartIdx),
    holdoutActual,
    maPred,
    maPred,
    maPred,
  );
  const futurePts = points(futDates, futDates.map(() => null), futureMa, futureMa, futureMa);
  const q = residualQuantiles(holdoutActual, maPred);
  return {
    productId: opts.product.id,
    maMae,
    maRmse,
    xgbMae: Number.NaN,
    xgbRmse: Number.NaN,
    ensembleMae: maMae,
    ensembleRmse: maRmse,
    winner: "rule",
    method: "rule",
    xgbWeight: 0,
    maWeight: 1,
    holdout: withIntervals(holdoutPts, q),
    future: withIntervals(futurePts, q),
    dailyDemand: toDailyDemand(lastMa, grain),
    seriesMean: toDailyDemand(mean(series), grain),
    confidence: conf.level,
    confidenceScore: conf.score,
    observationCount: stats.observationCount,
    nonzeroCount: stats.nonzeroCount,
    grain,
    trainedWithMl: false,
    fallbackReason: opts.reason,
    cvMaeXgb: Number.NaN,
    cvMaeMa: maMae,
  };
}

function forecastMlProduct(opts: {
  product: Product;
  series: number[];
  dates: string[];
  grain: Grain;
  maWindow: number;
  horizon: number;
  holdoutDays: number;
  mode: PipelineMode;
  categories: string[];
  cvFolds: number;
  minWeeks: number;
  weeks: number;
}): { forecast: ProductForecast; treesUsed: number } {
  const { series, dates, grain, maWindow, horizon, holdoutDays, mode, categories } = opts;
  const lb = lookbackFor(grain);
  const holdoutDaysUsed = holdoutLen(dates.length, grain, holdoutDays);
  const holdoutStartIdx = Math.max(lb + (grain === "weekly" ? 4 : 14), dates.length - holdoutDaysUsed);
  const holdoutActual = series.slice(holdoutStartIdx);
  const maPred = rollingMovingAverage(series, holdoutStartIdx, series.length, maWindow);
  const trainMean = mean(series.slice(0, holdoutStartIdx));
  const ctx: FeatureContext = {
    trainMean,
    categoryIndex: categoryIndex(opts.product.category, categories),
    grain,
  };

  const X: number[][] = [];
  const y: number[] = [];
  const rowIndex: number[] = [];
  for (let t = lb; t < series.length; t++) {
    X.push(extractFeatures(series, t, dates[t], ctx));
    y.push(series[t]);
    rowIndex.push(t);
  }

  const trainRows: number[] = [];
  const testRows: number[] = [];
  for (let i = 0; i < rowIndex.length; i++) {
    if (rowIndex[i] >= holdoutStartIdx) testRows.push(i);
    else trainRows.push(i);
  }

  const lastMa = recentMean(series, maWindow);
  const step = grain === "weekly" ? 7 : 1;
  const futDates: string[] = [];
  let cursor = addDays(dates[dates.length - 1], step);
  for (let h = 0; h < horizon; h++) {
    futDates.push(cursor);
    cursor = addDays(cursor, step);
  }
  const futureMa = Array.from({ length: horizon }, () => lastMa);

  let xgbHoldout = maPred.slice();
  let futureXgb = futureMa.slice();
  let treesUsed = 0;
  let cvMaeXgb = Number.NaN;
  let cvMaeMa = Number.NaN;
  let trained = false;

  if (mode === "train" && trainRows.length >= 16 && testRows.length === holdoutActual.length) {
    const folds = timeSeriesSplit(trainRows.length, opts.cvFolds);
    const cvX: number[] = [];
    const cvM: number[] = [];
    for (const fold of folds) {
      const Xfit = fold.train.map((i) => X[trainRows[i]]);
      const yfit = fold.train.map((i) => y[trainRows[i]]);
      const Xte = fold.test.map((i) => X[trainRows[i]]);
      const yte = fold.test.map((i) => y[trainRows[i]]);
      if (Xfit.length < 16 || yte.length < 4) continue;
      const valCut = Math.max(4, Math.floor(Xfit.length * 0.2));
      const model = trainXgb(
        Xfit.slice(0, Xfit.length - valCut),
        yfit.slice(0, yfit.length - valCut),
        Xfit.slice(Xfit.length - valCut),
        yfit.slice(yfit.length - valCut),
        DEFAULT_XGB,
      );
      const xPred = Xte.map((row) => clipNonNeg(predictXgb(model, row)));
      const maFold = yte.map((_, j) => {
        const t = rowIndex[trainRows[fold.test[j]]];
        const from = Math.max(0, t - maWindow);
        return mean(series.slice(from, t));
      });
      cvX.push(mae(yte, xPred));
      cvM.push(mae(yte, maFold));
    }
    if (cvX.length) cvMaeXgb = mean(cvX);
    if (cvM.length) cvMaeMa = mean(cvM);

    const valCount = Math.max(grain === "weekly" ? 3 : 7, Math.floor(trainRows.length * 0.18));
    const valStart = Math.max(0, trainRows.length - valCount);
    const fitRows = trainRows.slice(0, valStart);
    const valRows = trainRows.slice(valStart);
    if (fitRows.length >= 16) {
      const model = trainXgb(
        fitRows.map((i) => X[i]),
        fitRows.map((i) => y[i]),
        valRows.map((i) => X[i]),
        valRows.map((i) => y[i]),
        DEFAULT_XGB,
      );
      treesUsed = model.treesUsed;
      trained = true;
      xgbHoldout = alignPreds(
        holdoutActual,
        testRows.map((i) => clipNonNeg(predictXgb(model, X[i]))),
        maPred,
      );
      const hist = series.slice();
      let fc = addDays(dates[dates.length - 1], step);
      futureXgb = [];
      for (let h = 0; h < horizon; h++) {
        const t = hist.length;
        const x = extractFeatures(hist, t, fc, ctx);
        const pred = clipNonNeg(predictXgb(model, x));
        futureXgb.push(pred);
        hist.push(pred);
        fc = addDays(fc, step);
      }
    }
  }

  const maMae = mae(holdoutActual, maPred);
  const maRmse = rmse(holdoutActual, maPred);
  const xgbMae = mae(holdoutActual, xgbHoldout);
  const xgbRmse = rmse(holdoutActual, xgbHoldout);
  const unstable = !trained || isXgbUnstable({
    xgbMae,
    maMae,
    trainRows: trainRows.length,
    seriesMean: trainMean,
    preds: xgbHoldout,
  });

  const weights = unstable
    ? { xgb: 0, ma: 1 }
    : ensembleWeights(
        Number.isFinite(cvMaeXgb) ? cvMaeXgb : xgbMae,
        Number.isFinite(cvMaeMa) ? cvMaeMa : maMae,
      );
  const ensHoldout = mixPreds(xgbHoldout, maPred, weights.xgb, weights.ma);
  const ensFuture = mixPreds(futureXgb, futureMa, weights.xgb, weights.ma);
  const ensembleMae = mae(holdoutActual, ensHoldout);
  const ensembleRmse = rmse(holdoutActual, ensHoldout);
  const winner = unstable
    ? "ma"
    : pickWinner(maMae, maRmse, xgbMae, xgbRmse, ensembleMae, ensembleRmse, unstable);
  const method: ForecastMethod = unstable ? "ma" : "ensemble";
  const chosenFuture = method === "ma" ? futureMa : ensFuture;

  const holdoutPts = points(
    dates.slice(holdoutStartIdx),
    holdoutActual,
    maPred,
    xgbHoldout,
    ensHoldout,
  );
  const futurePts = points(
    futDates,
    futDates.map(() => null),
    futureMa,
    futureXgb,
    ensFuture,
  );
  const q = residualQuantiles(holdoutActual, method === "ma" ? maPred : ensHoldout);
  const stats = seriesStats(series);
  const conf = confidenceFromObs(stats.nonzeroCount, opts.weeks, opts.minWeeks);

  return {
    treesUsed,
    forecast: {
      productId: opts.product.id,
      maMae,
      maRmse,
      xgbMae: trained ? xgbMae : Number.NaN,
      xgbRmse: trained ? xgbRmse : Number.NaN,
      ensembleMae: trained ? ensembleMae : maMae,
      ensembleRmse: trained ? ensembleRmse : maRmse,
      winner,
      method,
      xgbWeight: weights.xgb,
      maWeight: weights.ma,
      holdout: withIntervals(holdoutPts, q),
      future: withIntervals(futurePts, q),
      dailyDemand: toDailyDemand(mean(chosenFuture.length ? chosenFuture : series.slice(-7)), grain),
      seriesMean: toDailyDemand(mean(series), grain),
      confidence: conf.level,
      confidenceScore: conf.score,
      observationCount: stats.observationCount,
      nonzeroCount: stats.nonzeroCount,
      grain,
      trainedWithMl: trained && !unstable,
      fallbackReason: unstable && mode === "train" ? "XGBoost unstable — fell back to Moving Average" : undefined,
      cvMaeXgb,
      cvMaeMa,
    },
  };
}

function productSeries(
  sales: Sale[],
  productId: string,
  dailyDates: string[],
  grain: Grain,
): { series: number[]; dates: string[] } {
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
  const started = Date.now();
  const mode: PipelineMode = options.mode ?? "train";
  const minWeeks = settings.minWeeks ?? MIN_WEEKS;
  const topN = settings.topNProducts ?? 8;
  const cvFolds = settings.cvFolds ?? CV_FOLDS;
  const resolved = resolveSales(products, sales, settings);
  const range = saleDateRange(resolved.sales, addDays(AS_OF, -56), addDays(AS_OF, -1));
  const weeks = weeksCovered(range.start, range.end);
  const months = weeks / 4.345;
  const scope = selectTrainScope(products, resolved.sales, range.dates, topN);
  const categories = uniqueCategories(products);
  const horizon = settings.forecastHorizon;
  const maWindow = settings.maWindow;

  const byProduct: Record<string, ProductForecast> = {};
  const allMaActual: number[] = [];
  const allMaPred: number[] = [];
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
        reason: mode === "serve" && scope.ml.some((p) => p.id === product.id)
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
    const holdAct = f.holdout.map((p) => p.actual ?? 0);
    const holdMa = f.holdout.map((p) => p.ma);
    allMaActual.push(...holdAct);
    allMaPred.push(...holdMa);
    if (f.trainedWithMl) {
      allXgbActual.push(...holdAct);
      allXgbPred.push(...f.holdout.map((p) => p.xgb));
      allEnsActual.push(...holdAct);
      allEnsPred.push(...f.holdout.map((p) => p.ensemble));
    }

    completed += 1;
    options.onProgress?.(completed, worklist.length, product.name);
    if (options.yieldFn) await options.yieldFn();
  }

  const maMae = mae(allMaActual, allMaPred);
  const maRmse = rmse(allMaActual, allMaPred);
  const xgbMae = allXgbActual.length ? mae(allXgbActual, allXgbPred) : Number.NaN;
  const xgbRmse = allXgbActual.length ? rmse(allXgbActual, allXgbPred) : Number.NaN;
  const ensembleMae = allEnsActual.length ? mae(allEnsActual, allEnsPred) : maMae;
  const ensembleRmse = allEnsActual.length ? rmse(allEnsActual, allEnsPred) : maRmse;
  const winner = pickWinner(maMae, maRmse, xgbMae, xgbRmse, ensembleMae, ensembleRmse, !allXgbActual.length);

  const lowConfidenceCount = Object.values(byProduct).filter((p) => p.nonzeroCount < LOW_CONFIDENCE_OBS).length;
  const sparseProductCount = Object.values(byProduct).filter((p) => p.grain === "weekly").length;

  const diagnostics: PipelineDiagnostics = {
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
    disclaimer: DISCLAIMER,
    topN,
    trainedProductCount: Object.values(byProduct).filter((p) => p.trainedWithMl).length,
    servingFromCache: mode === "serve",
    mode,
  };

  return {
    trainedAt: AS_OF,
    trainedMs: Date.now() - started,
    holdoutStart: range.dates[Math.max(0, range.dates.length - settings.holdoutDays)] ?? range.start,
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
