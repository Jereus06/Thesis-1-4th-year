import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../", import.meta.url)),
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
  ssr: { noExternal: ["recharts"] },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  plugins: [
    {
      name: "forecast-chart-test",
      enforce: "pre",
      resolveId(id, importer) {
        if (id === "recharts") return "\0forecast-chart-test";
        if (id === "./store" && importer?.endsWith("/src/lib/use-forecast-view.ts"))
          return "\0forecast-preference-store-test";
      },
      load(id) {
        if (id === "\0forecast-preference-store-test")
          return `export const useAppStore = (selector) => selector({session: globalThis.forecastTestSession ?? null});`;
        if (id !== "\0forecast-chart-test") return;
        return `import { Children, createElement } from "react";
        export const ResponsiveContainer = ({children}) => createElement("div", null, children);
        export const ComposedChart = ({data, children}) => createElement("div", null,
          createElement("output", {"data-chart-data": ""}, JSON.stringify(data)),
          createElement("output", {"data-direct-series": ""}, JSON.stringify(Children.toArray(children)
            .filter(child => [Line, Area, Bar].includes(child.type)).map(child => child.props.dataKey))), children);
        const series = (kind, {dataKey, name, dot, connectNulls, stackId, fillOpacity, isAnimationActive, type}) =>
          createElement("span", {"data-series": dataKey, "data-kind": kind, "data-dot": Boolean(dot),
            "data-connect-nulls": connectNulls ?? false, "data-stack-id": stackId ?? "none",
            "data-fill-opacity": fillOpacity, "data-animated": isAnimationActive ?? true, "data-curve": type}, name);
        export const Line = (props) => series("line", props);
        export const Area = (props) => series("area", props);
        export const Bar = (props) => series("bar", props);
        export const Customized = () => null;
        export const CartesianGrid = () => null;
        export const Legend = () => null;
        export const Tooltip = () => null;
        export const XAxis = ({type, scale, domain, ticks}) => createElement("output", {"data-time-axis": ""},
          JSON.stringify({type, scale, domain, ticks}));
        export const YAxis = () => null;`;
      },
    },
  ],
});
after(() => server.close());
const { addDays, enumerateDays } = await server.ssrLoadModule("/src/lib/dates.ts");
const { recursiveMovingAverage } = await server.ssrLoadModule(
  "/src/lib/forecast/moving-average.ts",
);
const { mae, rmse } = await server.ssrLoadModule("/src/lib/forecast/metrics.ts");
const { mixPreds, ensembleWeights } = await server.ssrLoadModule("/src/lib/forecast/ensemble.ts");
const { demoSplit, forecastDemoProduct } = await server.ssrLoadModule(
  "/src/lib/forecast/demo-product.ts",
);
const { runPipeline } = await server.ssrLoadModule("/src/lib/forecast/pipeline.ts");
const { selectTrainScope } = await server.ssrLoadModule("/src/lib/forecast/prepare.ts");
const { pipelineKey } = await server.ssrLoadModule("/src/lib/forecast/cache.ts");
const { forecastChartPoints } = await server.ssrLoadModule("/src/lib/forecast/chart.ts");
const { earlierChartPredictions, needsChartHistory } = await server.ssrLoadModule(
  "/src/lib/forecast/chart-history.ts",
);
const { api } = await server.ssrLoadModule("/src/lib/api.ts");
const { defaultSettings } = await server.ssrLoadModule("/src/lib/data/seed.ts");
const { FALLBACK_LABEL } = await server.ssrLoadModule("/src/lib/data/fallback.ts");
const { DemandChart } = await server.ssrLoadModule("/src/components/demand-chart.tsx");
const { ForecastCandles } = await server.ssrLoadModule("/src/components/forecast-candles.tsx");
const { useForecastView } = await server.ssrLoadModule("/src/lib/use-forecast-view.ts");

