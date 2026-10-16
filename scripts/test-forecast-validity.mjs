import assert from "node:assert/strict";
import test from "node:test";
import { currentForecastDashboard } from "../src/lib/forecast-validity.ts";

function snapshot(overrides = {}) {
  return {
    businessDay: "2026-10-02",
    businessTimezone: "Asia/Manila",
    forecastThrough: "2026-10-02",
    expired: false,
    stale: false,
    predictions: [
      { productId: "p", datasetSplit: "final_test", predictionDate: "2026-09-30" },
      { productId: "p", datasetSplit: "future", predictionDate: "2026-10-02" },
    ],
    recommendations: [
      {
        productId: "p",
        forecastExpired: false,
        demandAvailable: true,
        daily_demand: "5",
        demand_during_lead_time: "10",
        reorder_point: "12",
        target_stock: "47",
        suggested_quantity: "45",
        days_of_cover: "0.4",
        status: "reorder",
      },
    ],
    ...overrides,
  };
}

test("the final forecast day stays current in the business timezone", () => {
  const data = snapshot();
  const current = currentForecastDashboard(data, new Date("2026-10-02T15:59:59Z"));
  assert.equal(current.expired, false);
  assert.equal(current.recommendations[0].daily_demand, "5");
  assert.equal(current.predictions.length, 2);
});

test("business midnight expires cached advice even without a new API response", () => {
  const data = snapshot();
  const current = currentForecastDashboard(data, new Date("2026-10-02T16:00:00Z"));
  assert.equal(current.businessDay, "2026-10-03");
  assert.equal(current.expired, true);
  assert.equal(current.recommendations[0].forecastExpired, true);
  assert.equal(current.recommendations[0].demandAvailable, false);
  assert.equal(current.recommendations[0].daily_demand, null);
  assert.equal(current.recommendations[0].reorder_point, null);
  assert.equal(current.recommendations[0].suggested_quantity, "0");
  assert.deepEqual(current.predictions, [data.predictions[0]]);
  assert.equal(data.recommendations[0].daily_demand, "5");
});

test("a partially passed horizon withholds yesterday's average until reloaded", () => {
  const data = snapshot({ forecastThrough: "2026-10-04" });
  data.predictions.push({
    productId: "p",
    datasetSplit: "future",
    predictionDate: "2026-10-04",
  });
  const current = currentForecastDashboard(data, new Date("2026-10-02T16:00:00Z"));
  assert.equal(current.expired, false);
  assert.equal(current.recommendations[0].forecastExpired, false);
  assert.equal(current.recommendations[0].demandAvailable, false);
  assert.equal(current.recommendations[0].suggested_quantity, "0");
  assert.match(current.recommendations[0].unavailableReason, /Business date changed/);
  assert.equal(current.predictions.at(-1).predictionDate, "2026-10-04");
});

test("server expiry remains visible while refresh is queued or has failed", () => {
  for (const status of ["queued", "failed"]) {
    const data = snapshot({ expired: true, latestRun: { status } });
    const current = currentForecastDashboard(data, new Date("2026-10-02T08:00:00Z"));
    assert.equal(current.expired, true);
    assert.equal(current.latestRun.status, status);
  }
});

test("client timezone and an earlier client clock cannot move the business day backward", () => {
  const data = snapshot({ businessTimezone: "America/New_York" });
  const beforeMidnight = currentForecastDashboard(data, new Date("2026-10-03T03:59:59Z"));
  assert.equal(beforeMidnight.businessDay, "2026-10-02");
  assert.equal(beforeMidnight.expired, false);
  const afterMidnight = currentForecastDashboard(data, new Date("2026-10-03T04:00:00Z"));
  assert.equal(afterMidnight.businessDay, "2026-10-03");
  assert.equal(afterMidnight.expired, true);
  assert.equal(
    currentForecastDashboard(data, new Date("2026-10-01T01:00:00Z")).businessDay,
    "2026-10-02",
  );
});
