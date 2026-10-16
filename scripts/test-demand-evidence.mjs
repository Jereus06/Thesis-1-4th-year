import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const storePath = fileURLToPath(new URL("../src/lib/store.ts", import.meta.url)).replaceAll(
  "\\",
  "/",
);
const contextPath = fileURLToPath(
  new URL("../src/components/forecast-context.tsx", import.meta.url),
).replaceAll("\\", "/");
const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true },
  ssr: { noExternal: ["@tanstack/react-router"] },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  plugins: [
    {
      name: "demand-evidence-test-state",
      enforce: "pre",
      resolveId(id) {
        if (id === "@tanstack/react-router") return "\0demand-test-router";
      },
      load(id) {
        const path = id.replaceAll("\\", "/");
        if (path === storePath)
          return `
        let state;
        export function setTestState(value) { state = value; }
        export const useAppStore = (selector) => selector(state);
      `;
        if (path === contextPath)
          return `
        let state;
        export function setForecastState(value) { state = value; }
        export const useForecast = () => state;
      `;
        if (id === "\0demand-test-router")
          return `
        import { createElement } from "react";
        export const createFileRoute = () => (options) => ({ options });
        export function Link({ to, children, ...props }) { return createElement("a", { href: to, ...props }, children); }
      `;
      },
    },
  ],
});
after(async () => {
  await server.close();
});
const { DemandEvidence } = await server.ssrLoadModule("/src/components/demand-evidence.tsx");
const { ForecastEvidenceBadge } = await server.ssrLoadModule(
  "/src/components/forecast-evidence-badge.tsx",
);
const { TopForecastProducts } = await server.ssrLoadModule(
  "/src/components/top-forecast-products.tsx",
);
const { Route: overviewRoute } = await server.ssrLoadModule("/src/routes/index.tsx");
const { Route: restockRoute } = await server.ssrLoadModule("/src/routes/restock.tsx");
const { Route: forecastsRoute } = await server.ssrLoadModule("/src/routes/forecasts.tsx");
const { setTestState } = await server.ssrLoadModule("/src/lib/store.ts");
const { setForecastState } = await server.ssrLoadModule("/src/components/forecast-context.tsx");
const { runPipeline } = await server.ssrLoadModule("/src/lib/forecast/pipeline.ts");
const { defaultSettings } = await server.ssrLoadModule("/src/lib/data/seed.ts");
const product = {
  id: "synthetic-product",
  sku: "SYNTHETIC-001",
  name: "Synthetic practice rice",
  category: "Staples",
  unit: "bag",
  currentStock: 20,
  leadTimeDays: 3,
  safetyStock: 5,
  unitCost: 45,
};
const baseRow = {
  product,
  demandAvailable: true,
  dailyDemand: 2,
  demandDuringLead: 6,
  reorderPoint: 11,
  targetStock: 25,
  reorderQty: 0,
  daysOfCover: 10,
  status: "healthy",
  winnerModel: "ma",
  confidence: "low",
};

function renderPage(
  route,
  {
    catalog = [product],
    rows = [baseRow],
    forecast = {},
    expired = false,
    result = true,
    mode = "api",
    role = "owner",
    schedule,
    status = expired ? "expired" : "ready",
    message = "Synthetic fixture",
    diagnostics = {},
    overallScores = {},
  } = {},
) {
  setTestState({
    products: catalog,
    dataMode: mode,
    session:
      mode === "api"
        ? {
            userId: "synthetic-user",
            businessId: "synthetic-business",
            displayName: "Synthetic user",
            email: "synthetic@example.test",
            role,
          }
        : null,
    settings: { storeName: "Synthetic store", forecastHorizon: 14, maWindow: 7 },
  });
  setForecastState({
    rows,
    expired,
    status,
    schedule,
    progress: {
      total: catalog.length,
      completed: status === "training" ? 0 : catalog.length,
      message,
    },
    result: result
      ? {
          winner: "ma",
          maMae: NaN,
          xgbMae: NaN,
          ensembleMae: NaN,
          maRmse: NaN,
          xgbRmse: NaN,
          ensembleRmse: NaN,
          byProduct: { [product.id]: forecast },
          ...overallScores,
          diagnostics: {
            trainedProductCount: 0,
            topN: 8,
            disclaimer: "Synthetic test fixture",
            ...diagnostics,
          },
        }
      : null,
  });
  return renderToStaticMarkup(createElement(route.options.component));
}
function assertDeliveryEnabled(markup) {
  const buttons = [...markup.matchAll(/<button\b([^>]*)>Record delivery<\/button>/g)];
  assert.equal(buttons.length, 1);
  assert.doesNotMatch(buttons[0][1], /\sdisabled(?:=|\s|$)/);
}

