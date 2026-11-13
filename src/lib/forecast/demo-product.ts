/** Synthetic browser prototype. The normal application uses Python XGBoost. */
import { addDays } from "../dates";
import type { Grain, Product, ProductForecast } from "../types";
import { timeSeriesSplit } from "./cv";
import { ensembleWeights, isXgbUnstable, mixPreds, pickWinner } from "./ensemble";
import { categoryIndex, extractFeatures, LOOKBACK, type FeatureContext } from "./features";
import { mae, mean, rmse } from "./metrics";
import { recursiveMovingAverage } from "./moving-average";
import { clipNonNeg, seriesStats } from "./prepare";
import { confidenceFromObs, residualQuantiles, withIntervals } from "./uncertainty";
import { DEFAULT_XGB, predictXgb, trainXgb, type BoostedModel } from "./xgboost";

export function demoSplit(n: number, grain: Grain, holdoutDays: number) {
  const lookback = grain === "weekly" ? 8 : LOOKBACK;
  const testSize =
    grain === "weekly"
      ? Math.min(4, Math.max(1, Math.floor(n * 0.2)))
      : Math.min(holdoutDays, Math.max(1, Math.floor(n * 0.25)));
  const testStart = Math.max(1, n - testSize);
  const validationSize = Math.min(
    Math.max(grain === "weekly" ? 3 : 7, Math.floor(testStart * 0.18)),
    Math.max(0, testStart - lookback - 16),
  );
  const trainEnd = testStart - validationSize;
  const calibrationSize = validationSize >= 20 ? Math.max(10, Math.floor(validationSize / 3)) : 0;
  return { lookback, trainEnd, calibrationStart: testStart - calibrationSize, testStart };
}

type Options = {
  product: Product;
  series: number[];
  dates: string[];
  grain: Grain;
  maWindow: number;
  horizon: number;
  holdoutDays: number;
  minWeeks: number;
  weeks: number;
  reason?: string;
  categories?: string[];
  cvFolds?: number;
};

