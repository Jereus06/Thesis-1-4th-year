import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real forms/store/API adapter; isolated browser and synthetic intercepted HTTP.
// PostgreSQL transaction behavior is checked separately by backend/tests.
process.env.VITE_DATA_MODE = "browser-demo";
const server = await createServer({
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
let stock = 20;
let loseResponse = true;
let failProductRead = false;
const saved = new Map();
const requests = [];
const sales = [];
const pageErrors = [];
const product = {
  id: "synthetic-product",
  sku: "RETRY-1",
  name: "Synthetic retry product",
  category: "Test",
  unit: "piece",
  currentStock: 20,
  leadTimeDays: 2,
  safetyStock: 0,
  unitCost: 1,
  isActive: true,
};
const session = {
  userId: "synthetic-owner",
  businessId: "synthetic-business",
  role: "owner",
  email: "retry@example.test",
  displayName: "Synthetic owner",
};
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  const context = await browser.newContext({ timezoneId: "Asia/Manila" });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-15T15:59:00Z"));
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (path.endsWith("/auth/options")) return json({ signUpEnabled: false, googleEnabled: false });
    if (path.endsWith("/auth/google/pending")) return json(null);
    if (request.method() === "POST" && /\/(sales|inventory-movements)$/.test(path)) {
      const input = request.postDataJSON();
      const key = request.headers()["idempotency-key"];
      assert.ok(key);
      requests.push({ path, key, input });
      let result = saved.get(key);
      if (result) assert.deepEqual(result.input, input, "a retry keeps the complete saved payload");
      else {
        const isSale = path.endsWith("/sales");
        stock += isSale ? -Number(input.quantity) : Number(input.quantityDelta);
        const data = isSale
          ? { id: `sale-${saved.size}`, ...input, source: "manual" }
          : {
              id: `movement-${saved.size}`,
              ...input,
              balanceAfter: String(stock),
              dataOrigin: "demo",
              note: null,
              saleId: null,
              recordedBy: session.userId,
            };
        result = { input, data };
        saved.set(key, result);
        if (isSale) sales.push(data);
      }
      if (loseResponse) {
        loseResponse = false;
        return route.abort("connectionfailed");
      }
      return json(result.data);
    }
    if (path.endsWith("/products")) {
      if (failProductRead)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Synthetic stock read failed" }),
        });
      return json([{ ...product, currentStock: String(stock) }]);
    }
    if (path.endsWith("/sales")) return json(sales);
    if (path.endsWith("/forecast-status")) return json({ revision: String(saved.size) });
    if (path.endsWith("/forecast-dashboard"))
      return json({
        run: null,
        latestRun: null,
        asOf: "2026-10-15T00:00:00Z",
        businessDay: "2026-10-15",
        businessTimezone: "Asia/Manila",
        stale: false,
        expired: false,
        summaries: {},
        predictions: [],
        metrics: [],
        recommendations: [],
      });
    throw new Error(`Unexpected test request: ${request.method()} ${path}`);
  });
  const base = server.resolvedUrls.local[0];
  await page.goto(`${base}inventory`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("tab", { name: "Products", exact: true }).waitFor();
  await page.evaluate(
    async ({ product: item, session: owner }) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      useAppStore.setState({
        dataMode: "api",
        session: owner,
        apiStatus: "ready",
        products: [item],
        sales: [],
        settings: { ...useAppStore.getState().settings, timezone: "Asia/Manila" },
        connectApi: async () => {},
      });
    },
    { product, session },
  );
  const dialog = () => page.getByRole("dialog");
  const snapshot = () =>
    page.evaluate(async () => {
      const { useAppStore } = await import("/src/lib/store.ts");
      return {
        stock: useAppStore.getState().products[0].currentStock,
        sales: useAppStore.getState().sales.length,
      };
    });
  async function save(buttonName) {
    await dialog().getByRole("button", { name: buttonName, exact: true }).click();
  }
  async function failed(buttonName) {
    await save(buttonName);
    await page.getByText("Failed to fetch", { exact: true }).last().waitFor();
    assert.equal(await dialog().isVisible(), true);
  }
  async function openSale(qty) {
    await page.getByRole("button", { name: "Record sale", exact: true }).first().click();
    await dialog().getByLabel("Quantity", { exact: true }).fill(String(qty));
  }
  async function openDelivery(qty) {
    await page.getByRole("button", { name: "Record delivery", exact: true }).click();
    await dialog().getByLabel("Quantity received").fill(String(qty));
  }

  await openSale(5);
  assert.equal(
    await dialog().getByLabel("Date", { exact: true }).getAttribute("max"),
    "2026-10-15",
  );
  await failed("Save sale");
  assert.equal(stock, 15);
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests[0].key, requests[1].key);
  assert.deepEqual(await snapshot(), { stock: 15, sales: 1 });
  console.log("Passed: lost sale response + unchanged retry saves one sale; 20 - 5 = 15.");

  await openSale(15);
  loseResponse = true;
  await failed("Save sale");
  await page.evaluate(
    async ({ sales: records, product: item }) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      useAppStore.setState({
        products: [{ ...item, currentStock: 0 }],
        sales: records.map((sale) => ({
          ...sale,
          date: sale.saleDate,
          qty: Number(sale.quantity),
        })),
      });
    },
    { sales, product },
  );
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests[2].key, requests[3].key);
  assert.deepEqual(await snapshot(), { stock: 0, sales: 2 });
  console.log("Passed: unchanged sale retry remains possible after refreshed stock reaches zero.");

  await openDelivery(5);
  loseResponse = true;
  await failed("Add to inventory");
  await page.clock.setFixedTime(new Date("2026-10-15T16:01:00Z"));
  await save("Add to inventory");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests[4].key, requests[5].key);
  assert.equal(stock, 5);
  assert.equal((await snapshot()).stock, 5);
  console.log("Passed: lost delivery response + unchanged retry across midnight adds stock once.");

  await openDelivery(1);
  loseResponse = true;
  await failed("Add to inventory");
  await dialog().getByLabel("Quantity received").fill("2");
  await save("Add to inventory");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(requests[6].key, requests[7].key);
  assert.notEqual(requests[5].key, requests[6].key);
  assert.equal(stock, 8);
  console.log("Passed: changed delivery and completed submissions receive new identifiers.");

  await openSale(1);
  loseResponse = true;
  await failed("Save sale");
  await dialog().getByLabel("Quantity", { exact: true }).fill("2");
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(requests[8].key, requests[9].key);
  assert.equal(stock, 5);
  console.log("Passed: changing a failed sale creates a new submission identifier.");

  const requestCount = requests.length;
  await openSale(1);
  await dialog().getByLabel("Date", { exact: true }).fill("2026-10-17");
  await save("Save sale");
  assert.equal(
    await dialog()
      .getByLabel("Date", { exact: true })
      .evaluate((input) => input.validity.rangeOverflow),
    true,
  );
  const futureChecks = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/lib/store.ts");
    const { businessDateISO } = await import("/src/lib/dates.ts");
    const state = useAppStore.getState();
    const errors = [];
    for (const mode of ["api", "browser-demo"]) {
      useAppStore.setState({ dataMode: mode });
      for (const write of [
        () => state.recordSale("synthetic-product", "2026-10-17", 1),
        () =>
          state.importSales([
            { id: "future", productId: "synthetic-product", date: "2026-10-17", qty: 1 },
          ]),
      ]) {
        try {
          await write();
        } catch (error) {
          errors.push(error.message);
        }
      }
    }
    useAppStore.setState({ dataMode: "api" });
    return {
      errors,
      manila: businessDateISO("Asia/Manila"),
      la: businessDateISO("America/Los_Angeles"),
    };
  });
  assert.equal(requests.length, requestCount);
  assert.equal(futureChecks.errors.length, 4);
  assert.ok(futureChecks.errors.every((error) => error.includes("future-dated")));
  assert.equal(futureChecks.manila, "2026-10-16");
  assert.equal(futureChecks.la, "2026-10-15");
  console.log(
    "Passed: picker/manual/import guards reject future sales using the saved business timezone.",
  );

  if (await dialog().count()) {
    await dialog().getByRole("button", { name: "Close", exact: true }).click();
  }
  await openSale(1);
  await dialog().getByLabel("Date", { exact: true }).fill("2026-10-16");
  loseResponse = true;
  await failed("Save sale");
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/lib/store.ts");
    useAppStore.setState({
      products: useAppStore.getState().products.map((item) => ({ ...item, currentStock: 4 })),
    });
  });
  failProductRead = true;
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests[10].key, requests[11].key);
  assert.equal(stock, 4);
  assert.equal((await snapshot()).stock, 4);
  assert.deepEqual(pageErrors, []);
  console.log(
    "Passed: product-only refresh + failed follow-up read never deducts a retried sale twice in the browser.",
  );
} finally {
  await browser?.close();
  await server.close();
}