function renderEvidence(props = {}) {
  return renderToStaticMarkup(createElement(DemandEvidence, props));
}

test("staff retain delivery entry while forecast refresh controls belong to owners", () => {
  assertDeliveryEnabled(renderPage(restockRoute, { role: "staff" }));
  const forecast = { holdout: [], future: [] };
  const owner = renderPage(forecastsRoute, { role: "owner", forecast });
  const staff = renderPage(forecastsRoute, { role: "staff", forecast });
  assert.match(owner, /<button\b[^>]*>Refresh forecasts<\/button>/);
  assert.doesNotMatch(staff, /<button\b[^>]*>Refresh forecasts<\/button>/);
  assert.match(staff, /The owner can refresh forecasts/);
});

test("enabled API schedules give staff truthful automatic status while keeping owner-only refresh", () => {
  const schedule = { enabled: true, localTime: "00:15", timezone: "Asia/Manila" };
  const forecast = { holdout: [], future: [] };
  for (const message of [
    "Waiting to update forecasts. Your previous forecast is shown for now.",
    "Updating forecasts… Your previous forecast is shown for now.",
    "Forecast saved through 2026-10-15",
  ]) {
    const markup = renderPage(forecastsRoute, {
      role: "staff",
      forecast,
      schedule,
      message,
      status: message.startsWith("Forecast saved") ? "ready" : "training",
    });
    assert.doesNotMatch(markup, /Forecasts update daily at 00:15 \(Asia\/Manila\)/);
    assert.ok(markup.includes(message));
    assert.doesNotMatch(
      markup,
      /<button\b[^>]*>Refresh forecasts<\/button>|The owner can refresh forecasts/,
    );
    assert.doesNotMatch(markup, /0\/1|width:0%/);
  }
  assert.match(
    renderPage(forecastsRoute, { forecast, schedule }),
    /<button\b[^>]*>Refresh forecasts<\/button>/,
  );
});

test("disabled or missing API schedules and browser demonstration never promise daily automation", () => {
  const forecast = { holdout: [], future: [] };
  const schedule = { enabled: true, localTime: "00:15", timezone: "Asia/Manila" };
  for (const options of [
    { role: "staff", forecast },
    { role: "staff", forecast, schedule: { ...schedule, enabled: false } },
    { mode: "browser-demo", forecast, schedule },
  ]) {
    const markup = renderPage(forecastsRoute, options);
    assert.doesNotMatch(markup, /Forecasts update daily/);
    if (options.mode !== "browser-demo") assert.match(markup, /The owner can refresh forecasts/);
  }
});

test("scheduled refresh advice keeps expired staff forecasts unavailable and delivery entry usable", () => {
  const options = {
    role: "staff",
    schedule: { enabled: true, localTime: "00:15", timezone: "Asia/Manila" },
    expired: true,
    rows: [{ ...baseRow, forecastExpired: true, demandAvailable: false, reorderQty: 99 }],
  };
  for (const route of [overviewRoute, restockRoute]) {
    const markup = renderPage(route, options);
    assert.match(markup, /wait for the daily automatic refresh/);
    assert.doesNotMatch(markup, /ask the owner to refresh|>99<|>Healthy<\/span>/);
  }
  assertDeliveryEnabled(renderPage(restockRoute, options));
});