const product = {
  id: "p",
  sku: "P",
  name: "Product",
  category: "Test",
  unit: "piece",
  currentStock: 10,
  unitCost: 2,
  safetyStock: 1,
  leadTimeDays: 3,
};
const dates = enumerateDays("2025-01-01", addDays("2025-01-01", 219));
const quantities = dates.map((_, i) => 10 + (i % 7));
const settings = {
  ...defaultSettings,
  useFallbackIfThin: false,
  holdoutDays: 30,
  forecastHorizon: 30,
  topNProducts: 1,
};
const options = {
  product,
  series: quantities,
  dates,
  grain: "daily",
  maWindow: 7,
  horizon: 30,
  holdoutDays: 30,
  minWeeks: 8,
  weeks: 220 / 7,
  categories: ["Test"],
  cvFolds: 2,
};
const trained = forecastDemoProduct(options, true).forecast;
const sales = dates.map((date, i) => ({
  id: `sale-${i}`,
  productId: "p",
  date,
  qty: quantities[i],
  source: "demo",
}));
const point = (date, patch = {}) => ({
  date,
  actual: 2,
  ma: 3,
  xgb: 4,
  ensemble: 3.5,
  p10: 1,
  p50: 3.5,
  p90: 5,
  ...patch,
});

test("moving average recurses from a fixed cutoff", () => {
  assert.deepEqual(recursiveMovingAverage([0, 10], 3, 2), [5, 7.5, 6.25]);
});

test("metrics cannot silently score unequal observations or drop missing predictions", () => {
  for (const metric of [mae, rmse]) {
    assert(Number.isNaN(metric([1, 2], [1])));
    assert(Number.isNaN(metric([1, 2], [1, NaN])));
    assert(Number.isNaN(metric([], [])));
  }
  assert.equal(mae([1, 5], [3, 1]), 3);
  assert.equal(rmse([1, 5], [3, 1]), Math.sqrt(10));
  assert.throws(() => mixPreds([1, 2], [1], 0.5, 0.5), /matching/);
  assert.throws(() => mixPreds([1], [1], 0.8, 0.8), /sum to one/);
  assert.deepEqual(ensembleWeights(NaN, NaN), { xgb: 0.5, ma: 0.5 });
});

test("prototype produces 30 finite quantity predictions for all methods and exact matching metrics", () => {
  assert.equal(trained.trainedWithMl, true);
  assert.equal(trained.holdout.length, 30);
  assert.equal(trained.future.length, 30);
  assert.equal(trained.future[0].date, addDays(dates.at(-1), 1));
  assert.equal(trained.future.at(-1).date, addDays(dates.at(-1), 30));
  for (const [key, maeField, rmseField] of [
    ["ma", "maMae", "maRmse"],
    ["xgb", "xgbMae", "xgbRmse"],
    ["ensemble", "ensembleMae", "ensembleRmse"],
  ]) {
    assert(
      trained.future.every((p) => p.actual === null && Number.isFinite(p[key]) && p[key] >= 0),
    );
    const errors = trained.holdout.map((p) => p.actual - p[key]);
    assert.equal(trained[maeField], errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length);
    assert.equal(
      trained[rmseField],
      Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length),
    );
  }
  for (const p of [...trained.holdout, ...trained.future]) {
    assert(Math.abs(p.ensemble - (trained.xgbWeight * p.xgb + trained.maWeight * p.ma)) < 1e-10);
  }
});

test("final-test actuals cannot alter prototype selection, weights, test predictions or calibration", () => {
  const { testStart } = demoSplit(dates.length, "daily", 30);
  const changed = forecastDemoProduct(
    { ...options, series: quantities.map((v, i) => (i < testStart ? v : 1000 + i)) },
    true,
  ).forecast;
  assert.equal(changed.method, trained.method);
  assert.equal(changed.winner, trained.winner);
  assert.equal(changed.xgbWeight, trained.xgbWeight);
  assert.equal(changed.cvMaeMa, trained.cvMaeMa);
  assert.equal(changed.cvMaeXgb, trained.cvMaeXgb);
  assert.deepEqual(
    changed.holdout.map(({ actual: _actual, ...p }) => p),
    trained.holdout.map(({ actual: _actual, ...p }) => p),
  );
  assert.notDeepEqual(
    changed.holdout.map((p) => p.actual),
    trained.holdout.map((p) => p.actual),
  );
  // The operational refit is allowed to use test history after evaluation.
  assert.notDeepEqual(
    changed.future.map((p) => p.xgb),
    trained.future.map((p) => p.xgb),
  );
});

