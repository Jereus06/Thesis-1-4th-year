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
const { Route: overviewRoute } = await server.ssrLoadModule("/src/routes/index.tsx");
const { Route: restockRoute } = await server.ssrLoadModule("/src/routes/restock.tsx");
const { Route: forecastsRoute } = await server.ssrLoadModule("/src/routes/forecasts.tsx");
const { setTestState } = await server.ssrLoadModule("/src/lib/store.ts");
const { setForecastState } = await server.ssrLoadModule("/src/components/forecast-context.tsx");
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
    status: expired ? "expired" : "ready",
    progress: { total: catalog.length, completed: catalog.length, message: "Synthetic fixture" },
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
          diagnostics: { trainedProductCount: 0, topN: 8, disclaimer: "Synthetic test fixture" },
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

test("missing saved counts remain unknown while true zero counts are shown", () => {
  assert.match(renderEvidence(), /Unknown days: not saved.*Excluded days: not saved/);
  assert.match(
    renderEvidence({ unknownDays: 0, excludedDays: 0 }),
    /Unknown days: 0.*Excluded days: 0/,
  );
  assert.match(
    renderEvidence({ unknownDays: NaN, excludedDays: -1 }),
    /Unknown days: not saved.*Excluded days: not saved/,
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
  assert.match(markup, /Fallback reason: Not enough training observations/);
  assert.match(markup, /Demand unavailable: No usable sales history/);
  assert.match(markup, /Unknown days: 7.*Excluded days: 2/);
  assert.equal(markup.match(/Data quality: Review missing days/g).length, 1);
});

test("unavailable history on overview shows evidence and never healthy coverage", () => {
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
  assert.match(markup, /Current demand is unavailable for 1 product/);
  assert.match(markup, /No usable sales history/);
  assert.match(markup, /Unknown days: 6.*Excluded days: 3/);
  assert.doesNotMatch(markup, /Healthy cover across|Stock is above reorder points/);
});

test("overview distinguishes an empty catalog and missing current recommendations", () => {
  const empty = renderPage(overviewRoute, { catalog: [], rows: [] });
  assert.match(empty, /Add or activate products and record sales history/);
  assert.match(empty, /No active products to assess/);
  const waiting = renderPage(overviewRoute, { rows: [] });
  assert.match(waiting, /Waiting for a current demand estimate/);
  assert.doesNotMatch(waiting, /Healthy cover across|Stock is above reorder points/);
});

test("zero usable demand differs from unavailable history on overview", () => {
  const markup = renderPage(overviewRoute, {
    rows: [{ ...baseRow, dailyDemand: 0, daysOfCover: Infinity }],
  });
  assert.match(markup, /Usable observations currently show zero demand/);
  assert.match(markup, /Days of cover cannot be calculated from a zero estimate/);
  assert.doesNotMatch(markup, /Current demand is unavailable for/);
});

test("expired overview advice never uses cached positive demand as healthy coverage", () => {
  const markup = renderPage(overviewRoute, {
    expired: true,
    rows: [{ ...baseRow, forecastExpired: true, demandAvailable: false }],
  });
  assert.match(markup, /Forecasts have expired/);
  assert.match(markup, /saved forecast period has ended/);
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
  assert.match(markup, /No usable sales history/);
  assert.match(markup, /Calendar history is incomplete/);
  assert.match(markup, /Unknown days: 4.*Excluded days: 2/);
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
  assert.match(markup, /Fallback reason: Not enough nonzero training days/);
  assert.match(markup, /Unknown days: 0.*Excluded days: 1/);
  assert.doesNotMatch(markup, /Demand unavailable:|Demand unavailable<\/span>/);
});

test("zero-demand restock rows do not imply finite stock coverage and retain delivery entry", () => {
  const markup = renderPage(restockRoute, {
    rows: [{ ...baseRow, dailyDemand: 0, daysOfCover: 99 }],
    mode: "browser-demo",
  });
  assert.match(markup, /Zero usable demand/);
  assert.match(markup, /Days of cover cannot be calculated from a zero estimate/);
  assertDeliveryEnabled(markup);
  assert.doesNotMatch(markup, />99\.0<|>Healthy<\/span>/);
});

test("restock empty catalog and missing estimates make no complete-demand claim", () => {
  assert.match(renderPage(restockRoute, { catalog: [], rows: [] }), /No active products to assess/);
  const waiting = renderPage(restockRoute, { rows: [] });
  assert.match(waiting, /Waiting for demand estimates/);
  assert.match(waiting, /Actual deliveries can still be recorded in Inventory/);
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
  assert.match(overview, /Current demand is unavailable/);
  assert.doesNotMatch(overview, /Usable observations currently show zero demand/);
  const restock = renderPage(restockRoute, { rows });
  assert.doesNotMatch(restock, /Usable observations show zero demand|>Zero usable demand<\/span>/);
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
