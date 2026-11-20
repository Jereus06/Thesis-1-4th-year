import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Synthetic intercepted API. Real UI, adapters, store and reloads; no live writes.
process.env.VITE_DATA_MODE = "api";
process.env.VITE_API_URL = "/api/v1";
const output = resolve("benchmarks/selling-prices");
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: resolve(output, "vite-cache"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const owner = {
  userId: "price-owner",
  businessId: "price-store",
  role: "owner",
  email: "prices@example.test",
  displayName: "Synthetic owner",
};
const product = {
  id: "active",
  sku: "SYNTHETIC-CABLE",
  name: "Synthetic cable",
  category: "Synthetic attributes",
  brand: "Example",
  model: "Model A",
  variant: "USB-C 2m",
  unit: "pc",
  unitCost: "4.1256",
  sellingPrice: "19.1250",
  currentStock: "20",
  leadTimeDays: 0,
  safetyStock: "0",
  isActive: true,
};
const products = [
  product,
  {
    ...product,
    id: "inactive",
    sku: "SYNTHETIC-RETIRED",
    name: "Synthetic retired cable",
    isActive: false,
  },
];
const sales = [
  {
    id: "historical",
    productId: "inactive",
    saleDate: "2026-11-19",
    quantity: "2",
    sellingPrice: "10",
    salesAmount: "20",
    source: "csv_import",
  },
  {
    id: "unpriced",
    productId: "active",
    saleDate: "2026-11-19",
    quantity: "3",
    sellingPrice: null,
    salesAmount: null,
    source: "csv_import",
  },
];
const settings = {
  businessId: owner.businessId,
  businessName: "Synthetic price store",
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
const report = {
  provenance: "Synthetic intercepted HTTP; no live business data",
  checks: [],
  errors: [],
  writes: [],
};
let browser;
let context;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (data, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data }) });
    if (request.method() === "GET") {
      if (path.endsWith("/auth/options"))
        return json({ signUpEnabled: false, googleEnabled: false });
      if (path.endsWith("/auth/google/pending")) return json(null);
      if (path.endsWith("/auth/me")) return json(owner);
      if (path.endsWith("/auth/members") || path.endsWith("/inventory-movements")) return json([]);
      if (path.endsWith("/products")) return json(products);
      if (path.endsWith("/settings")) return json(settings);
      if (path.endsWith("/sales")) return json(sales);
      if (path.endsWith("/forecast-status")) return json({ revision: "price-fixture" });
      if (path.endsWith("/forecast-dashboard"))
        return json({
          revision: "price-fixture",
          stale: false,
          expired: false,
          forecastThrough: null,
          businessDay: "2026-11-20",
          businessTimezone: "Asia/Manila",
          run: null,
          latestRun: null,
          asOf: "2026-11-20",
          message: "Synthetic verification",
          summaries: {},
          predictions: [],
          metrics: [],
          recommendations: [],
          sharedState: { products, settings },
        });
      if (path.endsWith(`/businesses/${owner.businessId}`))
        return json({ name: settings.businessName, location: "", dataOrigin: "demo" });
      if (path.includes("/photos") || path.endsWith("/product-photos")) return json([]);
    }
    if (request.method() === "POST" && path.endsWith("/sales")) {
      const payload = request.postDataJSON();
      report.writes.push(payload);
      const row = {
        ...payload,
        id: "new-priced-sale",
        source: "manual",
        salesAmount: String(Number(payload.quantity) * payload.sellingPrice),
      };
      sales.push(row);
      product.currentStock = String(Number(product.currentStock) - Number(payload.quantity));
      return json(row, 201);
    }
    if (request.method() === "PATCH" && path.endsWith("/products/active")) {
      const payload = request.postDataJSON();
      report.writes.push(payload);
      Object.assign(product, payload);
      return json(product);
    }
    if (request.method() === "DELETE" && path.endsWith("/products/active")) {
      if (new URL(request.url()).searchParams.get("deleteHistory") !== "true")
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            detail: "This product has saved records. Select deletion of its records.",
          }),
        });
      report.writes.push({ deleteProduct: "active", deleteHistory: true });
      products.splice(
        products.findIndex((item) => item.id === "active"),
        1,
      );
      for (let i = sales.length - 1; i >= 0; i--)
        if (sales[i].productId === "active") sales.splice(i, 1);
      return json({ deletedRows: 1 });
    }
    report.errors.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, body: "Unexpected synthetic request" });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-20T01:00:00Z"));
  const base = server.resolvedUrls.local[0];
  await page.goto(`${base}sales-report`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("heading", { name: "Sales report", exact: true }).waitFor();
  await page.getByText("Synthetic retired cable (Inactive)", { exact: false }).waitFor();
  assert.match(await page.locator("main").innerText(), /Incomplete: 1 unpriced records/);
  assert.match(
    await page.getByRole("group", { name: "Revenue", exact: true }).innerText(),
    /₱20\.00/,
  );
  await page.getByLabel("View", { exact: true }).selectOption("revenue");
  await page.getByLabel("Chart type", { exact: true }).selectOption("pie");
  assert.match(
    await page.getByLabel("Product share legend", { exact: true }).innerText(),
    /20\.00.*100%/,
  );
  assert.match(
    await page.locator("main").innerText(),
    /Unavailable: no matching daily test evidence/,
  );
  report.checks.push(
    "Inactive history, incomplete revenue, peso precision, revenue shares, and absent test evidence",
  );
  await page.getByRole("button", { name: "Record sale", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.getByLabel("Actual selling price (PHP)").inputValue(), "19.125");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-19");
  await dialog.getByLabel("Quantity", { exact: true }).fill("2");
  await dialog.getByLabel("Actual selling price (PHP)").fill("12.3456");
  await dialog.getByRole("button", { name: "Save sale", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(report.writes[0].sellingPrice, 12.3456);
  assert.match(
    await page.getByRole("group", { name: "Revenue", exact: true }).innerText(),
    /₱44\.69/,
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("group", { name: "Revenue", exact: true }).waitFor();
  assert.match(
    await page.getByRole("group", { name: "Revenue", exact: true }).innerText(),
    /₱44\.69/,
  );
  report.checks.push(
    "Product default, actual-price override, saved amount, stock deduction, and reload",
  );
  await page.goto(`${base}inventory`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("tab", { name: "Products", exact: true }).click();
  await page
    .getByPlaceholder("Search name, SKU, category, brand, model, or variant")
    .fill("USB-C 2m");
  const category = page.locator("details").filter({ hasText: "Synthetic attributes" }).first();
  if (!(await category.getAttribute("open"))) await category.locator("summary").click();
  assert.match(await category.innerText(), /Cost ₱4\.13.*Sell ₱19\.13/s);
  await page.getByRole("button", { name: "Edit details", exact: true }).first().click();
  assert.equal(await dialog.getByLabel("Brand", { exact: true }).inputValue(), "Example");
  assert.equal(await dialog.getByLabel("Model", { exact: true }).inputValue(), "Model A");
  assert.equal(await dialog.getByLabel("Size / variant / cable type").inputValue(), "USB-C 2m");
  await dialog.getByLabel("Lead time (days)").fill("");
  await dialog.getByLabel("Safety stock", { exact: true }).fill("");
  await dialog.getByLabel("Unit cost (PHP)").fill("");
  await dialog.getByLabel("Selling price (PHP, optional)").fill("100");
  await dialog.getByRole("button", { name: "Save details", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(product.unitCost, 4.1256);
  report.checks.push("Blank edit fields save successfully and retain catalog values");
  await page.getByRole("button", { name: "Correct stock count", exact: true }).first().click();
  await dialog.getByLabel("Verified on-hand count (pc)").fill("");
  const writesBeforeBlankCount = report.writes.length;
  await dialog.getByRole("button", { name: "Save count correction", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(report.writes.length, writesBeforeBlankCount);
  await page.getByRole("button", { name: "Correct stock count", exact: true }).first().click();
  await dialog.getByRole("button", { name: "Set count to 0", exact: true }).click();
  await dialog.getByRole("button", { name: "Save count correction", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(product.currentStock, 0);
  report.checks.push(
    "Blank count is a no-op; explicit zero saves without a native validation error",
  );
  await page.getByRole("tab", { name: "Daily sales", exact: true }).click();
  await page.getByLabel("Sales date", { exact: true }).fill("2026-11-19");
  assert.match(await page.getByTestId("daily-sales-total-amount").innerText(), /₱44\.69/);
  report.checks.push(
    "Cost/sell separation, attribute search/edit, and historical amounts after catalog price change",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "daily-sales-mobile.png"), fullPage: true });
  await page.goto(`${base}sales-report`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("heading", { name: "Sales report", exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, "sales-report-mobile.png"), fullPage: true });
  await page.goto(`${base}inventory`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("tab", { name: "Products", exact: true }).click();
  const deleteCategory = page
    .locator("details")
    .filter({ hasText: "Synthetic attributes" })
    .first();
  if (!(await deleteCategory.getAttribute("open"))) await deleteCategory.locator("summary").click();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await dialog.getByRole("button", { name: "Delete product", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "saved records" }).waitFor();
  await dialog.getByRole("checkbox").check();
  await page.screenshot({ path: resolve(output, "delete-product-mobile.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Delete product and records", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    products.some((item) => item.id === "active"),
    false,
  );
  assert.equal(
    sales.some((item) => item.productId === "active"),
    false,
  );
  assert.equal(
    products.some((item) => item.id === "inactive"),
    true,
  );
  report.checks.push(
    "Explicit delete-history choice removes only the selected product and its sales",
  );
  assert.deepEqual(report.errors, []);
  report.checks.push("390px report and Daily sales render without browser errors");
  console.log(`${report.checks.length} selling-price browser groups passed`);
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await context?.close();
  await browser?.close();
  await server.close();
}
