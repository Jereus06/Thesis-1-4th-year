import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { chartIntervalBounds, intervalAvailability } from "../src/lib/forecast-interval.ts";
import { forecastRefreshAdvice } from "../src/lib/forecast-schedule.ts";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
  ssr: { noExternal: ["recharts"] },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  plugins: [
    {
      name: "interval-chart-test",
      enforce: "pre",
      resolveId(id) {
        if (id === "recharts") return "\0interval-test-recharts";
      },
      load(id) {
        if (id !== "\0interval-test-recharts") return;
        return `
        import { createElement } from "react";
        export const ResponsiveContainer = ({children}) => createElement("div", null, children);
        export const ComposedChart = ({data, children}) => createElement("div", null,
          createElement("output", null, JSON.stringify(data.map(point => point.intervalBounds))), children);
        export const Area = ({name, dataKey}) => createElement("span", {"data-chart-area": dataKey}, name);
        export const Line = () => null;
        export const Bar = () => null;
        export const Customized = () => null;
        export const CartesianGrid = () => null;
        export const Legend = () => null;
        export const Tooltip = () => null;
        export const XAxis = () => null;
        export const YAxis = () => null;
      `;
      },
    },
  ],
});
after(() => server.close());
const { IntervalEvidence } = await server.ssrLoadModule("/src/components/interval-evidence.tsx");
const { DemandChart } = await server.ssrLoadModule("/src/components/demand-chart.tsx");

function point(patch = {}) {
  return {
    date: "2026-10-03",
    actual: null,
    ma: 5,
    xgb: 6,
    ensemble: 5.5,
    p10: 2,
    p50: 5.5,
    p90: 8,
    ...patch,
  };
}
function forecast(patch = {}) {
  return {
    method: "ensemble",
    trainedWithMl: true,
    forecastExpired: false,
    holdout: [],
    future: [point()],
    interval: {
      available: true,
      selectionObservations: 20,
      lowerResidual: -3,
      upperResidual: 2,
      calibrationObservations: 10,
      calibrationStart: "2026-08-21",
      calibrationEnd: "2026-08-30",
      calibrationSplit: "late_validation_reserved_after_selection",
      method: "Validation residual quantiles",
      nominalCoverage: 0.8,
      finalTestCoverage: 0.75,
      finalTestObservations: 20,
    },
    ...patch,
  };
}
const renderEvidence = (value, mode = "api", extra = {}) =>
  renderToStaticMarkup(createElement(IntervalEvidence, { forecast: value, mode, ...extra }));

test("available intervals show saved calibration evidence and measured coverage with limits", () => {
  const html = renderEvidence(forecast());
  for (const expected of [
    "Forecast range available",
    "10 sales records",
    "2026-08-21 to 2026-08-30",
    "80% target",
    "75.0% of actual sales inside the bounds",
    "20 tested sales records",
    "Future sales may fall outside this range",
    "Sales during stockouts may understate demand",
  ])
    assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(
    html,
    /not been calibrated|probability of correctness|residual|Method selection records|Range calculation|Saved error adjustments/,
  );
});

test("insufficient calibration remains explicitly unavailable without inventing evidence", () => {
  const html = renderEvidence(
    forecast({
      future: [point({ p10: NaN, p90: NaN })],
      interval: {
        available: false,
        calibrationObservations: 0,
        calibrationSplit: "late_validation_reserved_after_selection",
      },
    }),
  );
  for (const expected of [
    "Not enough records to estimate a range",
    "0 sales records",
    "at least 10 required",
    "Dates unavailable",
    "Target not saved",
    "Past test coverage",
    "Not available",
    "record count unavailable",
  ])
    assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /80% target|interval available/);
});

test("legacy bounds do not establish calibration when metadata is missing", () => {
  const html = renderEvidence(forecast({ interval: undefined }));
  assert.match(html, /Forecast range could not be checked/);
  assert.match(html, /This range has not been checked against past sales/);
  assert.doesNotMatch(html, /Validation-calibrated|80% target|10 sales records/);
  assert.doesNotMatch(html, /Calibration uses separate late-validation/);
});