test("baseline never impersonates an ensemble or ML score; empty history is unavailable", () => {
  const baseline = forecastDemoProduct(options, false).forecast;
  assert(Number.isNaN(baseline.xgbMae));
  assert(Number.isNaN(baseline.ensembleMae));
  assert(baseline.future.every((p) => Number.isNaN(p.xgb) && Number.isNaN(p.ensemble)));
  const empty = forecastDemoProduct({ ...options, series: [], dates: [] }, false).forecast;
  assert.equal(empty.demandAvailable, false);
  assert(Number.isNaN(empty.dailyDemand));
  assert.deepEqual(empty.future, []);
});

test("eligibility and volume ranks use training only, with separate week and nonzero gates", () => {
  const other = { ...product, id: "q" };
  const trainingDates = dates.slice(0, 100);
  const rows = [
    ...sales,
    ...dates.map((date, i) => ({
      id: `q-${i}`,
      productId: "q",
      date,
      qty: i < 100 ? 1 : 10000,
      source: "demo",
    })),
  ];
  assert.deepEqual(
    selectTrainScope([other, product], rows, trainingDates, 1, 8, 100).ml.map((p) => p.id),
    ["p"],
  );
  assert.equal(selectTrainScope([product], sales, dates.slice(0, 56), 1, 8, 100).ml.length, 0);
  assert.equal(selectTrainScope([product], sales, trainingDates, 1, 15, 100).ml.length, 0);
  assert.equal(selectTrainScope([product], sales, trainingDates, 1, 8, 101).ml.length, 0);
});

test("pipeline pools MA on the identical ML cohort and keeps historyless products unavailable", async () => {
  const result = await runPipeline(
    [product, { ...product, id: "empty" }, { ...product, id: "short", unit: "bag" }],
    [
      ...sales,
      ...sales.slice(-50).map((sale) => ({
        ...sale,
        id: `short-${sale.id}`,
        productId: "short",
        source: "csv_import",
      })),
    ],
    settings,
  );
  assert.equal(result.diagnostics.trainedProductCount, 1);
  assert.equal(result.maMae, result.byProduct.p.maMae);
  assert.equal(result.xgbMae, result.byProduct.p.xgbMae);
  assert(Number.isNaN(result.byProduct.empty.dailyDemand));
  assert.deepEqual(result.byProduct.empty.future, []);
});

test("imported gaps are not zero sales and fallback remains labeled synthetic", async () => {
  const imported = [0, 1, 4, 5].map((i) => ({
    id: `import-${i}`,
    productId: "p",
    date: dates[i],
    qty: 9,
    source: "csv_import",
  }));
  const result = await runPipeline([product], imported, settings, { mode: "serve" });
  assert.equal(result.byProduct.p.observationCount, 2);
  assert.equal(result.byProduct.p.dailyDemand, 9);
  assert.equal(result.byProduct.p.future[0].date, addDays(dates[5], 1));
  assert.match(FALLBACK_LABEL, /Synthetic/);
  assert.doesNotMatch(FALLBACK_LABEL, /Public/);
});

test("cache notices edits to earlier historical records and eligibility settings", () => {
  const key = pipelineKey([product], sales, settings);
  const edited = sales.map((s, i) => (i === 1 ? { ...s, qty: 900 } : s));
  assert.notEqual(pipelineKey([product], edited, settings), key);
  assert.notEqual(pipelineKey([product], sales, { ...settings, minimumNonzeroDays: 150 }), key);
});

