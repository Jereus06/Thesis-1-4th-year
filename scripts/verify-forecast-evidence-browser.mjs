import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Creates synthetic records only in a new business on a disposable local installation.
// No API interception: the browser consumes the real Python/PostgreSQL dashboard.
const base = process.argv[2] ?? "http://localhost:8080";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname));
const output = "benchmarks/forecast-evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(30_000);
const checks = [];

try {
  const registered = await context.request.post(`${base}/api/v1/auth/sign-up`, {
    headers: { Origin: base },
    data: {
      businessName: "Synthetic forecast evidence verification",
      dataOrigin: "demo",
      displayName: "Forecast test owner",
      email: `forecast-${randomUUID()}@example.com`,
      password: randomUUID() + randomUUID(),
    },
  });
  assert.equal(registered.status(), 201, await registered.text());
  const session = (await registered.json()).data;
  const api = `${base}/api/v1/businesses/${session.businessId}`;
  const csrf = (await context.cookies()).find((cookie) => cookie.name === "stockcast_csrf").value;
  async function request(path, method = "GET", data) {
    const response = await context.request.fetch(api + path, {
      method,
      data,
      headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() },
    });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return (await response.json()).data;
  }
  const product = await request("/products", "POST", {
    sku: "SYN-EVIDENCE",
    name: "Synthetic test product",
    category: "Synthetic test",
    unit: "pc",
    currentStock: "100",
    leadTimeDays: 2,
    safetyStock: "5",
    unitCost: "10",
  });
  await page.goto(base + "/restock", { waitUntil: "domcontentloaded" });
  await page
    .locator("main span")
    .filter({ hasText: /^Demand unavailable$/ })
    .waitFor();
  assert.doesNotMatch(await page.locator("main").innerText(), /Low confidence|High confidence/);
  checks.push("Empty history shows unavailable advice without a confidence score.");

  const dashboard = await request("/forecast-dashboard");
  const end = new Date(dashboard.businessDay + "T00:00:00Z");
  const rows = Array.from({ length: 170 }, (_, index) => ({
    sku: product.sku,
    saleDate: new Date(end.getTime() - (170 - index) * 86_400_000).toISOString().slice(0, 10),
    quantity: "10",
  }));
  const imported = await request("/data-imports", "POST", { source: "csv", rows });
  assert.equal(imported.acceptedRows, rows.length);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Low confidence", { exact: true }).waitFor();
  await page.getByText(/No usable saved past test yet/).waitFor();
  checks.push("Usable untrained history shows Low confidence with an explicit no-test reason.");

  const settings = await request("/settings");
  await request("/settings", "PUT", { ...settings, topNProducts: 5 });
  const candidates = [product];
  for (let index = 1; index <= 5; index++) {
    const candidate = await request("/products", "POST", {
      sku: `SYN-TOP-${index}`,
      name: `Synthetic ranked product ${index}`,
      category: "Synthetic test",
      unit: "pc",
      currentStock: "1000",
      leadTimeDays: 2,
      safetyStock: "5",
      unitCost: "10",
    });
    candidates.push(candidate);
    await request("/data-imports", "POST", {
      source: "csv",
      rows: rows.map((row) => ({
        ...row,
        sku: candidate.sku,
        quantity: String((index + 1) * 10),
      })),
    });
  }
  const shortHistory = await request("/products", "POST", {
    sku: "SYN-SHORT",
    name: "Synthetic high-volume short history",
    category: "Synthetic test",
    unit: "pc",
    currentStock: "1000",
    leadTimeDays: 2,
    safetyStock: "5",
    unitCost: "10",
  });
  await request("/data-imports", "POST", {
    source: "csv",
    rows: rows.slice(-10).map((row) => ({
      ...row,
      sku: shortHistory.sku,
      quantity: "99999",
    })),
  });

  const run = await request("/forecast-refresh", "POST");
  const deadline = Date.now() + 300_000;
  let finished = false;
  while (Date.now() < deadline) {
    const saved = await request(`/forecast-runs/${run.id}`);
    if (saved.status === "failed") throw new Error(saved.failureMessage);
    if (saved.status === "completed") {
      finished = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(finished, "The real forecasting worker must complete.");
  const tested = await request("/forecast-dashboard");
  const advice = tested.recommendations.find((row) => row.productId === product.id);
  const evidence = advice.forecastEvidence;
  assert.equal(evidence.status, "tested");
  assert.ok(evidence.testObservations > 0);
  assert.equal(advice.forecastConfidence.level, "high");
  const scope = tested.trainingScope;
  assert.equal(scope.limit, 5);
  assert.deepEqual(
    scope.products.map((row) => row.productId),
    candidates
      .slice(1)
      .reverse()
      .map((row) => row.id),
  );
  assert.deepEqual(
    scope.products.map((row) => row.rank),
    [1, 2, 3, 4, 5],
  );
  assert.equal(tested.summaries[shortHistory.id].eligible, false);
  assert.equal(tested.modelComparison.finalTest.productIds.length, 5);
  assert.equal(tested.modelComparison.finalTest.observationCount, evidence.testObservations * 5);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("High confidence", { exact: true }).first().waitFor();
  await page
    .getByText(new RegExp(`Past test: ${evidence.testObservations} days\\.`))
    .first()
    .waitFor();
  await page.screenshot({
    path: `${output}/tested-restock.png`,
    fullPage: true,
    animations: "disabled",
  });
  checks.push(
    "Completed Python worker results show High confidence from measured past errors, with saved test days.",
  );

  await page.goto(base + "/forecasts", { waitUntil: "domcontentloaded" });
  const topProducts = page.getByRole("region", { name: "Top products for XGBoost" });
  await topProducts.getByText(/5 selected in the saved run/).waitFor();
  const rankedRows = await topProducts.locator("tbody tr").allTextContents();
  assert.equal(rankedRows.length, 5);
  for (let index = 0; index < 5; index++)
    assert.ok(rankedRows[index].includes(candidates[5 - index].name));
  assert.doesNotMatch(
    await topProducts.innerText(),
    /Synthetic high-volume short history|Synthetic test product/,
  );
  await page.getByText("High confidence", { exact: true }).first().waitFor();
  await page.getByText(/Saved test scores cover/).waitFor();
  await page.screenshot({
    path: `${output}/tested-forecasts.png`,
    fullPage: true,
    animations: "disabled",
  });
  checks.push(
    "Forecasts visibly lists the real Top 5 training products in order, excluding insufficient history.",
  );

  await request("/settings", "PUT", { ...settings, topNProducts: 8 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await topProducts.getByText(/The current limit is 8/).waitFor();
  assert.equal(await topProducts.locator("tbody tr").count(), 5);
  assert.equal((await request("/forecast-dashboard")).trainingScope.limit, 5);
  assert.equal(await topProducts.getByText("High confidence", { exact: true }).count(), 0);
  checks.push(
    "A changed limit keeps the five saved products and withholds old confidence until refresh.",
  );

  await request(`/products/${product.id}`, "PATCH", { name: "Updated synthetic test product" });
  await page.goto(base + "/restock", { waitUntil: "domcontentloaded" });
  await page.getByText("Refresh needed", { exact: true }).first().waitFor();
  await page
    .getByText(/These results belong to the older saved run/)
    .first()
    .waitFor();
  assert.equal(await page.getByText("High confidence", { exact: true }).count(), 0);
  await page.screenshot({
    path: `${output}/stale-restock.png`,
    fullPage: true,
    animations: "disabled",
  });
  checks.push("A product change downgrades the label without erasing the older test evidence.");
  assert.deepEqual(errors, []);
  console.log(`Passed ${checks.length} real API/PostgreSQL/browser forecast-evidence checks.`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        transport: "Real Python API / PostgreSQL / Chromium; no mocked responses",
        provenance:
          "Synthetic verification in a new isolated test business; not client accuracy findings",
        checks,
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