export function forecastDemoProduct(
  opts: Options,
  useMl: boolean,
): { forecast: ProductForecast; treesUsed: number } {
  const { product, series, dates, grain, maWindow, horizon } = opts;
  const { lookback, trainEnd, calibrationStart, testStart } = demoSplit(
    series.length,
    grain,
    opts.holdoutDays,
  );
  const step = grain === "weekly" ? 7 : 1;
  const ctx: FeatureContext = {
    trainMean: mean(series.slice(0, trainEnd)),
    categoryIndex: categoryIndex(product.category, opts.categories ?? []),
    grain,
  };
  const futureDates = dates.length
    ? Array.from({ length: horizon }, (_, i) => addDays(dates[dates.length - 1], (i + 1) * step))
    : [];
  const actual = series.slice(testStart);
  const validationActual = series.slice(trainEnd, calibrationStart);
  const maValidation = recursiveMovingAverage(
    series.slice(0, trainEnd),
    validationActual.length,
    maWindow,
  );
  const maTest = recursiveMovingAverage(series.slice(0, testStart), actual.length, maWindow);
  const futureMa = recursiveMovingAverage(series, futureDates.length, maWindow);
  let xgbValidation: number[] = [],
    xgbTest: number[] = [],
    futureXgb: number[] = [];
  let trained = false,
    unstable = false,
    treesUsed = 0;
  let weight = { xgb: 0, ma: 1 };

  const fit = (end: number, validationEnd = end, trees?: number): BoostedModel => {
    const features = (from: number, until: number) =>
      Array.from({ length: Math.max(0, until - from) }, (_, i) =>
        extractFeatures(series, from + i, dates[from + i], ctx),
      );
    return trainXgb(
      features(lookback, end),
      series.slice(lookback, end),
      features(end, validationEnd),
      series.slice(end, validationEnd),
      { ...DEFAULT_XGB, ...(trees === undefined ? {} : { nEstimators: trees }) },
    );
  };
  const predict = (model: BoostedModel, history: number[], predictionDates: string[]) => {
    const values = history.slice();
    return predictionDates.map((day) => {
      const value = clipNonNeg(predictXgb(model, extractFeatures(values, values.length, day, ctx)));
      values.push(value);
      return value;
    });
  };

  if (useMl && trainEnd - lookback >= 16 && validationActual.length) {
    // Expanding folds contain training observations only. Every check is recursive.
    const cvX: number[] = [],
      cvMa: number[] = [];
    for (const fold of timeSeriesSplit(trainEnd - lookback, opts.cvFolds ?? 3)) {
      const end = lookback + fold.train.length;
      const checkDates = fold.test.map((i) => dates[lookback + i]);
      const checkActual = fold.test.map((i) => series[lookback + i]);
      const cvModel = fit(end);
      cvX.push(mae(checkActual, predict(cvModel, series.slice(0, end), checkDates)));
      cvMa.push(
        mae(checkActual, recursiveMovingAverage(series.slice(0, end), checkDates.length, maWindow)),
      );
    }
    const selectionModel = fit(trainEnd, calibrationStart);
    treesUsed = selectionModel.treesUsed;
    xgbValidation = predict(
      selectionModel,
      series.slice(0, trainEnd),
      dates.slice(trainEnd, calibrationStart),
    );
    unstable = isXgbUnstable({
      xgbMae: mae(validationActual, xgbValidation),
      maMae: mae(validationActual, maValidation),
      trainRows: trainEnd - lookback,
      seriesMean: ctx.trainMean,
      preds: xgbValidation,
    });
    weight = unstable
      ? { xgb: 0, ma: 1 }
      : ensembleWeights(
          cvX.length ? mean(cvX) : mae(validationActual, xgbValidation),
          cvMa.length ? mean(cvMa) : mae(validationActual, maValidation),
        );
    // Freeze the selected number of trees; neither refit has access to test labels during selection.
    xgbTest = predict(
      fit(testStart, testStart, treesUsed),
      series.slice(0, testStart),
      dates.slice(testStart),
    );
    futureXgb = predict(fit(series.length, series.length, treesUsed), series, futureDates);
    trained = true;
  }
  const ensembleValidation = trained
    ? mixPreds(xgbValidation, maValidation, weight.xgb, weight.ma)
    : [];
  const ensembleTest = trained ? mixPreds(xgbTest, maTest, weight.xgb, weight.ma) : [];
  const ensembleFuture = trained ? mixPreds(futureXgb, futureMa, weight.xgb, weight.ma) : [];
  const method =
    trained && !unstable
      ? pickWinner(
          mae(validationActual, maValidation),
          rmse(validationActual, maValidation),
          mae(validationActual, xgbValidation),
          rmse(validationActual, xgbValidation),
          mae(validationActual, ensembleValidation),
          rmse(validationActual, ensembleValidation),
          false,
        )
      : "ma";

  // Calibration comes after selection and before the untouched final test.
  let quantiles: ReturnType<typeof residualQuantiles> | undefined;
  if (testStart - calibrationStart >= 10) {
    const history = series.slice(0, calibrationStart);
    const calibrationMa = recursiveMovingAverage(history, testStart - calibrationStart, maWindow);
    const calibrationXgb = trained
      ? predict(
          fit(calibrationStart, calibrationStart, treesUsed),
          history,
          dates.slice(calibrationStart, testStart),
        )
      : [];
    const calibrationPrediction =
      method === "ma"
        ? calibrationMa
        : method === "xgb"
          ? calibrationXgb
          : mixPreds(calibrationXgb, calibrationMa, weight.xgb, weight.ma);
    quantiles = residualQuantiles(series.slice(calibrationStart, testStart), calibrationPrediction);
  }
  const makePoints = (
    days: string[],
    actuals: Array<number | null>,
    ma: number[],
    xgb: number[],
    ensemble: number[],
  ) => {
    const points = days.map((date, i) => ({
      date,
      actual: actuals[i] ?? null,
      ma: ma[i] ?? NaN,
      xgb: xgb[i] ?? NaN,
      ensemble: ensemble[i] ?? NaN,
      p10: NaN,
      p50: NaN,
      p90: NaN,
    }));
    return quantiles ? withIntervals(points, quantiles, method) : points;
  };
  const chosenFuture = method === "ma" ? futureMa : method === "xgb" ? futureXgb : ensembleFuture;
  const stats = seriesStats(series);
  const trainingStats = seriesStats(series.slice(0, trainEnd));
  const confidence = confidenceFromObs(trainingStats.nonzeroCount, opts.weeks, opts.minWeeks);
  return {
    treesUsed,
    forecast: {
      productId: product.id,
      method,
      winner: method,
      maMae: mae(actual, maTest),
      maRmse: rmse(actual, maTest),
      xgbMae: trained ? mae(actual, xgbTest) : NaN,
      xgbRmse: trained ? rmse(actual, xgbTest) : NaN,
      ensembleMae: trained ? mae(actual, ensembleTest) : NaN,
      ensembleRmse: trained ? rmse(actual, ensembleTest) : NaN,
      xgbWeight: weight.xgb,
      maWeight: weight.ma,
      holdout: makePoints(dates.slice(testStart), actual, maTest, xgbTest, ensembleTest),
      future: makePoints(
        futureDates,
        futureDates.map(() => null),
        futureMa,
        futureXgb,
        ensembleFuture,
      ),
      dailyDemand: series.length ? mean(chosenFuture) / (grain === "weekly" ? 7 : 1) : NaN,
      seriesMean: series.length ? mean(series) / (grain === "weekly" ? 7 : 1) : NaN,
      confidence: confidence.level,
      confidenceScore: confidence.score,
      observationCount: stats.observationCount,
      nonzeroCount: trainingStats.nonzeroCount,
      grain,
      trainedWithMl: trained,
      demandAvailable: series.length > 0,
      fallbackReason: !series.length
        ? "No usable sales history is available."
        : unstable
          ? "Prototype unstable on validation — using Moving Average."
          : !trained
            ? (opts.reason ?? "Insufficient training and validation history. Moving Average only.")
            : undefined,
      cvMaeXgb: trained ? mae(validationActual, xgbValidation) : NaN,
      cvMaeMa: mae(validationActual, maValidation),
    },
  };
}
