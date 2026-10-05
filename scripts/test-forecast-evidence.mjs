import assert from "node:assert/strict";
import test from "node:test";
import { toReorderRows, toResult } from "../src/lib/api-forecast.ts";
import { currentForecastDashboard } from "../src/lib/forecast-validity.ts";
import { buildReorderRows } from "../src/lib/inventory/reorder.ts";
import { formatForecastDuration } from "../src/lib/forecast-timing.ts";

test("saved training duration uses model fits and preserves separate total processing", () => {
  const timing = { trainingMs: 125, preparationMs: 20, validationEvaluationMs: 40,
    persistenceMs: 15, totalProcessingMs: 210, queueWaitMs: 1000 };
  const data = dashboard({ run: { id: "timed-run", createdAt: "2026-10-04", timing } });
  const mapped = toResult(data, [product], 8, 20);
  assert.equal(mapped.trainedMs, 125);
  assert.deepEqual(mapped.processingTiming, timing);
});

test("unmeasured training stays unavailable even when total processing is saved", () => {
  for (const timing of [{ totalProcessingMs: 30 }, { trainingMs: null, totalProcessingMs: 30 }]) {
    const mapped = toResult(dashboard({ run: { id: "baseline-run", createdAt: "2026-10-04", timing } }), [product], 8, 20);
    assert.ok(Number.isNaN(mapped.trainedMs));
    assert.deepEqual(mapped.processingTiming, timing);
  }
  assert.equal(toResult(dashboard(), [product], 8, 20).processingTiming, undefined);
});

test("duration labels preserve unavailable values and measured zero", () => {
  for (const value of [null, undefined, NaN, Infinity, -1])
    assert.equal(formatForecastDuration(value), "Unavailable");
  assert.equal(formatForecastDuration(0), "0.0 ms");
  assert.equal(formatForecastDuration(125), "125.0 ms");
  assert.equal(formatForecastDuration(1250), "1.25 s");
});

const product = {
  id: "synthetic-product",
  sku: "TEST-1",
  name: "Synthetic example",
  category: "Test",
  unit: "pc",
  currentStock: 20,
  leadTimeDays: 2,
  safetyStock: 2,
  unitCost: 10,
};
function dashboard({ summary = {}, recommendation = {}, ...patch } = {}) {
  return {
    stale: false,
    expired: false,
    forecastThrough: "2026-10-04",
    businessDay: "2026-10-04",
    businessTimezone: "Asia/Singapore",
    run: null,
    latestRun: null,
    asOf: "2026-10-04",
    message: "Synthetic fixture",
    summaries: {
      [product.id]: {
        historyDays: 0,
        nonzeroDays: 0,
        eligible: false,
        operatingMethod: "fallback",
        fallbackReason: "No usable sales history.",
        unknownDays: 12,
        excludedDays: 3,
        qualityWarnings: ["Stockout days excluded."],
        ...summary,
      },
    },
    predictions: [],
    metrics: [],
    recommendations: [
      {
        productId: product.id,
        method: "fallback",
        confidenceLevel: "low",
        demandAvailable: false,
        forecastExpired: false,
        unavailableReason: "No usable current demand.",
        daily_demand: null,
        demand_during_lead_time: null,
        reorder_point: null,
        target_stock: null,
        suggested_quantity: "0",
        days_of_cover: null,
        status: "healthy",
        ...recommendation,
      },
    ],
    ...patch,
  };
}
const result = (data) => toResult(data, [product], 8, 20).byProduct[product.id];
const savedInterval = {
  available: true,
  selectionObservations: 20,
  calibrationObservations: 10,
  calibrationStart: "2026-08-21",
  calibrationEnd: "2026-08-30",
  calibrationSplit: "late_validation_reserved_after_selection",
  lowerResidual: -2.5,
  upperResidual: 4,
  finalTestCoverage: 0.7,
};