test("an inactive catalog directs staff to the owner and excludes archived products from forecasts", () => {
  const inactive = { ...product, isActive: false };
  const options = { role: "staff", catalog: [inactive], rows: [] };
  const overview = renderPage(overviewRoute, options);
  const restock = renderPage(restockRoute, options);
  assert.match(overview, /Ask the owner to add or activate products/);
  assert.match(overview, /0 SKUs on the shelf/);
  assert.match(restock, /No active products to assess/);
  assert.doesNotMatch(restock, /<button\b[^>]*>Record delivery<\/button>/);
  assert.doesNotMatch(renderPage(forecastsRoute, options), /Synthetic practice rice/);
});

test("missing saved counts remain unknown while known zero counts remain visible", () => {
  assert.match(
    renderEvidence(),
    /Days with missing records: not recorded.*Days left out: not recorded/,
  );
  assert.match(
    renderEvidence({ unknownDays: 0, excludedDays: 0 }),
    /Days with missing records: 0.*Days left out: 0/,
  );
  assert.match(
    renderEvidence({ unknownDays: NaN, excludedDays: -1 }),
    /Days with missing records: not recorded.*Days left out: not recorded/,
  );
});

test("saved fallback, unavailable reasons, and quality warnings remain distinct", () => {
  const markup = renderEvidence({
    forecast: {
      fallbackReason: "Not enough training observations",
      unavailableReason: "No usable sales history",
      unknownDays: 7,
      excludedDays: 2,
      qualityWarnings: ["Review missing days", "Review missing days"],
    },
  });
  assert.match(markup, /More complete sales history is needed/);
  assert.match(markup, /Sales estimate unavailable: No sales history is ready to use/);
  assert.match(markup, /Days with missing records: 7.*Days left out: 2/);
  assert.equal(markup.match(/Check sales records: Review missing days/g).length, 1);
});

test("unavailable history on overview omits demand evidence and never shows healthy coverage", () => {
  const markup = renderPage(overviewRoute, {
    rows: [
      {
        ...baseRow,
        demandAvailable: false,
        dailyDemand: NaN,
        unavailableReason: "No usable sales history",
        unknownDays: 6,
        excludedDays: 3,
      },
    ],
  });
  assert.match(markup, /1 without current demand/);
  assert.match(markup, /Current reorder advice is unavailable/);
  assert.doesNotMatch(markup, /Demand evidence|Days with missing records:|Days left out:/);
  assert.doesNotMatch(markup, /Healthy cover across|Stock is above reorder points/);
});

test("overview distinguishes an empty catalog and missing current recommendations", () => {
  const empty = renderPage(overviewRoute, { catalog: [], rows: [] });
  assert.match(empty, /Add or activate inventory and record sales history/);
  assert.match(empty, /No active products to assess/);
  const waiting = renderPage(overviewRoute, { rows: [] });
  assert.match(waiting, /1 without current demand/);
  assert.match(waiting, /Current reorder advice is unavailable/);
  assert.doesNotMatch(waiting, /Healthy cover across|Stock is above reorder points/);
});

test("zero usable demand differs from unavailable history on overview", () => {
  const markup = renderPage(overviewRoute, {
    rows: [{ ...baseRow, dailyDemand: 0, daysOfCover: Infinity }],
  });
  assert.match(markup, /Usable observations show zero demand/);
  assert.match(markup, /Days of cover cannot be calculated from a zero estimate/);
  assert.doesNotMatch(markup, /Current reorder advice is unavailable/);
});

test("expired overview advice never uses cached positive demand as healthy coverage", () => {
  const markup = renderPage(overviewRoute, {
    expired: true,
    rows: [{ ...baseRow, forecastExpired: true, demandAvailable: false }],
  });
  assert.match(markup, /Forecast expired/);
  assert.match(markup, /Saved predictions have expired/);
  assert.doesNotMatch(markup, /Healthy cover across|Stock is above reorder points/);
});

