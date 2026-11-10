import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Fresh browser and synthetic intercepted HTTP; real Inventory UI, store and API adapter.
// No saved browser profile, live business records, database writes or forecast refreshes.
process.env.VITE_DATA_MODE = "api";
process.env.VITE_API_URL = "/api/v1";
const output = resolve("benchmarks/daily-sales");
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: resolve(output, "vite-cache"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const owner = {
  userId: "synthetic-daily-sales-owner",
  businessId: "synthetic-daily-sales-business",
  role: "owner",
  email: "daily-sales@example.test",
  displayName: "Synthetic daily-sales owner",
};
const products = [
  ["bulk", "Synthetic ledger filler", "DAILY-BULK", "pc", true],
  ["rice", "Synthetic rice", "DAILY-RICE", "kg", true],
  ["water", "Synthetic bottled water", "DAILY-WATER", "bottle", true],
  ["snacks", "Synthetic snack packs", "DAILY-PACK", "pack", true],
  ["retired", "Synthetic retired item", "DAILY-RETIRED", "pc", false],
].map(([id, name, sku, unit, isActive]) => ({
  id,
  name,
  sku,
  category: "Synthetic verification",
  unit,
  currentStock: "20",
  leadTimeDays: 3,
  safetyStock: "5",
  unitCost: "1",
  isActive,
}));
const settings = {
  businessId: owner.businessId,
  businessName: "Synthetic daily-sales store",
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
const sales = [
  ...Array.from({ length: 1000 }, (_, index) => ({
    id: `synthetic-filler-${String(1000 - index).padStart(4, "0")}`,
    productId: "bulk",
    saleDate: "2026-11-09",
    quantity: "1",
    source: "csv_import",
    createdAt: "2026-11-10T00:00:00Z",
  })),
  {
    id: "target-rice-next-day",
    productId: "rice",
    saleDate: "2026-11-09",
    quantity: "0.4",
    source: "csv_import",
    createdAt: "2026-11-10T00:30:00Z",
  },
  ...[
    ["target-rice-manual", "rice", "0.1", "manual"],
    ["target-rice-imported", "rice", "0.2", "csv_import"],
    ["target-water-manual", "water", "2", "manual"],
    ["target-water-pos", "water", "3", "pos_import"],
    ["target-snacks-imported", "snacks", "4", "csv_import"],
    ["target-retired-imported", "retired", "2", "migration"],
  ].map(([id, productId, quantity, source]) => ({
    id,
    productId,
    saleDate: "2026-11-08",
    quantity,
    source,
    // Intentionally not the sale date: uploaded/recorded at a later instant.
    createdAt: "2026-11-10T00:30:00Z",
  })),
];
const report = {
  provenance:
    "Synthetic intercepted HTTP in a fresh browser; actual Inventory UI/store/API client. No live records, database writes, model training or partner findings.",
  checks: [],
  requests: [],
  unexpectedRequests: [],
  browserErrors: [],
};
let browser;
let context;
let page;

function passed(message) {
  report.checks.push(message);
  console.log(`Passed ${report.checks.length}: ${message}`);
}

function dashboard() {
  return {
    stale: false,
    expired: false,
    forecastThrough: null,
    businessDay: "2026-11-10",
    businessTimezone: "Asia/Manila",
    run: null,
    latestRun: null,
    asOf: "2026-11-10",
    message: "Synthetic daily-sales verification",
    summaries: {},
    predictions: [],
    metrics: [],
    recommendations: [],
    sharedState: { products, settings },
  };
}

const table = () => page.getByRole("table", { name: "Products sold", exact: true });
const selectedDate = () => page.getByLabel("Sales date", { exact: true });
const panel = () => page.getByRole("tabpanel");
const search = () => page.getByRole("searchbox", { name: "Search products or SKU", exact: true });
const productRow = (sku, date = "2026-11-08") =>
  table()
    .getByRole("row")
    .filter({ hasText: sku })
    .filter({ has: page.locator(`time[datetime="${date}"]`) });
async function assertProduct(sku, name, quantity, unit, records, date = "2026-11-08") {
  const row = productRow(sku, date);
  await row.waitFor();
  const values = (await row.getByRole("cell").allInnerTexts()).map((text) => text.trim());
  const headers = (await table().getByRole("columnheader").allInnerTexts()).map((text) =>
    text.trim().toLowerCase(),
  );
  assert.ok(
    values.some((text) => text.includes(name)),
    `${sku} product name is visible`,
  );
  assert.ok(
    values.some((text) => text.includes(sku)),
    `${sku} code is visible`,
  );
  assert.equal(values[headers.indexOf("quantity")], quantity, `${sku} quantity`);
  assert.equal(values[headers.indexOf("unit")], unit, `${sku} unit`);
  assert.equal(await row.locator("time").getAttribute("datetime"), date, `${sku} sale date`);
  const expectedDate = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
  assert.equal(values[headers.indexOf("date")], expectedDate, `${sku} readable date`);
  assert.equal(
    values[headers.indexOf("sales records")].split("\n")[0],
    records,
    `${sku} sale-record count`,
  );
}

async function assertQuantityUnitGap(viewport) {
  const headers = (await table().getByRole("columnheader").allInnerTexts()).map((text) =>
    text.trim().toLowerCase(),
  );
  const gap = await productRow("DAILY-RICE").evaluate(
    (row, indexes) => {
      const cells = row.querySelectorAll("td");
      const numberRange = document.createRange();
      numberRange.selectNodeContents(cells[indexes.quantity]);
      const unitRange = document.createRange();
      unitRange.selectNodeContents(cells[indexes.unit]);
      const number = numberRange.getBoundingClientRect();
      const unit = unitRange.getBoundingClientRect();
      return unit.left - number.right;
    },
    { quantity: headers.indexOf("quantity"), unit: headers.indexOf("unit") },
  );
  report.quantityUnitGaps ??= {};
  report.quantityUnitGaps[viewport] = gap;
  assert.ok(
    gap >= 32,
    `${viewport} quantity and unit text gap is ${gap}px; expected at least 32px`,
  );
}

try {
  await server.listen();
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
    report.requests.push({ method: request.method(), path, query: url.search });
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
      if (path.endsWith("/auth/me")) return json(owner);
      if (path.endsWith("/auth/members")) return json([]);
      if (path.endsWith("/products")) return json(products);
      if (path.endsWith("/settings")) return json(settings);
      if (path === `/api/v1/businesses/${owner.businessId}`)
        return json({ name: settings.businessName, location: "", dataOrigin: "demo" });
      if (path.endsWith("/sales")) {
        const cursor = url.searchParams.get("beforeId");
        const offset = cursor
          ? sales.findIndex((sale) => sale.id === cursor) + 1
          : Number(url.searchParams.get("offset") ?? 0);
        assert.ok(offset >= 0, "The API adapter sends a known pagination cursor");
        return json(sales.slice(offset, offset + Number(url.searchParams.get("limit") ?? 1000)));
      }
      if (path.endsWith("/inventory-movements")) return json([]);
      if (path.endsWith("/forecast-status")) return json({ revision: "synthetic-revision-1" });
      if (path.endsWith("/forecast-dashboard")) return json(dashboard());
    }
    report.unexpectedRequests.push({ method: request.method(), path });
    return route.fulfill({ status: 500, body: "Unexpected synthetic verification request" });
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-10T01:00:00Z"));
  const base = server.resolvedUrls.local[0];
  await page.goto(`${base}inventory`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("tab", { name: "Daily sales", exact: true }).click();
  await selectedDate().waitFor();
  assert.equal(await selectedDate().inputValue(), "2026-11-10");
  passed(
    "Inventory exposes Daily sales and defaults to the business date across browser timezones.",
  );

  assert.match(await panel().innerText(), /No sales records/i);
  assert.doesNotMatch(await panel().innerText(), /confirmed zero|zero-sales day/i);
  passed("An unrecorded date says no sales records without claiming a confirmed zero-sales day.");

  await page.getByRole("button", { name: "Yesterday", exact: true }).click();
  assert.equal(await selectedDate().inputValue(), "2026-11-09");
  await assertProduct(
    "DAILY-BULK",
    "Synthetic ledger filler",
    "1,000",
    "pc",
    "1,000",
    "2026-11-09",
  );
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.4", "kg", "1", "2026-11-09");
  assert.equal(await table().locator("tbody tr").count(), 2);
  passed("Yesterday uses the business timezone and aggregates 1,000 records into one product row.");

  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  assert.equal(await selectedDate().inputValue(), "2026-11-08");
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.3", "kg", "2");
  await assertProduct("DAILY-WATER", "Synthetic bottled water", "5", "bottle", "2");
  await assertProduct("DAILY-PACK", "Synthetic snack packs", "4", "pack", "1");
  await assertProduct("DAILY-RETIRED", "Synthetic retired item", "2", "pc", "1");
  assert.equal(await table().locator("tbody tr").count(), 4);
  assert.equal(await page.getByTestId("daily-sales-product-count").innerText(), "4");
  assert.equal(await page.getByTestId("daily-sales-record-count").innerText(), "6");
  assert.match(await panel().innerText(), /2 recorded\s*·\s*4 imported/);
  passed(
    "Sale dates include recorded and imported history beyond the first API page, with inactive products retained.",
  );
  passed(
    "Quantities aggregate decimals accurately and keep kg, bottles, packs and pieces explicit.",
  );

  const paginatedRead = report.requests.some(
    ({ path, query }) => path.endsWith("/sales") && query.includes("beforeId="),
  );
  assert.equal(paginatedRead, true);
  assert.doesNotMatch(await panel().innerText(), /0\.30000000000000004/);
  const unitTotals = await page.getByLabel("Quantity totals by unit", { exact: true }).innerText();
  assert.match(unitTotals, /0\.3\s*kg/);
  assert.match(unitTotals, /5\s*bottle/);
  assert.match(unitTotals, /4\s*pack/);
  assert.match(unitTotals, /2\s*pc/);
  assert.deepEqual(
    await table()
      .locator("tbody time")
      .evaluateAll((dates) => [...new Set(dates.map((date) => date.getAttribute("datetime")))]),
    ["2026-11-08"],
  );
  passed(
    "Every single-day product row shows its actual sale date, separately from its upload date.",
  );
  await assertQuantityUnitGap("desktop");
  passed("Desktop quantity values and counting units have at least 32px of visible separation.");
  await page.screenshot({ path: resolve(output, "desktop-daily-sales.png"), fullPage: true });
  passed(
    "Totals include the cursor page beyond 1,000 sale lines and display no floating-point residue.",
  );

  await search().fill("  sYnThEtIc RiCe  ");
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.3", "kg", "2");
  assert.equal(await table().locator("tbody tr").count(), 1);
  assert.equal(await page.getByTestId("daily-sales-product-count").innerText(), "1");
  assert.equal(await page.getByTestId("daily-sales-record-count").innerText(), "2");
  assert.match(await panel().innerText(), /1 recorded\s*·\s*1 imported/);
  assert.match(
    await page.getByLabel("Quantity totals by unit", { exact: true }).innerText(),
    /0\.3\s*kg/,
  );
  assert.doesNotMatch(
    await page.getByLabel("Quantity totals by unit", { exact: true }).innerText(),
    /bottle|pack|pc/,
  );
  passed(
    "Name search ignores case and surrounding spaces and filters product, record, source and unit totals together.",
  );

  await search().fill("daily-water");
  await assertProduct("DAILY-WATER", "Synthetic bottled water", "5", "bottle", "2");
  assert.equal(await table().locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  assert.equal(await search().inputValue(), "");
  assert.equal(await table().locator("tbody tr").count(), 4);
  assert.equal(await page.getByRole("button", { name: "Clear search", exact: true }).count(), 0);
  await search().fill("   ");
  assert.equal(await table().locator("tbody tr").count(), 4);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  passed(
    "SKU search is case-insensitive; clear search and whitespace-only queries restore all matching-date products.",
  );

  await search().fill("no-product-with-this-name");
  await page.getByRole("heading", { name: "No matching products", exact: true }).waitFor();
  assert.equal(await table().count(), 0);
  assert.equal(await page.getByTestId("daily-sales-product-count").innerText(), "0");
  assert.equal(await page.getByTestId("daily-sales-record-count").innerText(), "0");
  assert.doesNotMatch(await panel().innerText(), /No sales records found/i);
  await page.getByRole("button", { name: "Show all products", exact: true }).click();
  assert.equal(await search().inputValue(), "");
  assert.equal(await table().locator("tbody tr").count(), 4);
  passed(
    "An unmatched search has a distinct empty state and restores the dated report through Show all products.",
  );

  await page.getByRole("button", { name: "Next day", exact: true }).click();
  assert.equal(await selectedDate().inputValue(), "2026-11-09");
  await assertProduct(
    "DAILY-BULK",
    "Synthetic ledger filler",
    "1,000",
    "pc",
    "1,000",
    "2026-11-09",
  );
  await selectedDate().fill("2026-11-07");
  await page.getByText(/No sales records/i).waitFor();
  assert.equal(await table().count(), 0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  assert.equal(await selectedDate().inputValue(), "2026-11-10");
  passed("Date input, previous/next day and Today consistently change the visible sales report.");

  await page.getByRole("button", { name: "Show sales on 2026-11-08", exact: true }).click();
  assert.equal(await selectedDate().inputValue(), "2026-11-08");
  assert.equal(
    await page
      .getByRole("button", { name: "Show sales on 2026-11-08", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.3", "kg", "2");
  await selectedDate().fill("");
  await page.getByRole("alert").filter({ hasText: "Choose a valid day" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Previous day", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Next day", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await table().count(), 0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  assert.equal(await selectedDate().inputValue(), "2026-11-10");
  passed(
    "The weekday strip selects its day, and a cleared date explains the correction without showing misleading totals.",
  );

  await page.getByRole("button", { name: "Date range", exact: true }).click();
  await page.getByLabel("From date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("To date", { exact: true }).fill("2026-11-09");
  await assertProduct(
    "DAILY-BULK",
    "Synthetic ledger filler",
    "1,000",
    "pc",
    "1,000",
    "2026-11-09",
  );
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.3", "kg", "2");
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.4", "kg", "1", "2026-11-09");
  await assertProduct("DAILY-RETIRED", "Synthetic retired item", "2", "pc", "1");
  assert.equal(await table().locator("tbody tr").count(), 6);
  assert.equal(await page.getByTestId("daily-sales-product-count").innerText(), "5");
  assert.equal(await page.getByTestId("daily-sales-record-count").innerText(), "1,007");
  assert.match(
    await page.getByLabel("Quantity totals by unit", { exact: true }).innerText(),
    /1,002\s*pc/,
  );
  passed(
    "Date ranges include both endpoints and the full matching history without mixing product units.",
  );

  await search().fill("daily-rice");
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.3", "kg", "2");
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.4", "kg", "1", "2026-11-09");
  assert.equal(await table().locator("tbody tr").count(), 2);
  assert.equal(await page.getByTestId("daily-sales-product-count").innerText(), "1");
  assert.equal(await page.getByTestId("daily-sales-record-count").innerText(), "3");
  assert.match(
    await page.getByLabel("Quantity totals by unit", { exact: true }).innerText(),
    /0\.7\s*kg/,
  );
  await page.screenshot({ path: resolve(output, "desktop-search-date-range.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  passed(
    "Range searches retain one row per product and actual sale date while counting each product once in summaries.",
  );

  await page.getByLabel("From date", { exact: true }).fill("2026-11-10");
  await page.getByRole("alert").filter({ hasText: "Choose a valid day" }).waitFor();
  assert.equal(await table().count(), 0);
  await page.getByLabel("From date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("To date", { exact: true }).fill("2026-11-11");
  await page.getByRole("alert").filter({ hasText: "Choose a valid day" }).waitFor();
  assert.equal(await table().count(), 0);
  await page.getByLabel("To date", { exact: true }).fill("2026-11-09");
  await assertProduct("DAILY-RICE", "Synthetic rice", "0.3", "kg", "2");
  passed(
    "Reversed and future date ranges show a clear validation message and recover after correction.",
  );

  await page.getByRole("button", { name: "Single day", exact: true }).click();
  await selectedDate().fill("2026-11-08");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("tab", { name: "Daily sales", exact: true }).scrollIntoViewIfNeeded();
  await selectedDate().scrollIntoViewIfNeeded();
  assert.equal(await selectedDate().isVisible(), true);
  assert.equal(
    await page.getByRole("button", { name: "Previous day", exact: true }).isVisible(),
    true,
  );
  assert.equal(await page.getByRole("button", { name: "Next day", exact: true }).isVisible(), true);
  const bounds = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  report.mobileBounds = bounds;
  assert.ok(bounds.document <= bounds.viewport + 1, JSON.stringify(bounds));
  assert.ok(bounds.body <= bounds.viewport + 1, JSON.stringify(bounds));
  await assertQuantityUnitGap("mobile");
  await search().fill("DAILY-RICE");
  assert.equal(await table().locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  assert.equal(await table().locator("tbody tr").count(), 4);
  passed(
    "Mobile search and clear controls work while quantity/unit text remains separated by at least 32px.",
  );
  await page.screenshot({ path: resolve(output, "mobile-daily-sales.png"), fullPage: true });
  await page.getByRole("heading", { name: "Daily sales", exact: true }).click();
  await page
    .getByRole("region", { name: "Daily sales", exact: true })
    .evaluate((section) =>
      window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - 76 }),
    );
  await page.screenshot({ path: resolve(output, "mobile-viewport.png"), fullPage: false });
  passed(
    "The 390px layout keeps date controls available and tables contained without page overflow.",
  );

  await page.getByRole("button", { name: "Date range", exact: true }).click();
  await page.getByLabel("From date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("To date", { exact: true }).fill("2026-11-09");
  await page.screenshot({ path: resolve(output, "mobile-date-range.png"), fullPage: true });
  assert.equal(await page.getByLabel("From date", { exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("To date", { exact: true }).isVisible(), true);
  passed("Single-day and date-range controls remain usable on a narrow screen.");

  assert.deepEqual(report.unexpectedRequests, []);
  assert.deepEqual(report.browserErrors, []);
  assert.ok(report.requests.every(({ method }) => method === "GET"));
  passed("Browsing reports sends no writes or training requests and produces no browser errors.");
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.failure = error.stack;
  if (page) {
    report.failurePage = await page
      .locator("body")
      .innerText()
      .catch(() => "Unavailable");
    await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  if (context) {
    await context.unrouteAll({ behavior: "wait" }).catch(() => {});
  }
  await browser?.close();
  await server.close();
}