test("unavailable history preserves reasons and counts without inventing coverage", () => {
  const data = dashboard();
  const forecast = result(data);
  const [row] = toReorderRows(data, [product]);
  for (const value of [forecast, row]) {
    assert.equal(value.demandAvailable, false);
    assert.ok(Number.isNaN(value.dailyDemand));
    assert.equal(value.fallbackReason, "No usable sales history.");
    assert.equal(value.unavailableReason, "No usable current demand.");
    assert.equal(value.unknownDays, 12);
    assert.equal(value.excludedDays, 3);
    assert.deepEqual(value.qualityWarnings, ["Stockout days excluded."]);
  }
  assert.ok(Number.isNaN(row.daysOfCover));
  assert.ok(Number.isNaN(row.reorderPoint));
  assert.equal(row.reorderQty, 0);
});

test("available zero demand is distinct from unavailable history", () => {
  const data = dashboard({
    summary: { historyDays: 10, unknownDays: 0, excludedDays: 0 },
    recommendation: {
      demandAvailable: true,
      unavailableReason: null,
      daily_demand: "0",
      demand_during_lead_time: "0",
      reorder_point: "2",
      target_stock: "2",
    },
  });
  const [row] = toReorderRows(data, [product]);
  assert.equal(row.demandAvailable, true);
  assert.equal(row.dailyDemand, 0);
  assert.equal(row.daysOfCover, Infinity);
  assert.equal(result(data).unknownDays, 0);
});

test("missing legacy counts and interval evidence remain unknown", () => {
  const data = dashboard();
  delete data.summaries[product.id].unknownDays;
  delete data.summaries[product.id].excludedDays;
  delete data.summaries[product.id].qualityWarnings;
  assert.equal(result(data).interval, undefined);
  assert.equal(result(data).unknownDays, undefined);
  assert.equal(toReorderRows(data, [product])[0].excludedDays, undefined);
});

test("saved calibration evidence maps selected method final-test count and nominal target", () => {
  const data = dashboard({
    summary: { eligible: true, operatingMethod: "ensemble", interval: savedInterval },
    metrics: [
      {
        productId: product.id,
        method: "xgboost",
        datasetSplit: "final_test",
        mae: "1",
        rmse: "2",
        observationCount: 15,
      },
      {
        productId: product.id,
        method: "ensemble",
        datasetSplit: "final_test",
        mae: "1",
        rmse: "2",
        observationCount: 20,
      },
      {
        productId: product.id,
        method: "ensemble",
        datasetSplit: "validation",
        mae: "1",
        rmse: "2",
        observationCount: 30,
      },
    ],
  });
  assert.deepEqual(result(data).interval, {
    ...savedInterval,
    nominalCoverage: 0.8,
    method: "Validation residual quantiles",
    finalTestObservations: 20,
  });
});

test("unavailable and unfamiliar interval protocols do not invent calibration evidence", () => {
  const insufficient = result(
    dashboard({
      summary: {
        interval: {
          ...savedInterval,
          available: false,
          calibrationObservations: 0,
          calibrationStart: null,
          calibrationEnd: null,
          lowerResidual: null,
          upperResidual: null,
          finalTestCoverage: null,
        },
      },
    }),
  );
  assert.equal(insufficient.interval.available, false);
  assert.equal(insufficient.interval.calibrationObservations, 0);
  assert.equal(insufficient.interval.finalTestCoverage, null);
  assert.equal(insufficient.interval.finalTestObservations, undefined);
  const unfamiliar = result(dashboard({ summary: { interval: { available: true } } }));
  assert.equal(unfamiliar.interval.nominalCoverage, undefined);
  assert.equal(unfamiliar.interval.method, undefined);
});

