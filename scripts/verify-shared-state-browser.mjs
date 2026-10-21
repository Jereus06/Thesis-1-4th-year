import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real frontend/API adapter, isolated contexts and a shared synthetic HTTP fixture.
// Database locking and settings-version generation are verified by backend tests.
process.env.VITE_DATA_MODE = "api";
process.env.VITE_API_URL = "/api/v1";
const output = "benchmarks/shared-state";
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: `${output}/vite-cache`,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const owner = {
  userId: "synthetic-shared-owner",
  businessId: "synthetic-shared-business",
  email: "shared-state@example.test",
  displayName: "Synthetic shared owner",
  role: "owner",
};
const activeId = "synthetic-shared-product";
let products = [
  {
    id: activeId,
    sku: "SHARED-1",
    name: "Synthetic shared product",
    category: "Synthetic verification",
    unit: "piece",
    currentStock: "20",
    leadTimeDays: 2,
    safetyStock: "2",
    unitCost: "1",
    isActive: true,
  },
  {
    id: "synthetic-inactive-product",
    sku: "SHARED-2",
    name: "Synthetic inactive product",
    category: "Synthetic verification",
    unit: "piece",
    currentStock: "3",
    leadTimeDays: 2,
    safetyStock: "0",
    unitCost: "1",
    isActive: false,
  },
];
let version = 1;
let settings = {
  businessId: owner.businessId,
  businessName: "Synthetic shared store",
  businessLocation: "Synthetic initial location",
  dataOrigin: "demo",
  movingAverageWindow: 7,
  forecastHorizonDays: 30,
  targetCoverDays: 7,
  minimumHistoryWeeks: 8,
  minimumNonzeroDays: 100,
  topNProducts: 5,
  cvFolds: 3,
  timezone: "Asia/Manila",
  version: `synthetic-version-${version}`,
};
let revision = 1;
let completedGeneration = 1;
let completedWindow = 7;
let queuedWindow = null;
let stage = "completed";
let includeSharedState = true;
const clients = [];
const heldDashboards = new Map();
const pendingHolds = new Set();
const report = {
  provenance: "Synthetic intercepted HTTP in isolated browsers; no live records or credentials.",
  checks: [],
  requests: [],
  settingsWrites: [],
  browserErrors: [],
  failedResources: [],
};
let browser;

