import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the real UI/store/API client against a synthetic, intercepted HTTP service.
// No PostgreSQL, Docker, saved browser profile, or running application is used.
process.env.VITE_DATA_MODE = "browser-demo";
process.env.VITE_API_URL = "/api/v1";
const require = createRequire(resolve("package.json"));
const { chromium } = require("playwright");
const { createServer } = await import(
  pathToFileURL(resolve("node_modules/vite/dist/node/index.js"))
);
const output = resolve("benchmarks/automatic-csv");
await mkdir(output, { recursive: true });
const dependencies = Object.keys(JSON.parse(await readFile("package.json", "utf8")).dependencies);
const server = await createServer({
  cacheDir: resolve(output, "vite-cache-picker"),
  optimizeDeps: {
    include: [
      ...dependencies,
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "zustand/middleware",
    ],
  },
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
const evidence = {
  provenance:
    "Synthetic intercepted HTTP/idempotency simulation in a fresh browser context; real CSV UI, store and API client, no actual database writes.",
  checks: [],
  requests: [],
  unexpectedRequests: [],
};
const session = {
  userId: "synthetic-retry-owner",
  businessId: "synthetic-retry-business",
  email: "retry@example.test",
  displayName: "Synthetic Retry Owner",
  role: "owner",
};
const cache = new Map();
const pageErrors = [];
let catalog = [];
let applications = 0;
let loseNextResponse = false;
let browser;
let page;
try {
  await server.listen();
  console.log("Started isolated inventory retry browser verification.");
  browser = await chromium.launch(
    process.platform === "win32" ? { channel: "msedge", headless: true } : { headless: true },
  );
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (pathname.endsWith("/inventory-imports") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"];
      const body = request.postData();
      const entry = { key, body, replay: cache.has(key) };
      evidence.requests.push(entry);
      let saved = cache.get(key);
      if (saved && saved.body !== body) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "idempotency_conflict",
              message: "Synthetic reused key with different body",
            },
          }),
        });
        return;
      }
      if (!saved) {
        const rows = JSON.parse(body).rows;
        let created = 0;
        let updated = 0;
        for (const row of rows) {
          const existing = catalog.find((product) => product.sku === row.sku);
          if (existing) {
            Object.assign(existing, row, { isActive: true });
            updated++;
          } else {
            catalog.push({ ...row, id: `synthetic-product-${row.sku}`, isActive: true });
            created++;
          }
        }
        applications++;
        saved = { body, response: { created, updated } };
        cache.set(key, saved);
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        await route.abort("connectionreset");
      } else await json(saved.response);
      return;
    }
    if (pathname.endsWith("/products") && request.method() === "GET") {
      await json(
        catalog.map((product) => ({
          ...product,
          currentStock: String(product.currentStock),
          safetyStock: String(product.safetyStock),
          unitCost: String(product.unitCost),
        })),
      );
      return;
    }
    if (pathname.endsWith("/auth/options"))
      return json({ signUpEnabled: false, googleEnabled: false });
    if (pathname.endsWith("/auth/google/pending")) return json(null);
    if (pathname.endsWith("/forecast-dashboard"))
      return json({
        stale: false,
        expired: false,
        forecastThrough: null,
        businessDay: "2026-10-09",
        businessTimezone: "Asia/Manila",
        run: null,
        latestRun: null,
        asOf: "2026-10-09T00:00:00Z",
        message: "Synthetic retry verification",
        summaries: {},
        predictions: [],
        metrics: [],
        recommendations: [],
      });
    evidence.unexpectedRequests.push({ method: request.method(), pathname });
    await route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:5198/inventory", {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.getByRole("tab", { name: "Products", exact: true }).waitFor();
  const baseline = await page.evaluate(async (owner) => {
    const { useAppStore } = await import("/src/lib/store.ts");
    const state = useAppStore.getState();
    const product = {
      ...state.products[0],
      id: "synthetic-retry-product",
      sku: "RETRY-SKU",
      name: "Synthetic Retry Product",
      unit: "bag",
      currentStock: 20,
      isActive: true,
    };
    // Avoid unrelated authentication bootstrap; importInventory itself remains the actual store action.
    useAppStore.setState({
      dataMode: "api",
      session: owner,
      apiStatus: "ready",
      products: [product],
      connectApi: async () => {},
    });
    return { product, sales: state.sales };
  }, session);
  catalog = [structuredClone(baseline.product)];
  const importer = () => page.locator("[data-csv-state]");
  const upload = () => importer().getByRole("button", { name: "Upload CSV", exact: true });
  const csv = (quantity) => `SKU,Stock On Hand\nRETRY-SKU,${quantity}\n`;
  const passed = (message) => {
    evidence.checks.push(message);
    console.log(`Passed ${evidence.checks.length}: ${message}`);
  };
  async function openImport() {
    if (!(await importer().count()))
      await page
        .getByRole("button", { name: "Import inventory", exact: true })
        .evaluate((button) => button.click());
  }
  async function ready() {
    await page.locator('[data-csv-state="ready"]').waitFor();
    await upload().waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-csv-state] [aria-label="CSV upload actions"] button')
          ?.disabled,
    );
    assert.equal(
      await importer().getByRole("combobox").count(),
      0,
      "Normal ready flow must not ask mapping questions",
    );
    assert.equal(
      await importer().getByRole("checkbox").count(),
      0,
      "Normal ready flow must not require a checkbox",
    );
    assert.equal(await importer().locator("details[open]").count(), 0);
  }
  async function selectFile(name, text) {
    await openImport();
    await importer()
      .getByLabel("CSV file", { exact: true })
      .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
    await ready();
    assert.match(
      await importer().locator("[data-csv-feedback]").innerText(),
      /File ready: 1 inventory records/,
    );
  }
  async function submitLost() {
    loseNextResponse = true;
    await upload().click();
    await importer().getByRole("alert").waitFor();
    assert.match(
      await importer().locator("[data-csv-feedback]").innerText(),
      /Upload did not finish/,
    );
    assert.equal(await upload().isEnabled(), true);
  }
  async function submitSuccess(doubleClick = false) {
    if (doubleClick)
      await upload().evaluate((button) => {
        button.click();
        button.click();
      });
    else await upload().click();
    await page.getByRole("button", { name: "Import inventory", exact: true }).waitFor();
    assert.equal(await importer().count(), 0, "Successful import should close the importer");
  }
  async function refreshCatalog() {
    await page.evaluate(async (products) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      useAppStore.setState({ products });
    }, structuredClone(catalog));
    await ready();
  }
  async function stock(sku) {
    return page.evaluate(async (code) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      return useAppStore.getState().products.find((product) => product.sku === code)?.currentStock;
    }, sku);
  }

  await selectFile("synthetic-count10.csv", csv(10));
  await submitLost();
  assert.equal(applications, 1);
  assert.equal(catalog[0].currentStock, 10);
  catalog[0].currentStock = 8; // Intervening committed sale, followed by a catalog refresh.
  await refreshCatalog();
  assert.match(
    await importer().locator("[data-csv-filename]").innerText(),
    /synthetic-count10.csv/,
  );
  await submitSuccess();
  assert.equal(evidence.requests.length, 2);
  assert.ok(evidence.requests[0].key);
  assert.equal(evidence.requests[1].key, evidence.requests[0].key);
  assert.equal(evidence.requests[1].body, evidence.requests[0].body);
  assert.equal(evidence.requests[1].replay, true);
  assert.equal(applications, 1);
  assert.equal(await stock("RETRY-SKU"), 8);
  passed(
    "Lost-response retry after catalog revalidation sends the same key and body, applies the count once, preserves intervening stock 8, and closes successfully.",
  );

  await selectFile("synthetic-count10.csv", csv(10));
  await submitSuccess(true);
  assert.equal(evidence.requests.length, 3, "Two same-task clicks must send one request");
  assert.notEqual(evidence.requests[2].key, evidence.requests[0].key);
  assert.equal(applications, 2);
  assert.equal(await stock("RETRY-SKU"), 10);
  passed(
    "A new intentional import after success has a fresh key; same-task double click sends one HTTP request and applies one count.",
  );

  await selectFile("synthetic-original-selection.csv", csv(10));
  await submitLost();
  const previousSelection = evidence.requests.at(-1);
  await selectFile("synthetic-new-selection.csv", csv(10));
  await submitSuccess();
  const nextSelection = evidence.requests.at(-1);
  assert.notEqual(nextSelection.key, previousSelection.key);
  assert.equal(nextSelection.body, previousSelection.body);
  passed(
    "Selecting a new source after a failed request creates a fresh key even when its prepared rows equal the prior source.",
  );

  await openImport();
  await importer().getByRole("button", { name: "Paste CSV", exact: true }).click();
  await importer().getByLabel("Paste CSV text", { exact: true }).fill(csv(10));
  await ready();
  await submitLost();
  const beforeEdit = evidence.requests.at(-1);
  await importer().getByLabel("Paste CSV text", { exact: true }).fill(csv(12));
  await ready();
  await submitSuccess();
  const afterEdit = evidence.requests.at(-1);
  assert.notEqual(afterEdit.key, beforeEdit.key);
  assert.notEqual(afterEdit.body, beforeEdit.body);
  assert.equal(JSON.parse(afterEdit.body).rows[0].currentStock, 12);
  assert.equal(await stock("RETRY-SKU"), 12);
  passed(
    "Changing prepared stock from 10 to 12 in pasted CSV after failure prepares without questions and sends a fresh key with the changed payload.",
  );

  const newSkuCsv =
    "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost\nNEW-RETRY,Synthetic New Product,Synthetic,bag,10,3,1,40\n";
  await selectFile("synthetic-new-sku.csv", newSkuCsv);
  await submitLost();
  const originalNewSku = evidence.requests.at(-1);
  const originalRows = JSON.parse(originalNewSku.body).rows;
  assert.equal(originalRows[0].name, "Synthetic New Product");
  assert.equal(originalRows[0].unit, "bag");
  const beforeReplayApplications = applications;
  catalog.find((product) => product.sku === "NEW-RETRY").currentStock = 8;
  await refreshCatalog();
  await submitSuccess();
  const replayNewSku = evidence.requests.at(-1);
  assert.equal(replayNewSku.key, originalNewSku.key);
  assert.equal(
    replayNewSku.body,
    originalNewSku.body,
    "Retry must retain original full metadata when automatic new-only preparation changes to an existing count",
  );
  assert.equal(replayNewSku.replay, true);
  assert.equal(applications, beforeReplayApplications);
  assert.equal(await stock("NEW-RETRY"), 8);
  passed(
    "A new SKU created before response loss replays its original full metadata and key after becoming existing in the catalog; its count applies once and intervening stock 8 survives.",
  );

  const finalSales = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/lib/store.ts");
    return useAppStore.getState().sales;
  });
  assert.deepEqual(finalSales, baseline.sales);
  assert.deepEqual(evidence.unexpectedRequests, []);
  assert.deepEqual(pageErrors, []);
  evidence.applications = applications;
  evidence.seededSalesUnchanged = true;
  evidence.pageErrors = pageErrors;
  evidence.passed = true;
  await page.screenshot({
    path: resolve(output, "inventory-retry-browser-passed.png"),
    fullPage: true,
  });
  console.log(
    `All ${evidence.checks.length} inventory retry browser checks passed; all HTTP requests were intercepted.`,
  );
} catch (error) {
  evidence.passed = false;
  evidence.error = error.stack;
  evidence.pageErrors = pageErrors;
  if (page) {
    evidence.renderedBody = await page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch(() => "Unavailable");
    await page
      .screenshot({ path: resolve(output, "inventory-retry-browser-failed.png"), fullPage: true })
      .catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(output, "inventory-retry-browser-result.json"),
    JSON.stringify(evidence, null, 2),
  );
  await browser?.close();
  await server.close();
}