test("unavailable restock rows retain delivery entry and suppress numerical suggestions", () => {
  const markup = renderPage(restockRoute, {
    rows: [
      {
        ...baseRow,
        demandAvailable: false,
        dailyDemand: NaN,
        unavailableReason: "No usable sales history",
        fallbackReason: "Calendar history is incomplete",
        unknownDays: 4,
        excludedDays: 2,
        reorderQty: 99,
      },
    ],
  });
  assert.match(markup, /No sales history is ready to use/);
  assert.match(markup, /Some dates have missing records or could not be used/);
  assert.match(markup, /Days with missing records: 4.*Days left out: 2/);
  assertDeliveryEnabled(markup);
  assert.doesNotMatch(markup, />99<|All products have a usable demand estimate/);
});

test("usable fallback demand shows its reason without labelling demand unavailable", () => {
  const markup = renderPage(restockRoute, {
    rows: [
      {
        ...baseRow,
        fallbackReason: "Not enough nonzero training days",
        unknownDays: 0,
        excludedDays: 1,
      },
    ],
  });
  assert.match(markup, /Using a basic estimate: More complete sales history is needed/);
  assert.match(markup, /Days with missing records: 0.*Days left out: 1/);
  assert.doesNotMatch(markup, /Sales estimate unavailable:/);
});

test("zero-demand restock rows do not imply finite stock coverage and retain delivery entry", () => {
  const markup = renderPage(restockRoute, {
    rows: [{ ...baseRow, dailyDemand: 0, daysOfCover: 99 }],
    mode: "browser-demo",
  });
  assert.match(markup, /No sales expected/);
  assert.match(markup, /We cannot estimate how long this stock may last/);
  assertDeliveryEnabled(markup);
  assert.doesNotMatch(markup, />99\.0<|>Healthy<\/span>/);
});

test("restock empty catalog and missing estimates make no complete-demand claim", () => {
  assert.match(renderPage(restockRoute, { catalog: [], rows: [] }), /No active products to assess/);
  const waiting = renderPage(restockRoute, { rows: [] });
  assert.match(waiting, /Waiting for sales estimates/);
  assert.match(waiting, /You can still record deliveries in Inventory/);
  assert.doesNotMatch(waiting, /All products have a usable demand estimate/);
});

test("unavailable history with a placeholder zero is never presented as usable zero demand", () => {
  const rows = [
    {
      ...baseRow,
      demandAvailable: false,
      dailyDemand: 0,
      unavailableReason: "No usable sales history",
    },
  ];
  const overview = renderPage(overviewRoute, { rows });
  assert.match(overview, /Current reorder advice is unavailable/);
  assert.doesNotMatch(overview, /Usable observations show zero demand/);
  const restock = renderPage(restockRoute, { rows });
  assert.doesNotMatch(restock, /The current estimate is zero sales|>No sales expected<\/span>/);
  assertDeliveryEnabled(restock);
});

test("expired restock advice suppresses cached quantities while retaining delivery entry", () => {
  const markup = renderPage(restockRoute, {
    expired: true,
    rows: [{ ...baseRow, forecastExpired: true, reorderQty: 99 }],
  });
  assert.match(markup, /Expired forecast/);
  assert.match(markup, /saved forecast period has ended/);
  assert.doesNotMatch(markup, />99<|>Healthy<\/span>/);
  assertDeliveryEnabled(markup);
});

test("operational badges describe evidence without fixed low or fabricated high confidence", () => {
  for (const [status, label] of [
    ["tested", "Tested on past sales"],
    ["basic", "Basic estimate"],
    ["untested", "Not tested yet"],
    ["needs_refresh", "Refresh needed"],
    ["unavailable", "No current estimate"],
    ["expired", "Expired forecast"],
  ]) {
    const markup = renderToStaticMarkup(
      createElement(ForecastEvidenceBadge, {
        evidence: {
          status,
          testObservations: status === "tested" ? 1000 : 0,
          mae: "500",
          rmse: "600",
        },
      }),
    );
    assert.ok(markup.includes(label));
    assert.doesNotMatch(
      markup,
      /Low confidence|High confidence|Medium confidence|100%|bg-danger|bg-primary/,
    );
  }
  assert.match(
    renderToStaticMarkup(createElement(ForecastEvidenceBadge)),
    /Test results unavailable/,
  );
});