const clone = (value) => structuredClone(value);
function run(generation, status, window) {
  return {
    id: `synthetic-shared-run-${generation}`,
    status,
    createdAt: "2026-10-20T00:00:00Z",
    finalTestStart: "2026-09-20",
    finalTestEnd: "2026-10-19",
    forecastHorizonDays: 30,
    timing: {},
    configuration: {},
    dataSnapshot: { settings: { moving_average_window: window } },
  };
}
function dashboard() {
  const saved = run(completedGeneration, "completed", completedWindow);
  const stock = Number(products[0].currentStock);
  const demand = 2;
  const reorderPoint = demand * products[0].leadTimeDays + Number(products[0].safetyStock);
  const target =
    demand * (products[0].leadTimeDays + settings.targetCoverDays) +
    Number(products[0].safetyStock);
  const scores = {
    moving_average: { mae: "2", rmse: "3" },
    xgboost: { mae: "1", rmse: "2" },
    ensemble: { mae: "1.5", rmse: "2.5" },
  };
  return {
    run: saved,
    latestRun: stage === "completed" ? saved : run(completedGeneration + 1, stage, queuedWindow),
    asOf: "2026-10-19",
    businessDay: "2026-10-20",
    businessTimezone: "Asia/Manila",
    forecastThrough: "2026-11-18",
    stale: false,
    expired: false,
    summaries: {
      [activeId]: {
        historyDays: 180,
        nonzeroDays: 160,
        eligible: true,
        operatingMethod: "xgboost",
        unknownDays: 0,
        excludedDays: 0,
        qualityWarnings: [],
      },
    },
    predictions: [
      {
        productId: activeId,
        predictionDate: "2026-10-21",
        method: "xgboost",
        datasetSplit: "future",
        predictedQuantity: "2",
        actualQuantity: null,
        lowerBound: null,
        upperBound: null,
      },
    ],
    metrics: ["validation", "final_test"].flatMap((datasetSplit) =>
      Object.entries(scores).map(([method, values]) => ({
        productId: activeId,
        method,
        datasetSplit,
        observationCount: 30,
        ...values,
      })),
    ),
    modelComparison: {
      validation: { productIds: [activeId], observationCount: 30, scores },
      finalTest: { productIds: [activeId], observationCount: 30, scores },
    },
    recommendations: [
      {
        productId: activeId,
        method: "xgboost",
        confidenceLevel: "high",
        demandAvailable: true,
        forecastExpired: false,
        unavailableReason: null,
        daily_demand: String(demand),
        demand_during_lead_time: String(demand * products[0].leadTimeDays),
        reorder_point: String(reorderPoint),
        target_stock: String(target),
        suggested_quantity: String(
          stock <= reorderPoint ? Math.max(0, Math.ceil(target - stock)) : 0,
        ),
        days_of_cover: String(stock / demand),
        status: stock <= 0 ? "stockout" : stock <= reorderPoint ? "reorder" : "healthy",
        forecastEvidence: { status: "tested", testObservations: 30, mae: "1", rmse: "2" },
        forecastConfidence: {
          policy: "past_test_wape_v1",
          level: "high",
          reason: "Synthetic saved test",
          testObservations: 30,
          relativeError: "0.1",
        },
      },
    ],
    ...(includeSharedState
      ? { sharedState: { products: clone(products), settings: clone(settings) } }
      : {}),
  };
}
function passed(message) {
  report.checks.push(message);
  console.log(`Passed ${report.checks.length}: ${message}`);
}
function holdNextDashboard(client) {
  let captured;
  let release;
  let finished;
  const capturePromise = new Promise((resolve) => {
    captured = resolve;
  });
  const releasePromise = new Promise((resolve) => {
    release = resolve;
  });
  const finishPromise = new Promise((resolve) => {
    finished = resolve;
  });
  const hold = { captured, releasePromise, release, finished };
  assert.equal(heldDashboards.has(client.id), false);
  heldDashboards.set(client.id, hold);
  pendingHolds.add(hold);
  return {
    captured: () => bounded(capturePromise, "dashboard request"),
    release,
    finished: () => bounded(finishPromise, "held dashboard response"),
  };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const maWindow = (page) => page.getByLabel("Moving Average window (days)", { exact: true });
const coverDays = (page) => page.getByLabel("Cover days after delivery", { exact: true });
const field = (page, label) =>
  page.getByText(label, { exact: true }).locator("..").locator("input");
async function state(page) {
  return page.evaluate(() => {
    const current = window.__sharedStateStore.getState();
    return { settings: current.settings, products: current.products, session: current.session };
  });
}
async function waitForSettings(page, expected) {
  await page.waitForFunction((patch) => {
    const current = window.__sharedStateStore.getState().settings;
    return Object.entries(patch).every(([key, value]) => current[key] === value);
  }, expected);
}
async function saveSettings(client) {
  const response = client.page.waitForResponse(
    (response) => response.request().method() === "PUT" && response.url().endsWith("/settings"),
  );
  await client.page.getByRole("button", { name: "Save settings", exact: true }).click();
  const result = await response;
  await client.page.getByRole("button", { name: "Save settings", exact: true }).waitFor();
  return result;
}
async function openSettings(client) {
  if (!client.page.url().endsWith("/inventory"))
    await client.page.getByRole("link", { name: "Inventory", exact: true }).click();
  await client.page.getByRole("tab", { name: "Account & settings", exact: true }).click();
  await maWindow(client.page).waitFor();
}
async function newClient(id) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) =>
    report.browserErrors.push({ client: id, message: error.message }),
  );
  page.on("requestfailed", (request) => {
    report.failedResources.push({
      client: id,
      path: new URL(request.url()).pathname,
      failure: request.failure()?.errorText,
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !new URL(response.url()).pathname.includes("/api/"))
      report.failedResources.push({
        client: id,
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
  const client = {
    id,
    context,
    page,
    statusReads: 0,
    dashboardReads: 0,
    revisionOverride: null,
    session: clone(owner),
  };
  clients.push(client);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    report.requests.push({ client: id, method: request.method(), path });
    const json = (data, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data }) });
    if (path.startsWith("/api/v1/businesses/synthetic-other-business")) {
      if (path.endsWith("/forecast-status")) return json({ revision: "other-session" });
      const otherSettings = {
        ...settings,
        businessId: "synthetic-other-business",
        businessName: "Synthetic other session",
        movingAverageWindow: 3,
        version: "other-session-version",
      };
      if (path.endsWith("/forecast-dashboard"))
        return json({
          ...dashboard(),
          sharedState: { products: [], settings: otherSettings },
          summaries: {},
          predictions: [],
          metrics: [],
          recommendations: [],
        });
      if (
        path.endsWith("/products") ||
        path.endsWith("/sales") ||
        path.endsWith("/inventory-movements")
      )
        return json([]);
      if (path.endsWith("/settings")) return json(otherSettings);
      return json({
        name: "Synthetic other session",
        location: settings.businessLocation,
        dataOrigin: "demo",
      });
    }
    if (path.endsWith("/auth/options")) return json({ signUpEnabled: false, googleEnabled: false });
    if (path.endsWith("/auth/google/pending")) return json(null);
    if (path.endsWith("/auth/members")) return json([]);
    if (path.endsWith("/auth/me")) return json(client.session);
    if (path.endsWith("/settings")) {
      if (request.method() === "PUT") {
        const input = request.postDataJSON();
        const entry = { client: id, input, savedVersion: settings.version, status: 200 };
        report.settingsWrites.push(entry);
        assert.equal(
          typeof input.expectedVersion,
          "string",
          "a current client sends the saved settings version",
        );
        if (input.expectedVersion !== settings.version) {
          entry.status = 409;
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              detail:
                "Settings changed in another session. Reload the latest settings and try again.",
            }),
          });
        }
        const { expectedVersion: _expectedVersion, ...patch } = input;
        settings = { ...settings, ...patch, version: `synthetic-version-${++version}` };
        revision++;
        return json(settings);
      }
      return json(settings);
    }
    if (path.endsWith("/products")) return json(products);
    if (path.endsWith("/sales") || path.endsWith("/inventory-movements")) return json([]);
    if (path.endsWith("/forecast-status")) {
      client.statusReads++;
      return json({ revision: String(client.revisionOverride ?? revision) });
    }
    if (path.endsWith("/forecast-dashboard")) {
      client.dashboardReads++;
      const data = clone(dashboard());
      const hold = heldDashboards.get(id);
      if (hold) {
        heldDashboards.delete(id);
        hold.captured(data);
        await hold.releasePromise;
        try {
          await json(data);
        } finally {
          pendingHolds.delete(hold);
          hold.finished();
        }
        return;
      }
      return json(data);
    }
    if (path.endsWith("/forecast-refresh") && request.method() === "POST") {
      queuedWindow = settings.movingAverageWindow;
      stage = "queued";
      revision++;
      return json(run(completedGeneration + 1, stage, queuedWindow));
    }
    if (path === `/api/v1/businesses/${client.session.businessId}`)
      return json({
        name: settings.businessName,
        location: settings.businessLocation,
        dataOrigin: settings.dataOrigin,
      });
    throw new Error(`Unexpected synthetic request: ${request.method()} ${path}`);
  });
  await page.goto(`${server.resolvedUrls.local[0]}inventory`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.getByRole("tab", { name: "Products", exact: true }).waitFor({ timeout: 120_000 });
  await page.evaluate(async () => {
    window.__sharedStateStore = (await import("/src/lib/store.ts")).useAppStore;
  });
  await waitForSettings(page, { maWindow: settings.movingAverageWindow });
  await openSettings(client);
  return client;
}