test("unfamiliar saved protocols do not inherit the current calibration method or threshold", () => {
  const html = renderEvidence(
    forecast({
      interval: {
        available: false,
        calibrationObservations: 4,
        calibrationSplit: "legacy_unrecognized",
      },
    }),
  );
  assert.match(html, /Forecast range unavailable/);
  assert.match(html, /Range accuracy could not be verified/);
  assert.doesNotMatch(
    html,
    /Calibration uses separate late-validation|at least 10 required|80% target/,
  );
});

test("baseline forecasts distinguish missing intervals from missing point forecasts", () => {
  const html = renderEvidence(forecast({ trainedWithMl: false, interval: undefined }));
  assert.match(html, /Forecast range unavailable/);
  assert.match(html, /A sales estimate may be available even when a range is unavailable/);
});

test("expired future intervals retain archived calibration evidence", () => {
  const html = renderEvidence(forecast({ forecastExpired: true, future: [] }), "api", {
    forecastThrough: "2026-10-02",
  });
  assert.match(html, /Forecast range expired/);
  assert.match(html, /ended on 2026-10-02/);
  assert.match(html, /10 sales records/);
  assert.match(html, /75\.0% of actual sales inside the bounds/);
  assert.match(html, /To update it, refresh forecasts\./);
});

test("expired intervals use enabled staff schedule advice while keeping archived calibration evidence", () => {
  const html = renderEvidence(forecast({ forecastExpired: true, future: [] }), "api", {
    forecastThrough: "2026-10-02",
    refreshAdvice: forecastRefreshAdvice("api", false, {
      enabled: true,
      localTime: "00:15",
      timezone: "Asia/Manila",
    }),
  });
  assert.match(html, /To update it, wait for the daily automatic refresh\./);
  assert.match(html, /ended on 2026-10-02/);
  assert.match(html, /10 sales records/);
  assert.match(html, /75\.0% of actual sales inside the bounds/);
  assert.doesNotMatch(html, /ask the owner|To update it, refresh forecasts/);
});

test("calibration availability and missing current bounds remain separate", () => {
  assert.equal(
    intervalAvailability(forecast({ future: [] }), "api"),
    "Current forecast range unavailable",
  );
  assert.equal(
    intervalAvailability(
      forecast({
        interval: { available: true },
      }),
      "api",
    ),
    "Saved forecast range available",
  );
});

test("browser bands stay illustrative even if a fixture has saved calibration metadata", () => {
  const html = renderEvidence(forecast(), "browser-demo");
  assert.match(html, /Demo forecast range/);
  assert.match(html, /Sample range for demonstration; accuracy has not been checked/);
  assert.doesNotMatch(html, /80% target|10 sales records|75\.0% of actual/);
  assert.equal(
    intervalAvailability(
      forecast({
        future: [],
        holdout: [point()],
      }),
      "browser-demo",
    ),
    "Demo forecast range",
  );
});

test("chart bounds preserve both endpoints and reject absent or reversed ranges", () => {
  assert.deepEqual(chartIntervalBounds(point()), [2, 8]);
  for (const values of [{ p10: NaN }, { p90: NaN }, { p10: 9, p90: 8 }])
    assert.equal(chartIntervalBounds(point(values)), null);
});

test("chart renders one actual range and its label only where bounds exist", () => {
  const html = renderToStaticMarkup(
    createElement(DemandChart, {
      points: [point(), point({ p10: NaN, p90: NaN })],
      intervalLabel: "80% nominal interval",
    }),
  );
  assert.match(html, /<output>\[\[2,8\],null\]<\/output>/);
  assert.match(html, /data-chart-area="intervalBounds"/);
  assert.match(html, /80% nominal interval/);
  assert.equal((html.match(/data-chart-area=/g) ?? []).length, 1);
});

test("missing bounds omit the interval series and its legend label", () => {
  const html = renderToStaticMarkup(
    createElement(DemandChart, {
      points: [point({ p10: NaN, p90: NaN })],
      intervalLabel: "80% nominal interval",
    }),
  );
  assert.match(html, /<output>\[null\]<\/output>/);
  assert.doesNotMatch(html, /data-chart-area|80% nominal interval/);
});