test("restock shows recorded test days and quantity error, including poor results without success styling", () => {
  const markup = renderPage(restockRoute, {
    rows: [
      {
        ...baseRow,
        forecastEvidence: { status: "tested", testObservations: 14, mae: "20", rmse: "25" },
      },
    ],
  });
  assert.match(markup, /Tested on past sales/);
  assert.match(markup, /Tested on 14 past days\..*Average error: 20\.0 units\./);
  assert.doesNotMatch(markup, /Low confidence|High confidence/);
  const stale = renderEvidence({
    forecastEvidence: { status: "needs_refresh", testObservations: 1, mae: "2", rmse: "3" },
  });
  assert.match(stale, /Tested on 1 past day\..*older forecast/);
});

test("browser demonstration does not present its heuristic confidence as real accuracy evidence", () => {
  const markup = renderPage(restockRoute, {
    mode: "browser-demo",
    rows: [{ ...baseRow, confidence: "high" }],
  });
  assert.match(markup, />Demonstration<\/span>/);
  assert.doesNotMatch(markup, /High confidence|Low confidence/);
});

test("operational confidence badges show Python ratings with their measured explanations", () => {
  for (const [level, label, relativeError] of [
    ["high", "High confidence", "0.1"],
    ["medium", "Medium confidence", "0.3"],
    ["low", "Low confidence", "0.8"],
  ]) {
    const markup = renderPage(restockRoute, {
      rows: [
        {
          ...baseRow,
          forecastEvidence: { status: "tested", testObservations: 14, mae: "1", rmse: "2" },
          forecastConfidence: {
            level,
            policy: "past_test_wape_v1",
            relativeError,
            testObservations: 14,
            reason: "Saved past error rating.",
          },
        },
      ],
    });
    assert.match(markup, new RegExp(label));
    assert.match(markup, /Saved past error rating/);
    assert.match(markup, /Past error compared with actual sales:/);
    assert.match(markup, /Tested on 14 past days/);
  }
});

test("stale evidence overrides a passed high rating and demo labels remain demonstrations", () => {
  const confidence = {
    level: "high",
    policy: "past_test_wape_v1",
    relativeError: "0.1",
    testObservations: 14,
    reason: "Past test.",
  };
  const markup = renderToStaticMarkup(
    createElement(ForecastEvidenceBadge, {
      confidence,
      evidence: { status: "needs_refresh", testObservations: 14, mae: "1", rmse: "2" },
    }),
  );
  assert.match(markup, /Refresh needed/);
  assert.doesNotMatch(markup, /High confidence/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      createElement(ForecastEvidenceBadge, {
        confidence,
        demonstration: true,
      }),
    ),
    /High confidence/,
  );
});

const testScope = {
  limit: 5,
  trainingStart: "2026-01-01",
  trainingEnd: "2026-05-01",
  ranking: "training_sales_volume_v1",
  products: [{ productId: product.id, rank: 1, trainingQuantity: "1234" }],
};
function topPanel(patch = {}) {
  return renderToStaticMarkup(
    createElement(TopForecastProducts, {
      scope: testScope,
      configuredLimit: 5,
      products: [product],
      forecasts: { [product.id]: { dailyDemand: 2, demandAvailable: true } },
      ...patch,
    }),
  );
}

test("Forecasts visibly includes the saved Top products selection and dates", () => {
  const markup = renderPage(forecastsRoute, {
    forecast: { holdout: [], future: [] },
    diagnostics: { trainingScope: testScope },
  });
  assert.match(markup, /Top products for XGBoost/);
  assert.match(markup, /1 selected.*maximum 5/);
  assert.match(markup, /2026-01-01 to 2026-05-01/);
  assert.match(markup, /1,234\.0.*bag/);
  assert.match(markup, /Product code: SYNTHETIC-001/);
});

