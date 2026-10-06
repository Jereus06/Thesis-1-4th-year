import assert from "node:assert/strict";
import test from "node:test";
import {
  forecastProgressMessage,
  forecastRefreshAdvice,
  forecastScheduleMessage,
} from "../src/lib/forecast-schedule.ts";

const schedule = { enabled: true, localTime: "00:15", timezone: "Asia/Manila" };
const staff = { requesting: false, dateChanged: false, canRefreshForecast: false };
const saved = {
  run: { finalTestEnd: "2026-10-01" },
  latestRun: { status: "completed" },
  forecastThrough: "2026-10-15",
  forecastSchedule: schedule,
  stale: false,
  expired: false,
};

test("the API's enabled daily schedule shows its local time and business timezone", () => {
  assert.equal(
    forecastScheduleMessage("api", schedule),
    "Automatic forecast refresh is scheduled daily at 00:15 (Asia/Manila).",
  );
  assert.match(
    forecastScheduleMessage("api", {
      ...schedule,
      localTime: "06:45",
      timezone: "America/New_York",
    }),
    /daily at 06:45 \(America\/New_York\)/,
  );
  assert.equal(
    forecastRefreshAdvice("api", false, schedule),
    "wait for the daily automatic refresh",
  );
  assert.match(forecastRefreshAdvice("api", true, schedule), /^refresh forecasts now or wait/);
});

test("missing, disabled, malformed, and browser-demo schedules retain manual permission advice", () => {
  for (const [mode, metadata] of [
    ["api", undefined],
    ["api", { ...schedule, enabled: false }],
    ["api", { ...schedule, localTime: "24:00" }],
    ["api", { ...schedule, timezone: "" }],
    ["browser-demo", schedule],
  ]) {
    assert.equal(forecastScheduleMessage(mode, metadata), null);
    assert.equal(
      forecastRefreshAdvice(mode, false, metadata),
      "ask the owner to refresh forecasts",
    );
    assert.equal(forecastRefreshAdvice(mode, true, metadata), "refresh forecasts");
  }
});

test("persisted queued, running, and completed states report saved output without a fabricated percentage", () => {
  for (const status of ["queued", "running"]) {
    const message = forecastProgressMessage({ ...saved, latestRun: { status } }, staff);
    assert.match(message, new RegExp(`Forecast refresh is ${status}`));
    assert.match(message, /last completed forecast remains visible/);
    assert.doesNotMatch(message, /\d+\/\d+|\d+%|next run/i);
  }
  assert.equal(forecastProgressMessage(saved, staff), "Saved Python forecast through 2026-10-15");
  assert.equal(
    forecastProgressMessage({ ...saved, run: null, latestRun: { status: "queued" } }, staff),
    "Forecast refresh is queued.",
  );
});

test("stale, expired, and baseline staff advice uses enabled automatic refresh without claiming eligibility", () => {
  for (const data of [
    { ...saved, stale: true },
    { ...saved, expired: true },
    { ...saved, run: null, latestRun: null },
  ]) {
    const message = forecastProgressMessage(data, staff);
    assert.match(message, /wait for the daily automatic refresh/);
    assert.doesNotMatch(message, /ask the owner|eligible for XGBoost|guaranteed/i);
    for (const forecastSchedule of [undefined, { ...schedule, enabled: false }])
      assert.match(
        forecastProgressMessage({ ...data, forecastSchedule }, staff),
        /ask the owner to refresh forecasts/,
      );
  }
});

test("requesting, failed, and business-date transition states keep their existing operational meaning", () => {
  assert.match(
    forecastProgressMessage(saved, { ...staff, requesting: true }),
    /Requesting a forecast refresh/,
  );
  assert.equal(
    forecastProgressMessage(saved, { ...staff, error: "Synthetic forecast failure" }),
    "Synthetic forecast failure",
  );
  assert.equal(
    forecastProgressMessage(saved, { ...staff, dateChanged: true }),
    "Business date changed. Waiting for current recommendations.",
  );
});
