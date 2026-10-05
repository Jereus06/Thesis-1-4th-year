import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { chartIntervalBounds, intervalAvailability } from "../src/lib/forecast-interval.ts";

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
    "Validation-calibrated interval available",
    "10 observations",
    "2026-08-21 to 2026-08-30",
    "Validation residual quantiles for Ensemble",
    "80% target",
    "75.0% of actual sales inside the bounds",
    "20 final-test observations",
    "Model-selection sample",
    "-3.00 to 2.00 units",
    "Fixed 10th and 90th residual offsets",
    "clipped at zero",
    "observed sales, not unmet demand",
    "does not guarantee future coverage",
    "never tune these bounds",
  ])
    assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /not been calibrated|probability of correctness/);
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
    "Insufficient calibration observations",
    "0 observations",
    "at least 10 required",
    "Not saved / no calibration sample",
    "Method not saved",
    "Target not saved",
    "Final-test coverage",
    "Not available",
    "observation count not saved",
  ])
    assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /80% target|interval available/);
});

test("legacy bounds do not establish calibration when metadata is missing", () => {
  const html = renderEvidence(forecast({ interval: undefined }));
  assert.match(html, /Calibration evidence unavailable/);
  assert.match(html, /Existing bounds alone do not establish calibrated coverage/);
  assert.doesNotMatch(html, /Validation-calibrated|80% target|10 observations/);
  assert.doesNotMatch(html, /Calibration uses separate late-validation/);
});

test("unfamiliar saved protocols do not inherit the current calibration method or threshold", () => {
  const html = renderEvidence(forecast({
    interval: {
      available: false, calibrationObservations: 4, calibrationSplit: "legacy_unrecognized",
    },
  }));
  assert.match(html, /Intervals unavailable/);
  assert.match(html, /calibration protocol is not saved or recognized/);
  assert.doesNotMatch(html, /Calibration uses separate late-validation|at least 10 required|80% target/);
});

test("baseline forecasts distinguish missing intervals from missing point forecasts", () => {
  const html = renderEvidence(forecast({ trainedWithMl: false, interval: undefined }));
  assert.match(html, /Intervals unavailable/);
  assert.match(html, /point forecast can still be available without an interval/);
});

test("expired future intervals retain archived calibration evidence", () => {
  const html = renderEvidence(forecast({ forecastExpired: true, future: [] }), "api", {
    forecastThrough: "2026-10-02",
  });
  assert.match(html, /Expired future interval/);
  assert.match(html, /ended on 2026-10-02/);
  assert.match(html, /10 observations/);
  assert.match(html, /75\.0% of actual sales inside the bounds/);
  assert.match(html, /refresh forecasts for current bounds/);
});

test("calibration availability and missing current bounds remain separate", () => {
  assert.equal(
    intervalAvailability(forecast({ future: [] }), "api"),
    "Current interval bounds unavailable",
  );
  assert.equal(
    intervalAvailability(
      forecast({
        interval: { available: true },
      }),
      "api",
    ),
    "Saved interval available",
  );
});

test("browser bands stay illustrative even if a fixture has saved calibration metadata", () => {
  const html = renderEvidence(forecast(), "browser-demo");
  assert.match(html, /Illustrative band/);
  assert.match(html, /no validated calibration sample or guaranteed coverage/);
  assert.doesNotMatch(html, /80% target|10 observations|75\.0% of actual/);
  assert.equal(
    intervalAvailability(
      forecast({
        future: [],
        holdout: [point()],
      }),
      "browser-demo",
    ),
    "Illustrative band",
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