test("Top products explains fewer eligible products without filling fake slots", () => {
  const markup = topPanel();
  assert.match(markup, /1 product shown/);
  assert.match(markup, /Fewer products appear when fewer have enough usable history/);
  assert.match(markup, /2\.0 bag/);
  assert.match(topPanel({ scope: null }), /Refresh forecasts to see the selected products/);
  assert.match(
    topPanel({ scope: { ...testScope, products: [] } }),
    /No active products were selected/,
  );
});

test("Top products preserves old ranking limit and hides inactive or stale current advice", () => {
  const changed = topPanel({ configuredLimit: 20, stale: true });
  assert.match(changed, /maximum changed to 20/);
  assert.match(changed, /Records or settings changed/);
  assert.doesNotMatch(changed, /2\.0 bag/);
  const inactive = topPanel({ products: [{ ...product, isActive: false }] });
  assert.doesNotMatch(inactive, /Product code: SYNTHETIC-001/);
  assert.match(inactive, /0 products shown/);
  assert.equal(topPanel({ demonstration: true }), "");
});

test("a ready page without validation evidence does not mark any model selected", () => {
  const options = {
    forecast: { holdout: [], future: [] },
    diagnostics: { comparisonWinnerAvailable: false },
  };
  for (const route of [overviewRoute, forecastsRoute]) {
    const markup = renderPage(route, options);
    assert.doesNotMatch(markup, /<span\b[^>]*>(?:Selected|Chosen method)<\/span>/);
  }
});

test("mixed-unit overall results show a product-selection message without pooled scores or a selected model", () => {
  const overallScores = { maMae: 50.5, maRmse: 70.7 };
  for (const mode of ["api", "browser-demo"]) {
    for (const route of [overviewRoute, forecastsRoute]) {
      const markup = renderPage(route, {
        mode,
        forecast: { holdout: [], future: [] },
        diagnostics: { comparisonMixedUnits: true, comparisonWinnerAvailable: false },
        overallScores,
      });
      assert.match(markup, /Products use different units\. Choose a product/);
      assert.doesNotMatch(markup, /MAE 50\.5|RMSE 70\.7|>50\.5<|>Selected<\/span>/);
    }
  }
});

test("cached browser demonstration scores are withheld when product units differ", () => {
  const other = { ...product, id: "other-unit", unit: "litre" };
  for (const route of [overviewRoute, forecastsRoute]) {
    const markup = renderPage(route, {
      mode: "browser-demo",
      catalog: [product, other],
      overallScores: {
        maMae: 50.5,
        maRmse: 70.7,
        byProduct: {
          [product.id]: { holdout: [], future: [] },
          [other.id]: { holdout: [], future: [] },
        },
      },
    });
    assert.match(markup, /Products use different units\. Choose a product/);
    assert.doesNotMatch(markup, /MAE 50\.5|RMSE 70\.7|>50\.5<|>Selected<\/span>/);
  }
});

test("browser demonstration withholds mixed-unit errors and keeps individual product results", async () => {
  const other = { ...product, id: "other", sku: "OTHER", unit: "litre" };
  const sales = [product, other].flatMap((item) =>
    Array.from({ length: 70 }, (_, index) => ({
      id: `${item.id}-${index}`,
      productId: item.id,
      date: new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10),
      qty: (index % 3) + 1,
    })),
  );
  const mixed = await runPipeline([product, other], sales, defaultSettings, { mode: "serve" });
  assert.equal(mixed.diagnostics.comparisonMixedUnits, true);
  assert.equal(mixed.diagnostics.comparisonWinnerAvailable, false);
  assert.ok(Number.isNaN(mixed.maMae));
  assert.ok(Number.isNaN(mixed.maRmse));
  assert.ok(Number.isFinite(mixed.byProduct[product.id].maMae));
  assert.ok(Number.isFinite(mixed.byProduct[other.id].maMae));
  const same = await runPipeline([product, { ...other, unit: " BAG " }], sales, defaultSettings, {
    mode: "serve",
  });
  assert.equal(same.diagnostics.comparisonMixedUnits, false);
  assert.ok(Number.isFinite(same.maMae));
  assert.ok(Number.isFinite(same.maRmse));
});
