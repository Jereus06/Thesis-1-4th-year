import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real forms/store/API adapter; isolated browser and synthetic intercepted HTTP.
// PostgreSQL transaction behavior is checked separately by backend/tests.
process.env.VITE_DATA_MODE = "browser-demo";
process.env.VITE_API_URL = "/api/v1";
const server = await createServer({
  cacheDir: "benchmarks/transaction-retries/vite-cache",
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
let page;
let stock = 20;
let loseResponse = true;
let failProductRead = false;
let productReads = 0;
let loseCountResponse = false;
let loseProductResponse = false;
const saved = new Map();
const requests = [];
const sales = [];
const countRequests = [];
const savedCounts = new Map();
const countAudits = [];
const createRequests = [];
const savedCreates = new Map();
const createdProducts = new Map();
const openingAudits = [];
const metadataRequests = [];
let metadataHold = null;
let guardNewTransactions = false;
let loseBeforeCommit = false;
let forecastRevision = 0;
let restockAdvice = false;
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
let productDetails = { ...product };
const catalog = () => [
  { ...productDetails, currentStock: String(stock) },
  ...createdProducts.values(),
];
const fixtureProduct = (id) =>
  id === product.id ? { ...productDetails, currentStock: stock } : createdProducts.get(id);
const session = {
  userId: "synthetic-owner",
  businessId: "synthetic-business",
  role: "owner",
  email: "retry@example.test",
  displayName: "Synthetic owner",
};
try {
  await server.listen();
  for (const path of [
    "/src/routes/inventory.tsx?tsr-split=component",
    "/src/routes/restock.tsx?tsr-split=component",
  ]) {
    const response = await fetch(new URL(path, server.resolvedUrls.local[0]));
    assert.equal(response.status, 200, `Vite compiles ${path}`);
    await response.text();
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  await context.addInitScript(() => {
    localStorage.setItem(
      "stockcast-v5",
      JSON.stringify({ state: { products: [], sales: [], inventoryMovements: [] }, version: 5 }),
    );
  });
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-15T06:59:00Z"));
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
    if (request.method() === "POST" && path.endsWith("/products")) {
      const input = request.postDataJSON();
      const key = request.headers()["idempotency-key"];
      assert.ok(key, "product creation sends a submission identifier");
      assert.ok(input.sku, "blank SKU is resolved once before submitting");
      createRequests.push({ key, input });
      let result = savedCreates.get(key);
      if (result)
        assert.deepEqual(result.input, input, "a product retry keeps its complete payload");
      else {
        if (
          [...createdProducts.values()].some(
            (item) => item.sku.toLowerCase() === input.sku.toLowerCase(),
          )
        )
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Synthetic product SKU already exists" }),
          });
        const data = {
          ...input,
          id: `created-product-${savedCreates.size}`,
          currentStock: String(input.currentStock),
          isActive: true,
        };
        const audit = {
          id: `created-opening-${savedCreates.size}`,
          productId: data.id,
          movementDate: "2026-10-15",
          movementType: "opening_balance",
          quantityDelta: String(input.currentStock),
          balanceAfter: String(input.currentStock),
          note: "Initial product balance",
          dataOrigin: "demo",
          saleId: null,
          recordedBy: session.userId,
        };
        createdProducts.set(data.id, data);
        openingAudits.push(audit);
        result = { input, data, audit };
        savedCreates.set(key, result);
      }
      if (loseProductResponse) {
        loseProductResponse = false;
        return route.abort("connectionfailed");
      }
      return json(result.data);
    }
    if (request.method() === "PATCH" && path.endsWith(`/products/${product.id}`)) {
      const input = request.postDataJSON();
      if (!Object.hasOwn(input, "currentStock")) {
        metadataRequests.push(input);
        productDetails = { ...productDetails, ...input };
        const result = { ...productDetails, currentStock: String(stock) };
        const hold = metadataHold;
        if (hold) {
          hold.captured(result);
          await hold.releasePromise;
        }
        try {
          return await json(result);
        } finally {
          hold?.finished();
        }
      }
      const key = request.headers()["idempotency-key"];
      assert.ok(key, "stock-count corrections send a submission identifier");
      assert.deepEqual(Object.keys(input), ["currentStock"]);
      countRequests.push({ key, input });
      let result = savedCounts.get(key);
      if (result) assert.deepEqual(result.input, input, "a stock-count retry keeps its payload");
      else {
        const previousStock = stock;
        stock = Number(input.currentStock);
        const audit = {
          id: `count-adjustment-${savedCounts.size}`,
          productId: product.id,
          movementDate: "2026-10-15",
          movementType: "adjustment",
          quantityDelta: String(stock - previousStock),
          balanceAfter: String(stock),
          note: "Catalog stock count adjustment",
          dataOrigin: "demo",
          saleId: null,
          recordedBy: session.userId,
        };
        countAudits.push(audit);
        result = { input, data: { ...product, ...input, currentStock: String(stock) }, audit };
        savedCounts.set(key, result);
      }
      if (loseCountResponse) {
        loseCountResponse = false;
        return route.abort("connectionfailed");
      }
      return json(result.data);
    }
    if (request.method() === "POST" && /\/(sales|inventory-movements)$/.test(path)) {
      const input = request.postDataJSON();
      const key = request.headers()["idempotency-key"];
      assert.ok(key);
      requests.push({ path, key, input });
      let result = saved.get(key);
      if (result) assert.deepEqual(result.input, input, "a retry keeps the complete saved payload");
      else {
        const isSale = path.endsWith("/sales");
        if (loseBeforeCommit) {
          loseBeforeCommit = false;
          return route.abort("connectionfailed");
        }
        const selected = fixtureProduct(input.productId);
        if (guardNewTransactions) {
          let detail;
          if (!selected || selected.isActive === false)
            detail = "Synthetic backend rejected an inactive product.";
          const today = await page.evaluate(async () => {
            const { useAppStore } = await import("/src/lib/store.ts");
            const { businessDateISO } = await import("/src/lib/dates.ts");
            return businessDateISO(useAppStore.getState().settings.timezone);
          });
          if ((isSale ? input.saleDate : input.movementDate) > today)
            detail = "Synthetic backend rejected a future date.";
          if (detail)
            return route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ detail }),
            });
        }
        const nextStock =
          Number(selected.currentStock) +
          (isSale ? -Number(input.quantity) : Number(input.quantityDelta));
        if (input.productId === product.id) stock = nextStock;
        else createdProducts.set(input.productId, { ...selected, currentStock: String(nextStock) });
        const data = isSale
          ? { id: `sale-${saved.size}`, ...input, source: "manual" }
          : {
              id: `movement-${saved.size}`,
              ...input,
              balanceAfter: String(nextStock),
              dataOrigin: "demo",
              note: input.note ?? null,
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
      productReads++;
      if (failProductRead)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Synthetic stock read failed" }),
        });
      return json(catalog());
    }
    if (path.endsWith("/inventory-movements"))
      return json(
        [...saved.values()]
          .map((entry) => entry.data)
          .filter((entry) => entry.movementType)
          .concat(countAudits, openingAudits),
      );
    if (path.endsWith("/sales")) return json(sales);
    // Forecast polling is tested separately. Keep this fixture stable while each
    // transaction case controls exactly when its current-stock read happens.
    if (path.endsWith("/forecast-status"))
      return json({ revision: `transaction-fixture-${forecastRevision}` });
    if (path.endsWith("/forecast-dashboard")) {
      const current = await page.evaluate(async () => {
        const { useAppStore } = await import("/src/lib/store.ts");
        return useAppStore.getState().settings;
      });
      return json({
        run: restockAdvice
          ? {
              id: "synthetic-restock-run",
              status: "completed",
              createdAt: "2026-10-15T00:00:00Z",
              forecastHorizonDays: 30,
              dataSnapshot: { settings: { moving_average_window: current.maWindow } },
              configuration: {},
              timing: {},
            }
          : null,
        latestRun: null,
        asOf: "2026-10-15T00:00:00Z",
        businessDay: "2026-10-15",
        businessTimezone: "Asia/Manila",
        stale: false,
        expired: false,
        forecastThrough: "2026-11-18",
        summaries: restockAdvice
          ? {
              [product.id]: {
                historyDays: 180,
                nonzeroDays: 160,
                eligible: false,
                operatingMethod: "fallback",
                unknownDays: 0,
                excludedDays: 0,
                qualityWarnings: [],
              },
            }
          : {},
        predictions: restockAdvice
          ? [
              {
                productId: product.id,
                predictionDate: "2026-10-17",
                datasetSplit: "future",
                method: "fallback",
                predictedQuantity: "2",
                actualQuantity: null,
                lowerBound: null,
                upperBound: null,
              },
            ]
          : [],
        metrics: [],
        recommendations: restockAdvice
          ? [
              {
                productId: product.id,
                method: "fallback",
                confidenceLevel: "low",
                demandAvailable: true,
                forecastExpired: false,
                daily_demand: "2",
                demand_during_lead_time: "4",
                reorder_point: "4",
                target_stock: "18",
                suggested_quantity: "0",
                days_of_cover: String(stock / 2),
                status: "healthy",
              },
            ]
          : [],
        sharedState: {
          products: catalog(),
          settings: {
            businessId: session.businessId,
            businessName: current.storeName,
            businessLocation: current.storeLocation,
            dataOrigin: "demo",
            movingAverageWindow: current.maWindow,
            forecastHorizonDays: current.forecastHorizon,
            targetCoverDays: current.coverDays,
            minimumHistoryWeeks: current.minWeeks,
            minimumNonzeroDays: current.minimumNonzeroDays,
            topNProducts: current.topNProducts,
            cvFolds: current.cvFolds,
            timezone: current.timezone,
          },
        },
      });
    }
    throw new Error(`Unexpected test request: ${request.method()} ${path}`);
  });
  const base = server.resolvedUrls.local[0];
  await page.goto(`${base}inventory`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page
    .getByRole("tab", { name: "Products", exact: true })
    .waitFor({ timeout: 120_000 })
    .catch((error) => {
      assert.deepEqual(pageErrors, [], "the application starts without browser errors");
      throw error;
    });
  const initialDashboard = page.waitForResponse((response) =>
    response.url().endsWith("/forecast-dashboard"),
  );
  assert.equal(
    await page.evaluate(
      async () => (await import("/src/lib/store.ts")).useAppStore.getState().products.length,
    ),
    0,
    "the sale form mounts before the synthetic catalog arrives",
  );
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
  await initialDashboard;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
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
  async function openCount(quantity) {
    await page.getByRole("tab", { name: "Products", exact: true }).click();
    await page.getByRole("button", { name: "Correct stock count", exact: true }).click();
    await dialog()
      .getByLabel("Verified on-hand count (piece)", { exact: true })
      .fill(String(quantity));
  }
  async function openProduct(name, sku = "") {
    await page.getByRole("tab", { name: "Products", exact: true }).click();
    await page.getByRole("button", { name: "Add product", exact: true }).click();
    await dialog().getByLabel("SKU (optional)", { exact: true }).fill(sku);
    await dialog().getByLabel("Name", { exact: true }).fill(name);
    await dialog().getByLabel("Category", { exact: true }).fill("Synthetic create retry");
    await dialog().getByLabel("Unit", { exact: true }).fill("piece");
    await dialog().getByLabel("Opening stock", { exact: true }).fill("20");
    await dialog().getByLabel("Lead time (days)", { exact: true }).fill("2");
    await dialog().getByLabel("Safety stock", { exact: true }).fill("0");
    await dialog().getByLabel("Unit cost (PHP)", { exact: true }).fill("1");
  }
  async function productSnapshot(productId) {
    return page.evaluate(async (id) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      return useAppStore.getState().products.filter((item) => item.id === id);
    }, productId);
  }
  async function setProductActive(productId, isActive) {
    if (productId === product.id) productDetails = { ...productDetails, isActive };
    else createdProducts.set(productId, { ...createdProducts.get(productId), isActive });
    await page.evaluate(
      async ({ productId: id, isActive: active }) => {
        const { useAppStore } = await import("/src/lib/store.ts");
        useAppStore.setState({
          products: useAppStore
            .getState()
            .products.map((item) => (item.id === id ? { ...item, isActive: active } : item)),
        });
      },
      { productId, isActive },
    );
  }
  async function setTimezone(timezone) {
    await page.evaluate(async (zone) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, timezone: zone } });
    }, timezone);
  }
  async function openBaseSale(quantity, date = "2026-10-15") {
    await openSale(quantity);
    await dialog().getByLabel("Product", { exact: true }).selectOption(product.id);
    await dialog().getByLabel("Date", { exact: true }).fill(date);
  }
  async function openBaseDelivery(quantity) {
    if (!page.url().endsWith("/inventory"))
      await page.getByRole("link", { name: "Inventory", exact: true }).click();
    await page.getByRole("tab", { name: "Products", exact: true }).click();
    await page.getByRole("button", { name: "Record delivery", exact: true }).first().click();
    await dialog().getByLabel("Quantity received", { exact: true }).fill(String(quantity));
  }
  async function openBaseMovement(movementType, quantity) {
    await page.getByRole("tab", { name: "Stock movements", exact: true }).click();
    const writeOff = movementType === "write_off";
    await page
      .getByRole("button", { name: writeOff ? "Write off stock" : "Record return", exact: true })
      .click();
    await dialog().getByLabel("Active product", { exact: true }).selectOption(product.id);
    await dialog()
      .getByLabel(writeOff ? "Quantity to write off" : "Quantity returned")
      .fill(String(quantity));
    if (writeOff)
      await dialog().getByLabel("Reason for write-off").fill("Synthetic inactive retry");
  }
  async function submitHandler() {
    await dialog()
      .locator("form")
      .evaluate((form) =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
  }
  async function setCatalogStock(quantity) {
    stock = quantity;
    await page.evaluate(async (currentStock) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      useAppStore.setState({
        products: useAppStore.getState().products.map((item) => ({ ...item, currentStock })),
      });
    }, quantity);
  }
  async function refreshMovements() {
    await page.evaluate(async () => {
      const { useAppStore } = await import("/src/lib/store.ts");
      await useAppStore.getState().refreshInventoryMovements();
    });
  }
  async function movementSnapshot(movementId) {
    return page.evaluate(async (id) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      const state = useAppStore.getState();
      return {
        stock: state.products[0].currentStock,
        matchingAudits: state.inventoryMovements.filter((movement) => movement.id === id),
        error: state.movementsError,
      };
    }, movementId);
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
  assert.equal(requests[4].input.movementDate, "2026-10-15");
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

  for (const { readFails, refreshBeforeRetry } of [
    { readFails: false, refreshBeforeRetry: true },
    { readFails: true, refreshBeforeRetry: true },
    { readFails: false, refreshBeforeRetry: false },
  ]) {
    failProductRead = false;
    await setCatalogStock(20);
    await openDelivery(10);
    loseResponse = true;
    await failed("Add to inventory");
    const originalRequest = requests.at(-1);
    const originalResult = saved.get(originalRequest.key).data;
    assert.equal(stock, 30);
    assert.equal(originalResult.balanceAfter, "30");
    // Another committed sale changes today's stock, while the movement keeps its saved balance.
    stock = 25;
    if (refreshBeforeRetry) await refreshMovements();
    assert.equal((await snapshot()).stock, refreshBeforeRetry ? 25 : 20);
    failProductRead = readFails;
    const readsBeforeRetry = productReads;
    await save("Add to inventory");
    await dialog().waitFor({ state: "hidden" });
    assert.equal(requests.at(-1).key, originalRequest.key);
    assert.deepEqual(requests.at(-1).input, originalRequest.input);
    assert.ok(productReads > readsBeforeRetry, "a confirmed movement refreshes current products");
    assert.equal(stock, 25);
    const result = await movementSnapshot(originalResult.id);
    assert.equal(result.stock, 25);
    assert.equal(result.matchingAudits.length, 1);
    assert.equal(result.matchingAudits[0].balanceAfter, 30);
    if (readFails) assert.match(result.error, /saved.*[Rr]efresh/);
    else assert.equal(result.error, null);
    console.log(
      `Passed: delivery replay preserves current stock 25 and one historical balance 30${!refreshBeforeRetry ? " without a prior catalog refresh" : readFails ? " when its follow-up product read fails" : " after an intervening sale"}.`,
    );
  }

  failProductRead = false;
  await setCatalogStock(5);
  await page.getByRole("tab", { name: "Stock movements", exact: true }).click();
  await page.getByRole("button", { name: "Write off stock", exact: true }).click();
  await dialog().getByLabel("Quantity to write off").fill("5");
  await dialog().getByLabel("Reason for write-off").fill("Synthetic damaged stock");
  loseResponse = true;
  await failed("Save write-off");
  const originalWriteOff = requests.at(-1);
  const writeOffResult = saved.get(originalWriteOff.key).data;
  assert.equal(stock, 0);
  await refreshMovements();
  assert.equal((await snapshot()).stock, 0);
  assert.equal(await dialog().getByLabel("Quantity to write off").getAttribute("max"), null);
  assert.equal(
    await dialog()
      .getByLabel("Quantity to write off")
      .evaluate((input) => input.validity.rangeOverflow),
    false,
  );
  await dialog()
    .getByText("Retrying checks whether this movement was saved and refreshes current stock.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await dialog()
      .getByText(/After write-off:/)
      .count(),
    0,
  );
  await save("Save write-off");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests.at(-1).key, originalWriteOff.key);
  assert.deepEqual(requests.at(-1).input, originalWriteOff.input);
  const confirmedWriteOff = await movementSnapshot(writeOffResult.id);
  assert.equal(confirmedWriteOff.stock, 0);
  assert.equal(confirmedWriteOff.matchingAudits.length, 1);
  assert.equal(confirmedWriteOff.matchingAudits[0].note, "Synthetic damaged stock");
  console.log(
    "Passed: unchanged write-off retry submits at refreshed zero stock and confirms one audit.",
  );

  await setCatalogStock(5);
  await page.getByRole("tab", { name: "Stock movements", exact: true }).click();
  await page.getByRole("button", { name: "Write off stock", exact: true }).click();
  await dialog().getByLabel("Quantity to write off").fill("5");
  await dialog().getByLabel("Reason for write-off").fill("Synthetic original reason");
  loseResponse = true;
  await failed("Save write-off");
  const beforeWriteOffEdit = requests.at(-1);
  await refreshMovements();
  const beforeBlockedEditCount = requests.length;
  await dialog().getByLabel("Reason for write-off").fill("Synthetic revised reason");
  assert.equal(await dialog().getByLabel("Quantity to write off").getAttribute("max"), "0");
  await save("Save write-off");
  assert.equal(
    await dialog()
      .getByLabel("Quantity to write off")
      .evaluate((input) => input.validity.rangeOverflow),
    true,
  );
  assert.equal(
    requests.length,
    beforeBlockedEditCount,
    "changed fields retain normal stock validation",
  );
  // A later delivery supplies stock for this changed, intentional new movement.
  await setCatalogStock(3);
  await dialog().getByLabel("Quantity to write off").fill("2");
  assert.equal(await dialog().getByLabel("Quantity to write off").getAttribute("max"), "3");
  await save("Save write-off");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(requests.at(-1).key, beforeWriteOffEdit.key);
  assert.equal(requests.at(-1).input.quantityDelta, "-2");
  assert.equal(requests.at(-1).input.note, "Synthetic revised reason");
  assert.equal(stock, 1);
  assert.equal((await snapshot()).stock, 1);
  assert.deepEqual(pageErrors, []);
  console.log(
    "Passed: changed write-off fields restore the stock limit and use a new identifier when valid.",
  );

  await setCatalogStock(10);
  await page.clock.setFixedTime(new Date("2026-10-15T16:01:00Z"));
  const timezoneDates = await page.evaluate(async () => {
    const { businessDateISO, todayISO } = await import("/src/lib/dates.ts");
    return { browser: todayISO(), business: businessDateISO("Asia/Manila") };
  });
  assert.deepEqual(timezoneDates, { browser: "2026-10-15", business: "2026-10-16" });
  for (const movementType of ["return", "write_off"]) {
    const isWriteOff = movementType === "write_off";
    const quantity = isWriteOff ? 3 : 2;
    const saveLabel = isWriteOff ? "Save write-off" : "Save return";
    await page
      .getByRole("button", { name: isWriteOff ? "Write off stock" : "Record return", exact: true })
      .click();
    await dialog()
      .getByLabel(isWriteOff ? "Quantity to write off" : "Quantity returned")
      .fill(String(quantity));
    if (isWriteOff)
      await dialog().getByLabel("Reason for write-off").fill("Synthetic backdated write-off");
    const movementDate = dialog().getByLabel("Movement date", { exact: true });
    assert.equal(await movementDate.inputValue(), "2026-10-16");
    assert.equal(await movementDate.getAttribute("max"), "2026-10-16");
    assert.equal(await movementDate.evaluate((input) => input.checkValidity()), true);
    const requestsBeforeFuture = requests.length;
    const stockBeforeFuture = stock;
    await movementDate.fill("2026-10-17");
    await save(saveLabel);
    assert.equal(await movementDate.evaluate((input) => input.validity.rangeOverflow), true);
    assert.equal(requests.length, requestsBeforeFuture);
    // Exercise the actual submit handler as well as the browser's date upper bound.
    await dialog()
      .locator("form")
      .evaluate((form) =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    await dialog().getByRole("alert").waitFor();
    assert.match(await dialog().getByRole("alert").innerText(), /future/i);
    assert.equal(requests.length, requestsBeforeFuture);
    assert.equal(stock, stockBeforeFuture);
    console.log(
      `Passed: ${movementType} tomorrow is rejected before POST by picker and handler using business day 16 while the browser is on day 15.`,
    );

    await movementDate.fill("2026-10-14");
    await save(saveLabel);
    await dialog().waitFor({ state: "hidden" });
    assert.equal(requests.length, requestsBeforeFuture + 1);
    const backdatedRequest = requests.at(-1);
    assert.equal(backdatedRequest.input.movementDate, "2026-10-14");
    assert.equal(backdatedRequest.input.movementType, movementType);
    const backdatedMovement = saved.get(backdatedRequest.key).data;
    const result = await movementSnapshot(backdatedMovement.id);
    const expectedStock = stockBeforeFuture + (isWriteOff ? -quantity : quantity);
    assert.equal(stock, expectedStock);
    assert.equal(result.stock, expectedStock);
    assert.equal(result.matchingAudits.length, 1);
    assert.equal(result.matchingAudits[0].movementDate, "2026-10-14");
    console.log(`Passed: past-dated ${movementType} still saves once and updates current stock.`);
  }

  const requestsBeforeStoreDateChecks = requests.length;
  const savedBeforeStoreDateChecks = saved.size;
  const futureMovementChecks = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/lib/store.ts");
    const before = useAppStore.getState();
    const originalMode = before.dataMode;
    const originalStock = before.products[0].currentStock;
    const originalAudits = before.inventoryMovements.length;
    const errors = [];
    try {
      for (const mode of ["api", "browser-demo"]) {
        useAppStore.setState({ dataMode: mode });
        for (const movementType of ["return", "write_off"]) {
          try {
            await useAppStore.getState().recordStockMovement({
              productId: "synthetic-product",
              movementDate: "2026-10-17",
              movementType,
              quantityDelta: movementType === "write_off" ? -1 : 1,
              note: "Synthetic future-date guard",
              idempotencyKey: crypto.randomUUID(),
            });
          } catch (error) {
            errors.push(error.message);
          }
        }
      }
      return {
        errors,
        stockUnchanged: useAppStore.getState().products[0].currentStock === originalStock,
        auditsUnchanged: useAppStore.getState().inventoryMovements.length === originalAudits,
      };
    } finally {
      useAppStore.setState({ dataMode: originalMode });
    }
  });
  assert.equal(futureMovementChecks.errors.length, 4);
  assert.ok(futureMovementChecks.errors.every((message) => /future/i.test(message)));
  assert.equal(futureMovementChecks.stockUnchanged, true);
  assert.equal(futureMovementChecks.auditsUnchanged, true);
  assert.equal(requests.length, requestsBeforeStoreDateChecks);
  assert.equal(saved.size, savedBeforeStoreDateChecks);
  assert.deepEqual(pageErrors, []);
  console.log(
    "Passed: direct API/demo store calls reject future returns and write-offs without writes.",
  );

  await setCatalogStock(5);
  await page.getByRole("tab", { name: "Stock movements", exact: true }).click();
  await page.getByRole("button", { name: "Write off stock", exact: true }).click();
  await dialog().getByLabel("Quantity to write off").fill("5");
  await dialog().getByLabel("Reason for write-off").fill("Synthetic timezone retry");
  assert.equal(await dialog().getByLabel("Movement date").inputValue(), "2026-10-16");
  loseResponse = true;
  await failed("Save write-off");
  const beforeTimezoneChange = requests.at(-1);
  const timezoneWriteOff = saved.get(beforeTimezoneChange.key).data;
  assert.equal(stock, 0);
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/lib/store.ts");
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, timezone: "America/Los_Angeles" },
    });
  });
  await refreshMovements();
  const retryDate = dialog().getByLabel("Movement date");
  assert.equal((await snapshot()).stock, 0);
  assert.equal(await retryDate.getAttribute("max"), null);
  assert.equal(await dialog().getByLabel("Quantity to write off").getAttribute("max"), null);

  const beforeEditedFutureRetryCount = requests.length;
  await dialog().getByLabel("Reason for write-off").fill("Synthetic edited timezone retry");
  assert.equal(await retryDate.getAttribute("max"), "2026-10-15");
  await save("Save write-off");
  assert.equal(await retryDate.evaluate((input) => input.validity.rangeOverflow), true);
  await dialog()
    .locator("form")
    .evaluate((form) =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  await dialog().getByRole("alert").waitFor();
  assert.match(await dialog().getByRole("alert").innerText(), /future/i);
  assert.equal(requests.length, beforeEditedFutureRetryCount);

  await dialog().getByLabel("Reason for write-off").fill("Synthetic timezone retry");
  assert.equal(await retryDate.getAttribute("max"), null);
  await save("Save write-off");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests.at(-1).key, beforeTimezoneChange.key);
  assert.deepEqual(requests.at(-1).input, beforeTimezoneChange.input);
  const timezoneReplay = await movementSnapshot(timezoneWriteOff.id);
  assert.equal(timezoneReplay.stock, 0);
  assert.equal(timezoneReplay.matchingAudits.length, 1);
  assert.equal(stock, 0);
  assert.deepEqual(pageErrors, []);
  console.log(
    "Passed: exact write-off retry confirms a saved result after timezone change makes its date future; edited fields remain blocked.",
  );

  for (const { refreshBeforeRetry, interveningSale } of [
    { refreshBeforeRetry: true, interveningSale: true },
    { refreshBeforeRetry: false, interveningSale: true },
    { refreshBeforeRetry: true, interveningSale: false },
  ]) {
    await setCatalogStock(20);
    await openCount(8);
    const auditsBeforeCount = countAudits.length;
    loseCountResponse = true;
    await failed("Save count correction");
    const originalRequest = countRequests.at(-1);
    const originalResult = savedCounts.get(originalRequest.key);
    assert.equal(stock, 8);
    assert.equal(originalResult.data.currentStock, "8");
    if (interveningSale) stock = 7;
    if (refreshBeforeRetry) await refreshMovements();
    assert.equal((await snapshot()).stock, refreshBeforeRetry ? stock : 20);
    const readsBeforeRetry = productReads;
    await save("Save count correction");
    await dialog().waitFor({ state: "hidden" });
    assert.equal(countRequests.at(-1).key, originalRequest.key);
    assert.deepEqual(countRequests.at(-1).input, originalRequest.input);
    assert.ok(productReads > readsBeforeRetry, "a confirmed count refreshes current products");
    assert.equal(stock, interveningSale ? 7 : 8);
    assert.equal((await snapshot()).stock, stock);
    assert.equal(countAudits.length, auditsBeforeCount + 1);
    await refreshMovements();
    const result = await movementSnapshot(originalResult.audit.id);
    assert.equal(result.matchingAudits.length, 1);
    assert.equal(result.matchingAudits[0].quantityDelta, -12);
    assert.equal(result.matchingAudits[0].balanceAfter, 8);
    console.log(
      `Passed: lost stock-count response retries the same submission once${interveningSale ? ` and preserves sale balance7${refreshBeforeRetry ? " after catalog refresh" : " without a prior refresh"}` : " even when refreshed stock already equals the submitted count"}.`,
    );
  }

  await setCatalogStock(20);
  await openCount(8);
  failProductRead = true;
  await save("Save count correction");
  await dialog().waitFor({ state: "hidden" });
  const acknowledgedCount = countRequests.at(-1);
  assert.equal(stock, 8);
  assert.equal((await snapshot()).stock, 20);
  const savedCountNotice = await movementSnapshot("no-count-audit");
  assert.match(savedCountNotice.error, /Stock count saved.*Refresh stock movements/);
  await page
    .getByText("Stock count saved. Refresh stock movements to verify the latest balances.", {
      exact: true,
    })
    .waitFor();
  failProductRead = false;
  stock = 7;
  await refreshMovements();
  await openCount(8);
  await save("Save count correction");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(countRequests.at(-1).key, acknowledgedCount.key);
  assert.equal(stock, 8);
  assert.equal((await snapshot()).stock, 8);
  console.log(
    "Passed: confirmed stock count remains successful after a failed product read; a later intentional count uses a new identifier.",
  );

  await setCatalogStock(20);
  await openCount(8);
  loseCountResponse = true;
  await failed("Save count correction");
  const beforeCountEdit = countRequests.at(-1);
  await dialog().getByLabel("Verified on-hand count (piece)", { exact: true }).fill("9");
  await save("Save count correction");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(countRequests.at(-1).key, beforeCountEdit.key);
  assert.equal(Number(countRequests.at(-1).input.currentStock), 9);
  assert.equal(stock, 9);
  assert.equal((await snapshot()).stock, 9);
  assert.deepEqual(pageErrors, []);
  console.log(
    "Passed: editing a failed stock-count submission starts a new identifier and saves the changed verified balance.",
  );

  for (const { refreshBeforeRetry, sku } of [
    { refreshBeforeRetry: false, sku: "" },
    { refreshBeforeRetry: true, sku: "" },
    { refreshBeforeRetry: true, sku: "SYNTHETIC-EXPLICIT-CREATE" },
  ]) {
    const serverCountBefore = createdProducts.size;
    const auditsBefore = openingAudits.length;
    await openProduct(`Synthetic creation retry ${serverCountBefore}`, sku);
    loseProductResponse = true;
    await failed("Add to catalog");
    const originalRequest = createRequests.at(-1);
    const originalResult = savedCreates.get(originalRequest.key);
    assert.equal(Number(originalRequest.input.currentStock), 20);
    assert.equal(originalResult.data.currentStock, "20");
    if (sku) assert.equal(originalRequest.input.sku, sku);
    // An intervening committed sale must survive replay of the saved opening stock.
    createdProducts.set(originalResult.data.id, {
      ...createdProducts.get(originalResult.data.id),
      currentStock: "15",
    });
    if (refreshBeforeRetry) await refreshMovements();
    assert.equal(
      (await productSnapshot(originalResult.data.id)).length,
      refreshBeforeRetry ? 1 : 0,
    );
    const readsBeforeRetry = productReads;
    await save("Add to catalog");
    await dialog().waitFor({ state: "hidden" });
    assert.equal(createRequests.at(-1).key, originalRequest.key);
    assert.deepEqual(createRequests.at(-1).input, originalRequest.input);
    assert.ok(productReads > readsBeforeRetry, "a confirmed creation reads the current catalog");
    assert.equal(createdProducts.size, serverCountBefore + 1);
    assert.equal(openingAudits.length, auditsBefore + 1);
    const catalogRows = await productSnapshot(originalResult.data.id);
    assert.equal(catalogRows.length, 1);
    assert.equal(catalogRows[0].currentStock, 15);
    await refreshMovements();
    const audit = await movementSnapshot(originalResult.audit.id);
    assert.equal(audit.matchingAudits.length, 1);
    assert.equal(audit.matchingAudits[0].balanceAfter, 20);
    console.log(
      `Passed: ${sku ? "explicit" : "generated"} SKU product retry retains key/body, one product/opening audit and currentstock15${refreshBeforeRetry ? " after the catalog already loaded it" : " without a prior catalog refresh"}.`,
    );
  }

  await openProduct("Synthetic edited creation original");
  loseProductResponse = true;
  await failed("Add to catalog");
  const beforeProductEdit = createRequests.at(-1);
  const firstEditedResult = savedCreates.get(beforeProductEdit.key);
  await dialog().getByLabel("Name", { exact: true }).fill("Synthetic edited creation changed");
  await save("Add to catalog");
  await dialog().waitFor({ state: "hidden" });
  const afterProductEdit = createRequests.at(-1);
  assert.notEqual(afterProductEdit.key, beforeProductEdit.key);
  assert.notEqual(afterProductEdit.input.sku, beforeProductEdit.input.sku);
  const secondEditedResult = savedCreates.get(afterProductEdit.key);
  assert.equal((await productSnapshot(firstEditedResult.data.id)).length, 1);
  assert.equal((await productSnapshot(secondEditedResult.data.id)).length, 1);
  assert.equal(secondEditedResult.data.name, "Synthetic edited creation changed");
  console.log(
    "Passed: edited failed blank-SKU creation uses a fresh key and generated SKU even under a fixed clock.",
  );

  await openProduct("Synthetic acknowledged creation with failed read");
  failProductRead = true;
  await save("Add to catalog");
  await dialog().waitFor({ state: "hidden" });
  const acknowledgedCreation = createRequests.at(-1);
  const acknowledgedResult = savedCreates.get(acknowledgedCreation.key);
  assert.equal((await productSnapshot(acknowledgedResult.data.id)).length, 0);
  const creationNotice = "Product saved. Refresh stock movements to load the latest catalog.";
  const savedCreationNotice = await movementSnapshot("no-creation-audit");
  assert.equal(savedCreationNotice.error, creationNotice);
  await page.getByText(creationNotice, { exact: true }).waitFor();
  failProductRead = false;
  await refreshMovements();
  assert.equal((await productSnapshot(acknowledgedResult.data.id)).length, 1);
  await openProduct("Synthetic intentional creation after success");
  await save("Add to catalog");
  await dialog().waitFor({ state: "hidden" });
  const intentionalCreation = createRequests.at(-1);
  assert.notEqual(intentionalCreation.key, acknowledgedCreation.key);
  assert.notEqual(intentionalCreation.input.sku, acknowledgedCreation.input.sku);
  assert.equal(
    (await productSnapshot(savedCreates.get(intentionalCreation.key).data.id)).length,
    1,
  );
  assert.deepEqual(pageErrors, []);
  console.log(
    "Passed: acknowledged product creation stays successful after a failed catalog read, shows a notice and gives the next intentional creation a new key/SKU.",
  );

  for (const failedRead of [false, true]) {
    await setCatalogStock(20);
    await page.getByRole("tab", { name: "Products", exact: true }).click();
    await page.getByRole("button", { name: "Edit details", exact: true }).first().click();
    const revisedName = `Synthetic metadata race ${failedRead ? "failed" : "successful"} read`;
    await dialog().getByLabel("Name", { exact: true }).fill(revisedName);
    let capture;
    let release;
    let finish;
    const captured = new Promise((resolve) => {
      capture = resolve;
    });
    const releasePromise = new Promise((resolve) => {
      release = resolve;
    });
    const finished = new Promise((resolve) => {
      finish = resolve;
    });
    metadataHold = { captured: capture, releasePromise, release, finished: finish };
    const pendingPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/products/${product.id}`),
    );
    await save("Save details");
    const olderResponse = await captured;
    assert.equal(olderResponse.currentStock, "20");
    assert.equal(metadataRequests.at(-1).name, revisedName);
    assert.equal(Object.hasOwn(metadataRequests.at(-1), "currentStock"), false);
    // Another signed-in operation can complete while this form's response is delayed.
    // Use the real store/API receipt path to ingest its canonical balance.
    await page.evaluate(async (id) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      await useAppStore
        .getState()
        .receiveStock(id, 10, { movementDate: "2026-10-15", idempotencyKey: crypto.randomUUID() });
    }, product.id);
    assert.equal(stock, 30);
    assert.equal((await snapshot()).stock, 30);
    const readsBeforePatchAck = productReads;
    failProductRead = failedRead;
    release();
    const patchResponse = await pendingPatch;
    assert.equal((await patchResponse.json()).data.currentStock, "20");
    await finished;
    metadataHold = null;
    await dialog().waitFor({ state: "hidden" });
    assert.ok(
      productReads > readsBeforePatchAck,
      "an acknowledged details edit reads current products",
    );
    assert.equal((await snapshot()).stock, 30);
    assert.equal((await productSnapshot(product.id))[0].name, revisedName);
    if (failedRead) {
      const notice = "Product saved. Refresh stock movements to load the latest catalog.";
      assert.equal((await movementSnapshot("no-metadata-audit")).error, notice);
      await page.getByText(notice, { exact: true }).waitFor();
    }
    failProductRead = false;
    assert.deepEqual(pageErrors, []);
    console.log(
      `Passed: actual details form ACK with historical stock20 preserves an intervening receipt's stock30${failedRead ? " when the current-catalog read fails, with a visible saved notice" : " and refreshes the current catalog"}.`,
    );
  }

  guardNewTransactions = true;
  const alternateId = [...createdProducts.keys()][0];
  assert.ok(alternateId, "a second active product is available for selection regressions");
  await setTimezone("America/Los_Angeles");
  await setProductActive(product.id, true);
  await setCatalogStock(20);
  await openSale(5);
  await dialog().getByLabel("Date", { exact: true }).fill("2026-10-15");
  loseResponse = true;
  await failed("Save sale");
  const inactiveSale = requests.at(-1);
  const savedInactiveSale = saved.get(inactiveSale.key).data;
  await setProductActive(product.id, false);
  await refreshMovements();
  assert.equal(await dialog().getByLabel("Product", { exact: true }).inputValue(), product.id);
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests.at(-1).key, inactiveSale.key);
  assert.deepEqual(requests.at(-1).input, inactiveSale.input);
  assert.equal(requests.at(-1).input.productId, product.id);
  assert.equal((await snapshot()).stock, 15);
  assert.equal(sales.filter((sale) => sale.id === savedInactiveSale.id).length, 1);
  console.log(
    "Passed: lost sale A retries the same body/key after A becomes inactive while B stays active; selection never silently switches to B.",
  );

  await setProductActive(product.id, true);
  await setCatalogStock(20);
  await openBaseSale(5);
  loseResponse = true;
  await failed("Save sale");
  const saleBeforeInactiveEdit = requests.at(-1);
  await setProductActive(product.id, false);
  await dialog().getByLabel("Quantity", { exact: true }).fill("4");
  const beforeBlockedSaleEdit = requests.length;
  assert.equal(await dialog().getByLabel("Product", { exact: true }).inputValue(), product.id);
  await submitHandler();
  assert.equal(requests.length, beforeBlockedSaleEdit);
  await dialog().getByLabel("Product", { exact: true }).selectOption(alternateId);
  await dialog().getByLabel("Quantity", { exact: true }).fill("2");
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(requests.at(-1).key, saleBeforeInactiveEdit.key);
  assert.equal(requests.at(-1).input.productId, alternateId);
  assert.equal(Number(requests.at(-1).input.quantity), 2);
  console.log(
    "Passed: editing a failed sale for inactive A is blocked; explicitly choosing active B starts a new submission.",
  );

  await setProductActive(product.id, true);
  await setCatalogStock(20);
  await openBaseDelivery(10);
  loseResponse = true;
  await failed("Add to inventory");
  const inactiveReceipt = requests.at(-1);
  const inactiveReceiptResult = saved.get(inactiveReceipt.key).data;
  await setProductActive(product.id, false);
  await refreshMovements();
  assert.equal(await dialog().getByLabel("Quantity received").inputValue(), "10");
  await save("Add to inventory");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests.at(-1).key, inactiveReceipt.key);
  assert.deepEqual(requests.at(-1).input, inactiveReceipt.input);
  assert.equal((await snapshot()).stock, 30);
  assert.equal((await movementSnapshot(inactiveReceiptResult.id)).matchingAudits.length, 1);
  console.log(
    "Passed: Inventory keeps a failed delivery form mounted after its product is inactive and confirms the original receipt once.",
  );

  await setProductActive(product.id, true);
  await setCatalogStock(20);
  restockAdvice = true;
  forecastRevision++;
  await page.getByRole("link", { name: "Restock", exact: true }).click();
  await page.getByRole("heading", { name: "Restocking recommendations", exact: true }).waitFor();
  const restockCard = page
    .locator("main .rounded-2xl")
    .filter({ has: page.getByText(productDetails.name, { exact: true }) })
    .first();
  await restockCard.getByRole("button", { name: "Record delivery", exact: true }).click();
  await dialog().getByLabel("Quantity received").fill("10");
  loseResponse = true;
  await failed("Add to inventory");
  const disappearedReceipt = requests.at(-1);
  const disappearedReceiptResult = saved.get(disappearedReceipt.key).data;
  await setProductActive(product.id, false);
  const adviceRemoved = page.waitForResponse((response) =>
    response.url().endsWith("/forecast-dashboard"),
  );
  restockAdvice = false;
  forecastRevision++;
  await adviceRemoved;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await restockCard.count(), 0);
  assert.equal(await dialog().getByLabel("Quantity received").inputValue(), "10");
  await save("Add to inventory");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests.at(-1).key, disappearedReceipt.key);
  assert.deepEqual(requests.at(-1).input, disappearedReceipt.input);
  assert.equal((await snapshot()).stock, 30);
  assert.equal((await movementSnapshot(disappearedReceiptResult.id)).matchingAudits.length, 1);
  console.log(
    "Passed: Restock keeps a pending receipt after its advice row disappears and confirms the original product/body/key once.",
  );

  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  for (const movementType of ["return", "write_off"]) {
    await setProductActive(product.id, true);
    await setCatalogStock(movementType === "write_off" ? 5 : 10);
    await openBaseMovement(movementType, movementType === "write_off" ? 5 : 2);
    const button = movementType === "write_off" ? "Save write-off" : "Save return";
    loseResponse = true;
    await failed(button);
    const inactiveMovement = requests.at(-1);
    const inactiveMovementResult = saved.get(inactiveMovement.key).data;
    await setProductActive(product.id, false);
    await refreshMovements();
    assert.equal(
      await dialog().getByLabel("Active product", { exact: true }).inputValue(),
      product.id,
    );
    if (movementType === "write_off") {
      assert.equal((await snapshot()).stock, 0);
      assert.equal(await dialog().getByLabel("Quantity to write off").getAttribute("max"), null);
    }
    await save(button);
    await dialog().waitFor({ state: "hidden" });
    assert.equal(requests.at(-1).key, inactiveMovement.key);
    assert.deepEqual(requests.at(-1).input, inactiveMovement.input);
    assert.equal((await movementSnapshot(inactiveMovementResult.id)).matchingAudits.length, 1);
    assert.equal((await snapshot()).stock, movementType === "write_off" ? 0 : 12);
    console.log(
      `Passed: exact ${movementType} retry reaches the saved result after the product becomes inactive${movementType === "write_off" ? " and refreshed stock is zero" : ""}.`,
    );
  }

  await setProductActive(product.id, true);
  await setCatalogStock(20);
  await setTimezone("Asia/Manila");
  await openBaseSale(5, "2026-10-16");
  loseResponse = true;
  await failed("Save sale");
  const timezoneSale = requests.at(-1);
  await setTimezone("America/Los_Angeles");
  assert.equal(await dialog().getByLabel("Date", { exact: true }).getAttribute("max"), null);
  await dialog().getByLabel("Quantity", { exact: true }).fill("4");
  assert.equal(
    await dialog().getByLabel("Date", { exact: true }).getAttribute("max"),
    "2026-10-15",
  );
  const beforeEditedFuture = requests.length;
  await save("Save sale");
  assert.equal(
    await dialog()
      .getByLabel("Date", { exact: true })
      .evaluate((input) => input.validity.rangeOverflow),
    true,
  );
  await submitHandler();
  assert.equal(requests.length, beforeEditedFuture);
  await dialog().getByLabel("Quantity", { exact: true }).fill("5");
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests.at(-1).key, timezoneSale.key);
  assert.deepEqual(requests.at(-1).input, timezoneSale.input);
  assert.equal((await snapshot()).stock, 15);
  console.log(
    "Passed: an exact saved sale retry survives a backward business-timezone date change, while editing the future-dated submission remains blocked.",
  );

  await setCatalogStock(20);
  await openBaseSale(3);
  const salesBeforeUnsaved = sales.length;
  loseBeforeCommit = true;
  await failed("Save sale");
  const unsavedInactiveSale = requests.at(-1);
  assert.equal(saved.has(unsavedInactiveSale.key), false);
  await setProductActive(product.id, false);
  const inactiveSaleRejection = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/sales"),
  );
  await save("Save sale");
  assert.equal((await inactiveSaleRejection).status(), 409);
  await page
    .getByText("Synthetic backend rejected an inactive product.", { exact: true })
    .last()
    .waitFor();
  assert.equal(requests.at(-1).key, unsavedInactiveSale.key);
  assert.deepEqual(requests.at(-1).input, unsavedInactiveSale.input);
  assert.equal(sales.length, salesBeforeUnsaved);
  assert.equal(stock, 20);
  await dialog().getByLabel("Product", { exact: true }).selectOption(alternateId);
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(requests.at(-1).key, unsavedInactiveSale.key);
  console.log(
    "Passed: an uncommitted sale's unchanged inactive-product retry reaches the backend rejection instead of bypassing its business rule.",
  );

  await setProductActive(product.id, true);
  await setCatalogStock(20);
  await openBaseDelivery(4);
  loseBeforeCommit = true;
  await failed("Add to inventory");
  const unsavedReceipt = requests.at(-1);
  assert.equal(saved.has(unsavedReceipt.key), false);
  await setProductActive(product.id, false);
  const inactiveReceiptRejection = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/inventory-movements"),
  );
  await save("Add to inventory");
  assert.equal((await inactiveReceiptRejection).status(), 409);
  await page
    .getByText("Synthetic backend rejected an inactive product.", { exact: true })
    .last()
    .waitFor();
  assert.equal(requests.at(-1).key, unsavedReceipt.key);
  assert.deepEqual(requests.at(-1).input, unsavedReceipt.input);
  assert.equal(stock, 20);
  await setProductActive(product.id, true);
  await save("Add to inventory");
  await dialog().waitFor({ state: "hidden" });
  assert.equal(requests.at(-1).key, unsavedReceipt.key);
  assert.equal(stock, 24);
  console.log(
    "Passed: an uncommitted delivery retry is rejected while inactive and saves once after the owner reactivates the product.",
  );

  await setCatalogStock(20);
  await setTimezone("Asia/Manila");
  await openBaseSale(3, "2026-10-16");
  loseBeforeCommit = true;
  await failed("Save sale");
  const unsavedFutureSale = requests.at(-1);
  await setTimezone("America/Los_Angeles");
  const futureSaleRejection = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/sales"),
  );
  await save("Save sale");
  assert.equal((await futureSaleRejection).status(), 409);
  await page
    .getByText("Synthetic backend rejected a future date.", { exact: true })
    .last()
    .waitFor();
  assert.equal(requests.at(-1).key, unsavedFutureSale.key);
  assert.deepEqual(requests.at(-1).input, unsavedFutureSale.input);
  assert.equal(saved.has(unsavedFutureSale.key), false);
  assert.equal(stock, 20);
  await dialog().getByLabel("Date", { exact: true }).fill("2026-10-15");
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(requests.at(-1).key, unsavedFutureSale.key);
  assert.equal(stock, 17);
  console.log(
    "Passed: an uncommitted sale retry with a now-future date is rejected by the backend; correcting the date creates a fresh valid submission.",
  );

  await setCatalogStock(20);
  await openBaseSale(2);
  loseResponse = true;
  await failed("Save sale");
  const formerSessionSale = requests.at(-1);
  await setProductActive(product.id, false);
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/lib/store.ts");
    useAppStore.setState({
      session: { ...useAppStore.getState().session, userId: "synthetic-replacement-owner" },
    });
  });
  const beforeNewSessionSubmit = requests.length;
  if (await dialog().isVisible()) {
    await submitHandler();
    assert.equal(requests.length, beforeNewSessionSubmit);
  } else await openSale(1);
  await dialog().getByLabel("Product", { exact: true }).selectOption(alternateId);
  await dialog().getByLabel("Quantity", { exact: true }).fill("1");
  await dialog().getByLabel("Date", { exact: true }).fill("2026-10-15");
  await save("Save sale");
  await dialog().waitFor({ state: "hidden" });
  assert.notEqual(requests.at(-1).key, formerSessionSale.key);
  assert.equal(requests.at(-1).input.productId, alternateId);
  assert.equal(
    requests.slice(beforeNewSessionSubmit).some((entry) => entry.key === formerSessionSale.key),
    false,
  );
  assert.deepEqual(pageErrors, []);
  console.log(
    "Passed: replacing the signed-in session invalidates the pending inactive sale; an explicit active-product submission uses a fresh key.",
  );
} finally {
  metadataHold?.release();
  await page?.close();
  await browser?.close();
  await server.close();
}