test("expiry removes current predictions while retaining archived calibration evidence", () => {
  const data = dashboard({
    summary: { interval: savedInterval },
    recommendation: { demandAvailable: true, daily_demand: "3", unavailableReason: null },
    predictions: [
      {
        productId: product.id,
        predictionDate: "2026-10-04",
        method: "ensemble",
        datasetSplit: "future",
        predictedQuantity: "3",
        actualQuantity: null,
        lowerBound: "1",
        upperBound: "7",
      },
    ],
  });
  const expired = currentForecastDashboard(data, new Date("2026-10-04T16:01:00Z"));
  const forecast = result(expired);
  assert.equal(forecast.forecastExpired, true);
  assert.equal(forecast.demandAvailable, false);
  assert.equal(forecast.future.length, 0);
  assert.equal(forecast.interval.available, true);
  assert.equal(forecast.interval.calibrationObservations, 10);
  assert.equal(toReorderRows(expired, [product])[0].daysOfCover.toString(), "NaN");
});

test("browser recommendations also distinguish missing forecasts from observed zero demand", () => {
  const settings = { coverDays: 10 };
  const missing = buildReorderRows([product], { byProduct: {}, winner: "ma" }, settings)[0];
  assert.equal(missing.demandAvailable, false);
  assert.ok(Number.isNaN(missing.daysOfCover));
  assert.equal(missing.reorderQty, 0);
  const zero = buildReorderRows(
    [product],
    {
      byProduct: { [product.id]: { dailyDemand: 0, observationCount: 10, method: "ma" } },
      winner: "ma",
    },
    settings,
  )[0];
  assert.equal(zero.demandAvailable, true);
  assert.equal(zero.daysOfCover, Infinity);
});

test("invalid demand never turns an API recommendation into available coverage", () => {
  for (const daily_demand of ["NaN", "-1", "Infinity", null]) {
    const data = dashboard({ recommendation: { demandAvailable: true, daily_demand } });
    assert.equal(result(data).demandAvailable, false);
    const [row] = toReorderRows(data, [product]);
    assert.equal(row.demandAvailable, false);
    assert.ok(Number.isNaN(row.daysOfCover));
  }
});

test("inactive products retain archived input records but leave current advice and evaluation scope", () => {
  const inactive = { ...product, id: "archived-product", sku: "ARCHIVED-1", isActive: false };
  const data = dashboard({
    metrics: [
      {
        productId: product.id,
        method: "moving_average",
        datasetSplit: "final_test",
        mae: "2",
        rmse: "3",
        observationCount: 10,
      },
      {
        productId: inactive.id,
        method: "moving_average",
        datasetSplit: "final_test",
        mae: "90",
        rmse: "100",
        observationCount: 100,
      },
    ],
  });
  data.recommendations.push({ ...data.recommendations[0], productId: inactive.id });
  data.summaries[inactive.id] = { ...data.summaries[product.id] };
  const current = toResult(data, [product, inactive], 8, 20);
  assert.equal(current.maMae, 2);
  assert.equal(current.maRmse, 3);
  assert.deepEqual(Object.keys(current.byProduct), [product.id]);
  assert.deepEqual(
    toReorderRows(data, [product, inactive]).map((row) => row.product.id),
    [product.id],
  );
  assert.equal(data.metrics.length, 2);
  assert.equal(data.recommendations.length, 2);
});

test("an entirely inactive catalog has no current forecast scores or restock recommendations", () => {
  const inactive = { ...product, isActive: false };
  const data = dashboard({
    metrics: [
      {
        productId: product.id,
        method: "moving_average",
        datasetSplit: "final_test",
        mae: "2",
        rmse: "3",
        observationCount: 10,
      },
    ],
  });
  const current = toResult(data, [inactive], 8, 20);
  assert.ok(Number.isNaN(current.maMae));
  assert.ok(Number.isNaN(current.maRmse));
  assert.deepEqual(current.byProduct, {});
  assert.deepEqual(toReorderRows(data, [inactive]), []);
  assert.deepEqual(buildReorderRows([inactive], current, { coverDays: 10 }), []);
});