test("daily chart shows 30 future days and inserts null gaps without inventing sales", () => {
  const chart = forecastChartPoints(trained, 30, "daily");
  assert.equal(chart.length, 60);
  assert.equal(chart.filter((p) => p.actual === null).length, 30);
  const gapped = forecastChartPoints(
    { ...trained, holdout: [point("2026-01-01"), point("2026-01-03")], future: [] },
    30,
    "daily",
  );
  assert.equal(gapped.length, 3);
  assert.equal(gapped[1].actual, null);
  assert(Number.isNaN(gapped[1].ma));
});

test("saved earlier predictions fill the interval without adding actuals or changing future demand and scores", () => {
  const forecast = {
    ...trained,
    holdout: [point("2026-10-27")],
    future: [point("2026-11-13", { actual: null })],
  };
  const rows = enumerateDays("2026-10-28", "2026-11-12").flatMap((day) =>
    ["moving_average", "xgboost", "ensemble"].map((method) => ({
      productId: "p",
      predictionDate: day,
      datasetSplit: "future",
      method,
      predictedQuantity: "7",
      actualQuantity: null,
      lowerBound: null,
      upperBound: null,
    })),
  );
  const before = structuredClone(forecast);
  const archived = earlierChartPredictions(rows, forecast);
  assert.equal(needsChartHistory(forecast), true);
  assert.equal(archived.length, 16);
  assert(archived.every((p) => p.actual === null && p.xgb === 7 && p.ma === 7 && p.ensemble === 7));
  const chart = forecastChartPoints(forecast, 30, "daily", archived);
  assert.equal(chart.length, 18);
  assert(chart.every((p) => Number.isFinite(p.xgb)));
  assert.deepEqual(forecast, before);
  assert.deepEqual(
    earlierChartPredictions(
      rows.map((r) => ({ ...r, productId: "another" })),
      forecast,
    ),
    [],
  );
  assert.deepEqual(
    earlierChartPredictions(
      rows.map((r) => ({ ...r, datasetSplit: "final_test" })),
      forecast,
    ),
    [],
  );
  assert.deepEqual(
    earlierChartPredictions(
      rows.map((r) => ({ ...r, predictionDate: "2026-11-13" })),
      forecast,
    ),
    [],
  );
});

test("expired forecasts retain their saved chart history without becoming current forecasts", () => {
  const forecast = {
    ...trained,
    forecastExpired: true,
    demandAvailable: false,
    dailyDemand: NaN,
    holdout: [point("2026-10-27")],
    future: [],
  };
  const rows = [
    {
      productId: "p",
      predictionDate: "2026-10-28",
      datasetSplit: "future",
      method: "moving_average",
      predictedQuantity: "7",
      actualQuantity: null,
      lowerBound: null,
      upperBound: null,
    },
  ];
  const archived = earlierChartPredictions(rows, forecast);
  assert.equal(archived.length, 1);
  assert.equal(forecastChartPoints(forecast, 30, "daily", archived).length, 2);
  assert.equal(forecast.forecastExpired, true);
  assert.equal(forecast.demandAvailable, false);
  assert(Number.isNaN(forecast.dailyDemand));
});

