import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Actual Inventory UI/store/API adapter with an isolated Edge profile and synthetic HTTP.
// All unexpected endpoints and every write are rejected before they can leave the browser.
process.env.VITE_DATA_MODE = "api";
process.env.VITE_API_URL = "/api/v1";
const output = resolve("benchmarks/low-stock");
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: resolve(output, "vite-cache"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const owner = {
  userId: "synthetic-stock-owner",
  businessId: "synthetic-stock-business",
  role: "owner",
  email: "stock@example.test",
  displayName: "Synthetic stock owner",
};
const products = [
  ["empty", "Synthetic historyless item", "STOCK-EMPTY", "piece", 0, 0, true],
  ["boundary", "Synthetic water", "STOCK-BOUNDARY", "bottle", 3, 3, true],
  ["below", "Synthetic rice", "STOCK-DECIMAL", "kg", 0.125, 1, true],
  ["forecast", "Synthetic snack packs", "STOCK-FORECAST", "pack", 4, 1, true],
  ["expired", "Synthetic old estimate", "STOCK-EXPIRED", "box", 6, 2, true],
  ["unavailable", "Synthetic unavailable estimate", "STOCK-UNAVAILABLE", "box", 1, 2, true],
  ["healthy", "Synthetic healthy item", "STOCK-HEALTHY", "piece", 20, 5, true],
  ["inactive", "Synthetic inactive item", "STOCK-INACTIVE", "piece", 0, 5, false],
].map(([id, name, sku, unit, stock, safety, isActive]) => ({
  id,
  name,
  sku,
  unit,
  category: "Synthetic stock verification",
  currentStock: String(stock),
  safetyStock: String(safety),
  leadTimeDays: 3,
  unitCost: "1",
  isActive,
}));
const settings = {
  businessId: owner.businessId,
  businessName: "Synthetic low-stock store",
  businessLocation: "",
  dataOrigin: "demo",
  movingAverageWindow: 7,
  forecastHorizonDays: 30,
  targetCoverDays: 7,
  minimumHistoryWeeks: 8,
  minimumNonzeroDays: 100,
  topNProducts: 5,
  cvFolds: 3,
  timezone: "Asia/Manila",
};
const run = {
  id: "synthetic-stock-completed-run",
  status: "completed",
  createdAt: "2026-11-10T00:00:00Z",
  timing: { trainingMs: 1 },
  finalTestStart: "2026-10-01",
  finalTestEnd: "2026-10-30",
  forecastHorizonDays: 30,
  failureMessage: null,
  configuration: {},
};
function recommendation(productId, overrides = {}) {
  return {
    productId,
    method: "moving_average",
    confidenceLevel: "low",
    demandAvailable: true,
    forecastExpired: false,
    unavailableReason: null,
    daily_demand: "2",
    demand_during_lead_time: "6",
    reorder_point: "7",
    target_stock: "21",
    suggested_quantity: "17",
    days_of_cover: "2",
    status: "reorder",
    ...overrides,
  };
}
let mode = "fresh";
let role = "owner";
let holdDashboard = true;
let releaseDashboard;
const dashboardGate = new Promise((resolveGate) => {
  releaseDashboard = resolveGate;
});
let base;
let browser;
let context;
let page;
const report = {
  provenance:
    "Synthetic intercepted HTTP, isolated browser profile and actual Inventory UI/store/API adapter. No live records, database writes, training or partner findings.",
  checks: [],
  requests: [],
  unexpectedRequests: [],
  browserErrors: [],
};
const catalog = () =>
  products.map((product) => ({
    ...product,
    ...(mode === "healthy" && product.isActive ? { currentStock: "20" } : {}),
  }));
function dashboard() {
  const available = mode === "fresh";
  return {
    stale: false,
    expired: false,
    forecastThrough: available ? "2026-12-09" : null,
    businessDay: "2026-11-10",
    businessTimezone: "Asia/Manila",
    run: available ? run : null,
    latestRun: available ? run : null,
    asOf: "2026-11-10",
    message: "Synthetic low-stock verification",
    summaries: available
      ? {
          forecast: {
            historyDays: 100,
            nonzeroDays: 60,
            eligible: false,
            operatingMethod: "moving_average",
          },
        }
      : {},
    predictions: [],
    metrics: [],
    recommendations: available
      ? [
          recommendation("forecast"),
          recommendation("expired", { forecastExpired: true, reorder_point: "10" }),
          recommendation("unavailable", {
            demandAvailable: false,
            daily_demand: null,
            reorder_point: null,
            unavailableReason: "No usable demand history is available.",
          }),
        ]
      : [],
    sharedState: { products: catalog(), settings },
  };
}
function passed(message) {
  report.checks.push(message);
  console.log(`Passed ${report.checks.length}: ${message}`);
}
const panel = () => page.getByRole("region", { name: "Low stock", exact: true });
const table = () => page.getByRole("table", { name: "Low-stock products", exact: true });
const search = () =>
  page.getByRole("searchbox", { name: "Search low-stock products", exact: true });
const row = (sku) => table().getByRole("row").filter({ hasText: sku });
async function waitRows(count) {
  await page.waitForFunction((expected) => {
    const tableElement = document.querySelector('table[aria-label="Low-stock products"]');
    return tableElement && tableElement.querySelectorAll("tbody tr").length === expected;
  }, count);
  assert.equal(await table().locator("tbody tr").count(), count);
}
async function assertItem(sku, quantity, unit, threshold, status) {
  await row(sku).waitFor();
  const headers = (await table().getByRole("columnheader").allInnerTexts()).map((value) =>
    value.trim().toLowerCase(),
  );
  const values = (await row(sku).getByRole("cell").allInnerTexts()).map((value) => value.trim());
  const headerIndex = (pattern) => headers.findIndex((value) => pattern.test(value));
  assert.equal(
    values[headerIndex(/current|on hand|quantity/)],
    quantity,
    `${sku}: current quantity`,
  );
  assert.equal(values[headerIndex(/^unit$/)], unit, `${sku}: counting unit`);
  assert.match(
    values[headerIndex(/threshold/)],
    new RegExp(`^${threshold}(?:\\s|$)`),
    `${sku}: threshold`,
  );
  assert.equal(values[headerIndex(/^status$/)], status, `${sku}: stock status`);
}
async function openInventory() {
  await page.goto(`${base}inventory`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("tab", { name: /^Low stock/ }).click();
  await panel().waitFor();
}
async function screenshot(name, fullPage = true) {
  await page.screenshot({ path: resolve(output, name), fullPage });
}

try {
  await server.listen();
  base = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    timezoneId: "America/Los_Angeles",
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    report.requests.push({ method: request.method(), path });
    const json = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (request.method() === "GET") {
      if (path.endsWith("/auth/options"))
        return json({ signUpEnabled: false, googleEnabled: false });
      if (path.endsWith("/auth/google/pending")) return json(null);
      if (path.endsWith("/auth/me")) return json({ ...owner, role });
      if (path.endsWith("/auth/members")) return json([]);
      if (path.endsWith("/products")) return json(catalog());
      if (path.endsWith("/settings")) return json(settings);
      if (path === `/api/v1/businesses/${owner.businessId}`)
        return json({ name: settings.businessName, location: "", dataOrigin: "demo" });
      // The historyless item intentionally has no sale, no forecast and no recommendation.
      if (path.endsWith("/sales")) return json([]);
      if (path.endsWith("/inventory-movements")) return json([]);
      if (path.endsWith("/forecast-status")) return json({ revision: `synthetic-stock-${mode}` });
      if (path.endsWith("/forecast-dashboard")) {
        if (holdDashboard) await dashboardGate;
        if (mode === "failed")
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Synthetic forecast unavailable" }),
          });
        return json(dashboard());
      }
    }
    report.unexpectedRequests.push({ method: request.method(), path });
    return route.fulfill({ status: 500, body: "Unexpected synthetic verification request" });
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-10T01:00:00Z"));
  await openInventory();
  await waitRows(4);
  await assertItem("STOCK-EMPTY", "0", "piece", "0", "Out of stock");
  passed(
    "Inventory exposes Low stock, including a zero-stock product with no sales or forecast while forecast data is still loading.",
  );

  holdDashboard = false;
  releaseDashboard();
  await waitRows(5);
  await assertItem("STOCK-EMPTY", "0", "piece", "0", "Out of stock");
  await assertItem("STOCK-BOUNDARY", "3", "bottle", "3", "Low stock");
  await assertItem("STOCK-DECIMAL", "0.125", "kg", "1", "Low stock");
  await assertItem("STOCK-FORECAST", "4", "pack", "7", "Low stock");
  await assertItem("STOCK-UNAVAILABLE", "1", "box", "2", "Low stock");
  passed(
    "Affected rows show SKU, exact current quantity, separate counting unit, inclusive threshold and clear stock status.",
  );
  assert.equal(await row("STOCK-HEALTHY").count(), 0);
  assert.equal(await row("STOCK-INACTIVE").count(), 0);
  assert.equal(await row("STOCK-EXPIRED").count(), 0);
  assert.match(await row("STOCK-FORECAST").innerText(), /reorder point|forecast/i);
  assert.match(await row("STOCK-UNAVAILABLE").innerText(), /safety stock/i);
  passed(
    "Fresh demand uses its reorder point; unavailable or expired advice falls back to safety stock, while healthy and inactive products stay excluded.",
  );
  assert.match(await table().locator("tbody tr").first().innerText(), /STOCK-EMPTY/);
  passed("Out-of-stock products appear first without requiring sales history.");
  assert.equal(await page.getByTestId("low-stock-all-count").innerText(), "5");
  assert.equal(await page.getByTestId("low-stock-stockout-count").innerText(), "1");
  assert.equal(await page.getByTestId("low-stock-reorder-count").innerText(), "4");
  assert.equal(
    await panel().getByRole("link", { name: "Open Restock", exact: true }).getAttribute("href"),
    "/restock",
  );
  passed(
    "Summary cards show the full alert counts and Open Restock links to the existing planning screen.",
  );
  await screenshot("desktop-low-stock.png");

  await search().fill("  sYnThEtIc RiCe  ");
  await waitRows(1);
  await assertItem("STOCK-DECIMAL", "0.125", "kg", "1", "Low stock");
  await search().fill("stock-boundary");
  await waitRows(1);
  await assertItem("STOCK-BOUNDARY", "3", "bottle", "3", "Low stock");
  assert.equal(await page.getByTestId("low-stock-all-count").innerText(), "5");
  await page.getByRole("button", { name: "Clear low-stock search", exact: true }).click();
  assert.equal(await search().inputValue(), "");
  await waitRows(5);
  passed(
    "Name and SKU search ignore case and surrounding spaces and clearing restores all alerts.",
  );

  await page.getByRole("button", { name: /^Out of stock(?:\s|$)/ }).click();
  await waitRows(1);
  assert.equal(
    await page
      .getByRole("button", { name: "Out of stock", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.getByTestId("low-stock-all-count").innerText(), "5");
  await assertItem("STOCK-EMPTY", "0", "piece", "0", "Out of stock");
  await page.getByRole("button", { name: /^Low stock(?:\s|$)/ }).click();
  await waitRows(4);
  assert.equal(await row("STOCK-EMPTY").count(), 0);
  await page.getByRole("button", { name: /^All alerts(?:\s|$)/ }).click();
  await waitRows(5);
  passed(
    "Status filters switch between all alerts, out-of-stock items and positive low-stock quantities.",
  );

  await search().fill("no matching synthetic item");
  await page.getByRole("heading", { name: /no matching/i }).waitFor();
  assert.equal(await table().count(), 0);
  await page.getByRole("button", { name: "Show all alerts", exact: true }).click();
  assert.equal(await search().inputValue(), "");
  await waitRows(5);
  passed("Unmatched search shows a clear empty state without hiding or rewriting inventory.");

  await row("STOCK-EMPTY").getByRole("button", { name: "Record delivery", exact: true }).click();
  const delivery = page.getByRole("dialog", { name: "Record delivery", exact: true });
  await delivery.waitFor();
  assert.match(await delivery.innerText(), /Synthetic historyless item/);
  await delivery.getByLabel("Quantity received", { exact: true }).fill("2");
  await delivery.getByRole("button", { name: "Close", exact: true }).click();
  await delivery.waitFor({ state: "hidden" });
  await assertItem("STOCK-EMPTY", "0", "piece", "0", "Out of stock");
  passed(
    "Record delivery opens the existing delivery dialog for the correct item; cancelling it leaves inventory untouched.",
  );

  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("tab", { name: /^Low stock/ }).scrollIntoViewIfNeeded();
  await search().scrollIntoViewIfNeeded();
  const mobileBounds = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  report.mobileBounds = mobileBounds;
  assert.ok(mobileBounds.document <= mobileBounds.viewport + 1, JSON.stringify(mobileBounds));
  assert.ok(mobileBounds.body <= mobileBounds.viewport + 1, JSON.stringify(mobileBounds));
  await search().fill("STOCK-EMPTY");
  await waitRows(1);
  await search().fill("");
  await waitRows(5);
  await screenshot("mobile-low-stock.png");
  await panel().evaluate((section) =>
    window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - 76 }),
  );
  await screenshot("mobile-viewport.png", false);
  passed(
    "The 390px layout keeps navigation, search and filters usable without horizontal page overflow.",
  );

  mode = "no-model";
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openInventory();
  await waitRows(4);
  await assertItem("STOCK-EMPTY", "0", "piece", "0", "Out of stock");
  assert.equal(await row("STOCK-FORECAST").count(), 0);
  passed(
    "Stores with no saved forecast still show catalog-based out-of-stock and safety-stock alerts.",
  );

  mode = "failed";
  await openInventory();
  await waitRows(4);
  await assertItem("STOCK-EMPTY", "0", "piece", "0", "Out of stock");
  passed(
    "A forecast-service failure does not hide zero-stock products or catalog safety thresholds.",
  );

  mode = "fresh";
  role = "staff";
  await openInventory();
  await waitRows(5);
  assert.equal(
    await panel()
      .getByRole("button", { name: /edit|delete|threshold|create/i })
      .count(),
    0,
  );
  await row("STOCK-EMPTY").getByRole("button", { name: "Record delivery", exact: true }).click();
  await delivery.waitFor();
  await delivery.getByRole("button", { name: "Close", exact: true }).click();
  passed(
    "Signed-in staff can view alerts and open their permitted delivery action without owner-only product editing controls.",
  );

  mode = "healthy";
  role = "owner";
  await openInventory();
  await page.getByRole("heading", { name: "No stock alerts", exact: true }).waitFor();
  assert.equal(await table().count(), 0);
  passed(
    "An entirely healthy active catalog has a clear no-alerts state and excludes inactive zero-stock products.",
  );

  assert.deepEqual(report.unexpectedRequests, []);
  assert.deepEqual(report.browserErrors, []);
  assert.ok(report.requests.every(({ method }) => method === "GET"));
  passed(
    "All checks use read-only synthetic transport with no browser errors, live writes or training requests.",
  );
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.failure = error.stack;
  if (page) {
    report.failurePage = await page
      .locator("body")
      .innerText()
      .catch(() => "Unavailable");
    await screenshot("failure.png").catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  holdDashboard = false;
  releaseDashboard();
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await context?.unrouteAll({ behavior: "wait" }).catch(() => {});
  await browser?.close();
  await server.close();
}