try {
  await server.listen();
  for (const path of [
    "/src/routes/inventory.tsx?tsr-split=component",
    "/src/routes/forecasts.tsx?tsr-split=component",
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
  const a = await newClient("A");
  const b = await newClient("B");
  await field(a.page, "Store name").fill("Synthetic name edited by A");
  await coverDays(a.page).fill("10");
  await maWindow(b.page).selectOption("14");
  await field(b.page, "Location").fill("Synthetic remote location");
  assert.equal((await saveSettings(b)).status(), 200);
  await waitForSettings(a.page, { maWindow: 14, storeLocation: "Synthetic remote location" });
  assert.equal(await maWindow(a.page).inputValue(), "14");
  assert.equal(await field(a.page, "Location").inputValue(), "Synthetic remote location");
  assert.equal(await field(a.page, "Store name").inputValue(), "Synthetic name edited by A");
  assert.equal(await coverDays(a.page).inputValue(), "10");
  assert.equal((await saveSettings(a)).status(), 200);
  const mergedWrite = report.settingsWrites.at(-1);
  assert.equal(mergedWrite.input.movingAverageWindow, 14);
  assert.equal(mergedWrite.input.targetCoverDays, 10);
  assert.equal(mergedWrite.input.businessName, "Synthetic name edited by A");
  assert.equal(mergedWrite.input.businessLocation, "Synthetic remote location");
  await a.page.screenshot({
    path: `${output}/settings-preserved.png`,
    fullPage: true,
    animations: "disabled",
  });
  passed(
    "Remote window14 and untouched fields refresh while A's name/cover edits survive; saving preserves the remote values.",
  );

  products = [{ ...products[0], currentStock: "5" }, products[1]];
  revision++;
  await a.page.getByRole("link", { name: "Restock", exact: true }).click();
  await a.page.waitForFunction(
    (id) =>
      window.__sharedStateStore.getState().products.find((item) => item.id === id)?.currentStock ===
      5,
    activeId,
  );
  const card = a.page
    .locator("main .rounded-2xl")
    .filter({ has: a.page.getByText(products[0].name, { exact: true }) })
    .first();
  const statistic = (label) => card.getByText(label, { exact: true }).locator("..").locator("dd");
  await statistic("Stock on hand").getByText("5 piece", { exact: true }).waitFor();
  assert.equal(
    (
      await card
        .getByText("Suggested order", { exact: true })
        .locator("..")
        .locator("span")
        .last()
        .innerText()
    ).trim(),
    "21",
  );
  assert.equal((await state(a.page)).products.length, 2);
  assert.equal((await state(a.page)).products[1].isActive, false);
  assert.equal(await a.page.getByText(products[1].name, { exact: true }).count(), 0);
  await a.page.screenshot({
    path: `${output}/restock-coherent.png`,
    fullPage: true,
    animations: "disabled",
  });
  passed(
    "A shared dashboard refresh replaces stock20 with stock5 and coherent order21 advice while retaining inactive catalog records.",
  );

  const dashboardsBefore = a.dashboardReads;
  const statusReadsBefore = a.statusReads;
  await a.page.waitForResponse(
    (response) =>
      response.url().endsWith("/forecast-status") && a.statusReads >= statusReadsBefore + 2,
    { timeout: 20_000 },
  );
  assert.equal(
    a.dashboardReads,
    dashboardsBefore,
    "unchanged revision polls do not reload the dashboard",
  );
  passed(
    "Unchanged revision polling does not create a dashboard reload loop after shared settings/catalog synchronization.",
  );

  await openSettings(b);
  await waitForSettings(b.page, { maWindow: 14, coverDays: 10 });
  await maWindow(b.page).selectOption("28");
  assert.equal((await saveSettings(b)).status(), 200);
  await waitForSettings(a.page, { maWindow: 28 });
  await a.page.getByRole("link", { name: "Forecasts", exact: true }).click();
  const mismatch = a.page.getByText(
    "Saved window: 28 days. Displayed results used 7 days. New results appear after a forecast refresh using the saved setting finishes.",
    { exact: true },
  );
  await mismatch.waitFor();
  await a.page.getByRole("button", { name: "Refresh forecasts", exact: true }).click();
  await a.page.getByText(/Waiting to update forecasts/).waitFor();
  assert.equal(queuedWindow, 28);
  assert.equal(await mismatch.isVisible(), true);
  assert.equal(
    await a.page.getByText(/Uses the previous 7 days of sales for each average/).isVisible(),
    true,
  );
  stage = "running";
  revision++;
  await a.page.waitForFunction(
    () =>
      document.body.innerText.includes("Updating forecasts") &&
      !document.body.innerText.includes("Waiting to update forecasts"),
  );
  assert.equal(await mismatch.isVisible(), true);
  stage = "completed";
  completedGeneration++;
  completedWindow = queuedWindow;
  revision++;
  await a.page.getByText(/Uses the previous 28 days of sales for each average/).waitFor();
  assert.equal(await mismatch.count(), 0);
  passed(
    "Remote saved settings do not relabel old completed results while queued/running; the completed replacement uses its frozen window28.",
  );

  await openSettings(a);
  const delayed = holdNextDashboard(a);
  revision++;
  const oldDashboard = await delayed.captured();
  assert.equal(oldDashboard.sharedState.settings.movingAverageWindow, 28);
  await maWindow(a.page).selectOption("30");
  assert.equal((await saveSettings(a)).status(), 200);
  await waitForSettings(a.page, { maWindow: 30 });
  delayed.release();
  await delayed.finished();
  await a.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal((await state(a.page)).settings.maWindow, 30);
  assert.equal(await maWindow(a.page).inputValue(), "30");
  passed(
    "A delayed dashboard captured before a local settings save cannot restore its older canonical settings.",
  );

  // Hide B's next revision from A to reproduce a normal save between A's last poll and PUT.
  await waitForSettings(b.page, { maWindow: 30 });
  a.revisionOverride = revision;
  await field(a.page, "Store name").fill("Synthetic conflict edit retained");
  await coverDays(a.page).fill("14");
  await maWindow(b.page).selectOption("14");
  await field(b.page, "Location").fill("Synthetic conflict remote location");
  assert.equal((await saveSettings(b)).status(), 200);
  const beforeConflictWrites = report.settingsWrites.length;
  const conflict = await saveSettings(a);
  assert.equal(conflict.status(), 409);
  await a.page
    .getByText(
      "Settings changed in another browser. Your edits are kept. Review the latest saved values and save again.",
      { exact: true },
    )
    .waitFor();
  assert.equal(report.settingsWrites.length, beforeConflictWrites + 1);
  assert.equal(settings.movingAverageWindow, 14);
  await waitForSettings(a.page, {
    maWindow: 14,
    storeLocation: "Synthetic conflict remote location",
  });
  assert.equal(await field(a.page, "Store name").inputValue(), "Synthetic conflict edit retained");
  assert.equal(await coverDays(a.page).inputValue(), "14");
  assert.equal(await maWindow(a.page).inputValue(), "14");
  await a.page.screenshot({
    path: `${output}/stale-version.png`,
    fullPage: true,
    animations: "disabled",
  });
  assert.equal((await saveSettings(a)).status(), 200);
  assert.equal(report.settingsWrites.at(-1).input.movingAverageWindow, 14);
  assert.equal(settings.targetCoverDays, 14);
  assert.equal(settings.businessName, "Synthetic conflict edit retained");
  assert.equal(settings.businessLocation, "Synthetic conflict remote location");
  a.revisionOverride = null;
  passed(
    "A stale version receives409, reloads the latest settings without dropping edits, and only an intentional resubmit merges them.",
  );

  includeSharedState = false;
  settings = {
    ...settings,
    movingAverageWindow: 7,
    businessLocation: "Synthetic legacy location",
    version: `synthetic-version-${++version}`,
  };
  products = [{ ...products[0], currentStock: "4" }, products[1]];
  const legacySettingsReads = report.requests.filter(
    (entry) => entry.client === "A" && entry.method === "GET" && entry.path.endsWith("/settings"),
  ).length;
  revision++;
  await waitForSettings(a.page, { maWindow: 7, storeLocation: "Synthetic legacy location" });
  await a.page.waitForFunction(
    (id) =>
      window.__sharedStateStore.getState().products.find((item) => item.id === id)?.currentStock ===
      4,
    activeId,
  );
  assert.ok(
    report.requests.filter(
      (entry) => entry.client === "A" && entry.method === "GET" && entry.path.endsWith("/settings"),
    ).length > legacySettingsReads,
  );
  includeSharedState = true;
  passed(
    "A legacy dashboard without sharedState still refreshes current settings and the complete catalog through the compatibility reads.",
  );

  await openSettings(a);
  const horizon = () => a.page.getByLabel("Forecast horizon", { exact: true });
  const saveButton = () => a.page.getByRole("button", { name: "Save settings", exact: true });
  const refreshWritesBefore = report.requests.filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/forecast-refresh"),
  ).length;
  await horizon().fill("90");
  assert.equal((await saveSettings(a)).status(), 200);
  assert.equal(report.settingsWrites.at(-1).input.forecastHorizonDays, 90);
  await a.page.reload({ waitUntil: "domcontentloaded" });
  await a.page.evaluate(async () => {
    window.__sharedStateStore = (await import("/src/lib/store.ts")).useAppStore;
  });
  await openSettings(a);
  assert.equal(await horizon().inputValue(), "90", "a custom saved horizon survives reload");
  await horizon().fill("365");
  assert.equal((await saveSettings(a)).status(), 200);
  assert.equal(settings.forecastHorizonDays, 365);
  const writesBeforeInvalid = report.settingsWrites.length;
  for (const invalid of ["366", "", "0", "-1", "1.5"]) {
    await horizon().fill(invalid);
    assert.equal(await horizon().getAttribute("aria-invalid"), "true");
    assert.equal(await saveButton().isDisabled(), true);
    const message =
      invalid === "366"
        ? "The maximum is 365 days. Enter 365 or less."
        : "Enter a whole number from 1 to 365.";
    await a.page.getByRole("alert").filter({ hasText: message }).waitFor();
    assert.equal(report.settingsWrites.length, writesBeforeInvalid);
    assert.equal(settings.forecastHorizonDays, 365);
    if (invalid === "366") {
      await horizon()
        .locator("..")
        .screenshot({ path: `${output}/horizon-limit-warning.png` });
      await a.page.setViewportSize({ width: 390, height: 1000 });
      await horizon()
        .locator("..")
        .screenshot({ path: `${output}/horizon-limit-warning-narrow.png` });
      await a.page.setViewportSize({ width: 1440, height: 1100 });
    }
  }
  await horizon().fill("1");
  assert.equal((await saveSettings(a)).status(), 200);
  assert.equal(settings.forecastHorizonDays, 1);
  assert.equal(await horizon().getAttribute("aria-invalid"), null);
  await horizon().fill("30");
  assert.equal((await saveSettings(a)).status(), 200);
  assert.equal(
    report.requests.filter(
      (entry) => entry.method === "POST" && entry.path.endsWith("/forecast-refresh"),
    ).length,
    refreshWritesBefore,
    "editing and saving a horizon does not start training automatically",
  );
  passed(
    "Typed horizons90,365,1 save;90 survives reload;366/blank/zero/negative/fractional drafts warn and prevent writes without changing saved settings.",
  );

  const sessionRead = holdNextDashboard(a);
  revision++;
  await sessionRead.captured();
  await a.page.evaluate(() => {
    const store = window.__sharedStateStore;
    const current = store.getState();
    store.setState({
      session: {
        ...current.session,
        userId: "synthetic-other-owner",
        businessId: "synthetic-other-business",
      },
      settings: { ...current.settings, maWindow: 3, storeName: "Synthetic other session" },
      products: [],
    });
  });
  sessionRead.release();
  await sessionRead.finished();
  await a.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const other = await state(a.page);
  assert.equal(other.session.businessId, "synthetic-other-business");
  assert.equal(other.settings.maWindow, 3);
  assert.equal(other.settings.storeName, "Synthetic other session");
  assert.deepEqual(other.products, []);
  passed(
    "A delayed dashboard belonging to the old session cannot replace another session's settings or catalog.",
  );

  assert.deepEqual(report.browserErrors, []);
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.failure = error.stack;
  for (const client of clients) {
    report[`failurePage${client.id}`] = await client.page
      .locator("body")
      .innerText()
      .catch(() => "Unavailable");
    await client.page
      .screenshot({
        path: `${output}/failure-${client.id}.png`,
        fullPage: true,
        animations: "disabled",
      })
      .catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const hold of pendingHolds) hold.release();
  // Close pages before disposing context routes, so no final poll reaches the Vite proxy.
  for (const client of clients) await client.page.close();
  await browser?.close();
  await server.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