test("forecast archive reads every API page and reports transport failures", async () => {
  const previousFetch = globalThis.fetch;
  const requested = [];
  try {
    globalThis.fetch = async (url, options) => {
      requested.push(String(url));
      assert.equal(options.method, "GET");
      assert.equal(options.credentials, "include");
      const offset = Number(new URL(String(url), "http://test.local").searchParams.get("offset"));
      return Response.json({
        data: Array.from({ length: offset === 0 ? 1000 : 1 }, (_, i) => ({ id: offset + i })),
      });
    };
    assert.equal((await api.forecastPredictions("business", "run")).length, 1001);
    assert.equal(requested.length, 2);
    assert(requested[1].endsWith("limit=1000&offset=1000"));
    globalThis.fetch = async () =>
      Response.json({ detail: "Synthetic unavailable archive" }, { status: 503 });
    await assert.rejects(
      api.forecastPredictions("business", "run"),
      /Synthetic unavailable archive/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("weekly chart never mixes historical actuals with future predictions or manufactures model zeros", () => {
  const chart = forecastChartPoints(
    {
      ...trained,
      holdout: [point("2026-01-05", { xgb: NaN }), point("2026-01-06", { xgb: NaN })],
      future: [point("2026-01-07", { actual: null, xgb: NaN })],
    },
    30,
    "weekly",
  );
  assert.equal(chart.length, 2);
  assert.equal(chart[0].actual, 4);
  assert.equal(chart[0].ma, 6);
  assert.equal(chart[1].actual, null);
  assert.equal(chart[1].ma, 3);
  assert(chart.every((p) => Number.isNaN(p.xgb) && Number.isNaN(p.p10) && Number.isNaN(p.p90)));
});

test("native weekly results are not summed as if each point were one day", () => {
  const native = {
    ...trained,
    grain: "weekly",
    holdout: [point("2026-01-05"), point("2026-01-12")],
    future: [],
  };
  assert.equal(forecastChartPoints(native, 30, "weekly").length, 2);
});

test("monthly view sums only available daily dates and separates test from future", () => {
  const chart = forecastChartPoints(
    {
      ...trained,
      holdout: [point("2026-01-30"), point("2026-01-31")],
      future: [
        point("2026-02-01", { actual: null }),
        point("2026-02-02", { actual: null }),
        point("2026-03-01", { actual: null }),
      ],
    },
    2,
    "monthly",
  );
  assert.equal(chart.length, 2);
  assert.deepEqual(
    chart.map((p) => [p.date, p.actual, p.ma]),
    [
      ["2026-01-30", 4, 6],
      ["2026-02-01", null, 6],
    ],
  );
  assert(chart.every((p) => Number.isNaN(p.p10) && Number.isNaN(p.p90)));
  const sameMonth = forecastChartPoints(
    { ...trained, holdout: [point("2026-02-01")], future: [point("2026-02-02", { actual: null })] },
    30,
    "monthly",
  );
  assert.equal(sameMonth.length, 2);
  assert.equal(sameMonth[0].actual, 2);
  assert.equal(sameMonth[1].actual, null);
});

test("monthly view preserves unknown days instead of treating a missing date as zero sales", () => {
  const chart = forecastChartPoints(
    { ...trained, holdout: [point("2026-02-01"), point("2026-02-03")], future: [] },
    30,
    "monthly",
  );
  assert.equal(chart[0].actual, null);
  assert(Number.isNaN(chart[0].ma));
});

test("turning off comparison still displays actuals and the selected model's prediction", () => {
  for (const method of ["ma", "rule", "xgb", "ensemble"]) {
    const markup = renderToStaticMarkup(
      createElement(DemandChart, {
        points: [point("2026-01-01")],
        method,
        showModels: false,
        scale: 2,
      }),
    );
    assert.match(markup, /data-series="actual"/);
    assert.match(markup, /data-series="predicted"/);
    assert.doesNotMatch(markup, /data-series="xgb"/);
    const expected = method === "ma" || method === "rule" ? 6 : method === "xgb" ? 8 : 7;
    assert.match(markup, new RegExp(`&quot;predicted&quot;:${expected}`));
  }
});

function chartOutput(markup, attribute) {
  const encoded = markup.match(new RegExp(`<output ${attribute}="">(.*?)</output>`))[1];
  return JSON.parse(
    encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&#x27;", "'"),
  );
}

test("all forecast chart styles use the same dated quantities, null gaps and operating model", () => {
  const points = [
    point("2026-01-01"),
    point("2026-01-02", { actual: null, ma: NaN, xgb: NaN, ensemble: NaN, p10: NaN, p90: NaN }),
    point("2026-01-03", { actual: null }),
  ];
  let previous;
  for (const chartType of ["line", "area", "candlestick", "step"]) {
    const markup = renderToStaticMarkup(
      createElement(DemandChart, {
        points,
        chartType,
        showModels: false,
        method: "xgb",
      }),
    );
    const data = chartOutput(markup, "data-chart-data");
    if (previous) assert.deepEqual(data, previous);
    previous = data;
    assert.equal(data[1].actual, null);
    assert.equal(data[1].predicted, null);
    assert.equal(data[2].actual, null);
    assert.equal(data[2].predicted, 4);
    assert.equal(data[2].timestamp - data[0].timestamp, 2 * 86_400_000);
    const kind = chartType === "area" ? "area" : "line";
    assert.match(markup, new RegExp(`data-series="predicted" data-kind="${kind}"`));
    assert.match(markup, new RegExp(`data-series="actual" data-kind="${kind}"`));
    if (chartType === "step")
      assert.equal((markup.match(/data-curve="stepAfter"/g) ?? []).length, 2);
    assert.doesNotMatch(markup, /data-connect-nulls="true"|data-animated="true"/);
    assert.deepEqual(chartOutput(markup, "data-direct-series"), [
      "intervalBounds",
      "predicted",
      "actual",
    ]);
    const axis = chartOutput(markup, "data-time-axis");
    assert.equal(axis.type, "number");
    assert.equal(axis.scale, "time");
    if (chartType === "candlestick") {
      assert(axis.domain[0] < data[0].timestamp);
      assert(axis.domain[1] > data[2].timestamp);
      assert.deepEqual(
        axis.ticks,
        data.map((point) => point.timestamp),
      );
    }
  }
});

test("chart comparisons keep separate method quantities without stacking", () => {
  for (const chartType of ["area", "candlestick", "step"]) {
    const markup = renderToStaticMarkup(
      createElement(DemandChart, {
        points: [point("2026-01-01")],
        chartType,
        showModels: true,
      }),
    );
    assert.deepEqual(chartOutput(markup, "data-direct-series"), [
      "intervalBounds",
      "actual",
      "ensemble",
      "xgb",
      "ma",
    ]);
    assert.equal(
      (markup.match(new RegExp(`data-kind="${chartType === "area" ? "area" : "line"}"`, "g")) ?? [])
        .length,
      chartType === "area" ? 5 : 4,
    );
    assert.doesNotMatch(markup, /data-series="predicted"/);
    assert.equal((markup.match(/data-stack-id="none"/g) ?? []).length, 5);
    if (chartType === "area")
      assert.equal((markup.match(/data-fill-opacity="0.12"/g) ?? []).length, 4);
  }
});

test("single-point line, area and step observations remain visible and use a nonzero date span", () => {
  for (const chartType of ["line", "area", "step"]) {
    const markup = renderToStaticMarkup(
      createElement(DemandChart, {
        points: [point("2026-01-01")],
        chartType,
        showModels: false,
      }),
    );
    assert.equal((markup.match(/data-dot="true"/g) ?? []).length, 2);
    const axis = chartOutput(markup, "data-time-axis");
    assert(axis.domain[0] < axis.domain[1]);
    assert.deepEqual(axis.ticks, [Date.parse("2026-01-01T00:00:00Z")]);
  }
});

test("forecast chart preferences validate saved styles and remain scoped to the signed-in account", () => {
  const previousWindow = globalThis.window;
  const previousSession = globalThis.forecastTestSession;
  const saved = new Map();
  let update;
  const session = { businessId: "business-a", userId: "owner" };
  function Preferences() {
    const result = useForecastView();
    update = result.update;
    return createElement("output", { "data-preferences": "" }, JSON.stringify(result.preferences));
  }
  const read = () =>
    chartOutput(renderToStaticMarkup(createElement(Preferences)), "data-preferences");
  try {
    globalThis.window = {
      localStorage: {
        getItem: (key) => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, value),
      },
    };
    globalThis.forecastTestSession = session;
    assert.equal(read().chartType, "line");
    update({ chartType: "candlestick", days: 14, view: "monthly", compare: true });
    assert.deepEqual(read(), {
      view: "monthly",
      days: 14,
      compare: true,
      chartType: "candlestick",
    });
    update({ chartType: "step" });
    assert.equal(read().chartType, "step");
    globalThis.forecastTestSession = { ...session, userId: "staff" };
    assert.deepEqual(read(), { view: "daily", days: 30, compare: false, chartType: "line" });
    saved.set(
      "stockcast-forecast-view:business-a:staff",
      JSON.stringify({ view: "weekly", days: 7, chartType: "pie" }),
    );
    assert.deepEqual(read(), { view: "weekly", days: 7, compare: false, chartType: "line" });
    globalThis.forecastTestSession = null;
    assert.equal(read().chartType, "line");
    update({ chartType: "area" });
    assert.equal(read().chartType, "area");
    globalThis.forecastTestSession = session;
    assert.equal(read().chartType, "step");
    saved.set(
      "stockcast-forecast-view:business-a:owner",
      JSON.stringify({ chartType: "bar", days: 14 }),
    );
    assert.equal(read().chartType, "candlestick", "Removed Bar preferences migrate to Candlestick");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousSession === undefined) delete globalThis.forecastTestSession;
    else globalThis.forecastTestSession = previousSession;
  }
});

test("all chart legends use the same readable line-and-circle design", () => {
  let previous;
  for (const chartType of ["line", "area", "candlestick", "step"]) {
    const markup = renderToStaticMarkup(
      createElement(DemandChart, { points: [point("2026-01-01")], chartType }),
    );
    const legend = markup.match(/<ul aria-label="Forecast chart legend"[\s\S]*?<\/ul>/)[0];
    if (previous) assert.equal(legend, previous);
    previous = legend;
    assert.equal((legend.match(/<circle/g) ?? []).length, 5);
    assert.doesNotMatch(legend, /<rect/);
  }
});

function renderCandles(points) {
  return renderToStaticMarkup(
    createElement(
      "svg",
      null,
      createElement(ForecastCandles, {
        points,
        xAxisMap: {
          0: {
            scale: (timestamp) =>
              ((timestamp - Date.parse("2026-01-01T00:00:00Z")) / 86_400_000) * 20 + 10,
          },
        },
        yAxisMap: { 0: { scale: (value) => 100 - value * 10 } },
      }),
    ),
  );
}
const candlePoint = (patch = {}) => ({
  date: "2026-01-01",
  timestamp: Date.parse("2026-01-01T00:00:00Z"),
  actual: 2,
  predicted: 4,
  intervalBounds: [1, 5],
  ...patch,
});

test("sales candles draw the actual-to-forecast body and exact saved range on the same quantity scale", () => {
  const markup = renderCandles([candlePoint()]);
  assert.match(markup, /data-actual="2" data-predicted="4" data-low="1" data-high="5"/);
  assert.match(markup, /class="forecast-candle-body"[^>]*y="60"[^>]*height="20"/);
  assert.match(markup, /class="forecast-candle-wick"[^>]*y1="50" y2="90"/);
  assert.match(markup, /class="forecast-candle-actual"[^>]*y1="80" y2="80"/);
  assert.match(markup, /class="forecast-candle-predicted"[^>]*y1="60" y2="60"/);
});

test("future candles and missing forecasts never invent actuals, bodies or ranges", () => {
  const future = renderCandles([candlePoint({ actual: null, intervalBounds: null })]);
  assert.match(future, /data-predicted="4"/);
  assert.doesNotMatch(
    future,
    /data-actual=|forecast-candle-body|forecast-candle-actual|forecast-candle-wick/,
  );
  const actualOnly = renderCandles([candlePoint({ predicted: null })]);
  assert.match(actualOnly, /data-actual="2"/);
  assert.doesNotMatch(
    actualOnly,
    /data-predicted=|forecast-candle-body|forecast-candle-predicted|forecast-candle-wick/,
  );
  assert.doesNotMatch(
    renderCandles([candlePoint({ actual: null, predicted: null })]),
    /class="forecast-candle"/,
  );
});
