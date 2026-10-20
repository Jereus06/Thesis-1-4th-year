import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real UI/store/API adapter with synthetic HTTP fixtures in a fresh browser.
// These checks do not run a database, train models, or use saved account credentials.
process.env.VITE_DATA_MODE = "api";
process.env.VITE_API_URL = "/api/v1";
const output = "benchmarks/client-ui";
await mkdir(output, { recursive: true });
const server = await createServer({
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const owner = {
  userId: "synthetic-ui-owner",
  businessId: "synthetic-ui-business",
  role: "owner",
  email: "synthetic-ui@example.test",
  displayName: "Synthetic UI owner",
};
const products = [
  ["catalog-first", "Synthetic catalog first", 8],
  ["saved-rank-one", "Synthetic saved rank one", 4],
  ["unavailable", "Synthetic unavailable item", 0],
  ["zero-demand", "Synthetic zero demand", 20],
].map(([id, name, currentStock], index) => ({
  id,
  name,
  sku: `UI-${index + 1}`,
  category: "Synthetic UI verification",
  unit: "piece",
  currentStock,
  leadTimeDays: 2,
  safetyStock: 3,
  unitCost: 1,
  isActive: true,
}));
const day = "2026-10-20";
let savedSettings = {
  businessId: owner.businessId,
  movingAverageWindow: 7,
  forecastHorizonDays: 30,
  targetCoverDays: 7,
  minimumHistoryWeeks: 8,
  minimumNonzeroDays: 100,
  topNProducts: 2,
  cvFolds: 3,
  timezone: "Asia/Manila",
};
const savedRunWindows = new Map([
  [1, 7],
  [2, 7],
  [3, 7],
]);
const settingsWrites = [];
let completedGeneration = 1;
let pendingGeneration = 2;
const relativeDay = (offset) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const run = (generation, status = "completed") => ({
  id: `synthetic-ui-run-${generation}`,
  status,
  createdAt: `2026-10-20T00:0${generation}:00Z`,
  finalTestStart: relativeDay(generation >= 3 ? -30 : -14),
  finalTestEnd: relativeDay(-1),
  forecastHorizonDays: 30,
  failureMessage: null,
  timing: {},
  configuration: {},
  dataSnapshot: { settings: { moving_average_window: savedRunWindows.get(generation) } },
});
let stage = "completed-1";
let revision = 0;
const report = {
  provenance:
    "Synthetic intercepted HTTP in a fresh browser; real UI/store/API adapter, no live records.",
  checks: [],
  requests: [],
  browserErrors: [],
};
const mutations = [];
let browser;
let page;

function dashboard() {
  const generation = completedGeneration;
  const testDays = generation >= 3 ? 30 : 14;
  const expired = stage === "expired";
  const stale = stage === "stale";
  const scores = {
    moving_average: { mae: "2", rmse: "3" },
    xgboost: { mae: "1", rmse: "2" },
    ensemble: { mae: "1.5", rmse: "2.5" },
  };
  return {
    run: run(generation),
    latestRun: ["queued", "running"].includes(stage)
      ? run(pendingGeneration, stage)
      : run(generation),
    stale,
    expired,
    forecastThrough: relativeDay(expired ? -1 : 7),
    businessDay: day,
    businessTimezone: "Asia/Manila",
    asOf: relativeDay(-1),
    message: "Synthetic UI verification fixture",
    forecastSchedule: { enabled: false, localTime: "00:15", timezone: "Asia/Manila" },
    trainingScope: {
      limit: 2,
      trainingStart: relativeDay(-180),
      trainingEnd: relativeDay(-31),
      ranking: "training_sales_volume_v1",
      // Deliberately differs from both catalog order and array order on the first run.
      products: [
        {
          productId: products[0].id,
          rank: generation === 1 ? 2 : 1,
          trainingQuantity: generation === 1 ? "200" : "500",
        },
        { productId: products[1].id, rank: generation === 1 ? 1 : 2, trainingQuantity: "400" },
      ],
    },
    modelComparison: {
      validation: {
        productIds: products.slice(0, 2).map((item) => item.id),
        observationCount: testDays * 2,
        scores,
      },
      finalTest: {
        productIds: products.slice(0, 2).map((item) => item.id),
        observationCount: testDays * 2,
        scores,
      },
    },
    summaries: Object.fromEntries(
      products.map((item, index) => [
        item.id,
        {
          historyDays: 180,
          nonzeroDays: index === 3 ? 0 : 160,
          eligible: index < 2,
          operatingMethod: index < 2 ? "xgboost" : "fallback",
          unknownDays: 2,
          excludedDays: 1,
          qualityWarnings: index === 1 ? ["Synthetic warning: check missing receipts."] : [],
          ...(index === 2 ? { fallbackReason: "No usable sales history" } : {}),
        },
      ]),
    ),
    metrics: products.flatMap((item) =>
      ["validation", "final_test"].flatMap((datasetSplit) =>
        Object.entries(scores).map(([method, values]) => ({
          productId: item.id,
          method,
          datasetSplit,
          observationCount: testDays,
          ...values,
        })),
      ),
    ),
    predictions: products.flatMap((item, index) =>
      [-1, 1, 2].map((offset) => ({
        productId: item.id,
        predictionDate: relativeDay(offset),
        datasetSplit: offset < 0 ? "final_test" : "future",
        method: index < 2 ? "xgboost" : "fallback",
        predictedQuantity: index === 3 ? "0" : "5",
        actualQuantity: offset < 0 ? "5" : null,
        lowerBound: null,
        upperBound: null,
      })),
    ),
    recommendations: products.map((item, index) => {
      const available = index !== 2 && !expired;
      const demand = index === 3 ? 0 : 5;
      return {
        productId: item.id,
        method: index < 2 ? "xgboost" : "fallback",
        confidenceLevel: "high",
        demandAvailable: available,
        forecastExpired: expired,
        unavailableReason: expired
          ? "Synthetic expired forecast: refresh before ordering."
          : index === 2
            ? "No usable sales history"
            : null,
        daily_demand: available ? String(demand) : null,
        demand_during_lead_time: available ? String(demand * 2) : null,
        reorder_point: available ? "13" : null,
        target_stock: available ? "35" : null,
        suggested_quantity: available && demand > 0 ? "25" : "0",
        days_of_cover: available && demand > 0 ? String(item.currentStock / demand) : null,
        status: item.currentStock === 0 ? "stockout" : index < 2 ? "reorder" : "healthy",
        forecastEvidence: { status: "tested", testObservations: testDays, mae: "1", rmse: "2" },
        forecastConfidence: {
          policy: "past_test_wape_v1",
          level: "high",
          reason: `Low past error across ${testDays} consecutive tested days.`,
          testObservations: testDays,
          relativeError: "0.1",
        },
      };
    }),
  };
}

function passed(message) {
  report.checks.push(message);
  console.log(`Passed ${report.checks.length}: ${message}`);
}

try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    report.requests.push({ method: request.method(), path, stage });
    const json = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (request.method() !== "GET") {
      mutations.push(path);
      if (path.endsWith("/settings") && request.method() === "PUT") {
        const input = request.postDataJSON();
        settingsWrites.push(input);
        savedSettings = { ...input, businessId: owner.businessId };
        revision++;
        return json(savedSettings);
      }
      if (path.endsWith("/forecast-refresh")) {
        pendingGeneration = completedGeneration + 1;
        savedRunWindows.set(pendingGeneration, savedSettings.movingAverageWindow);
        stage = "queued";
        revision++;
        return json(run(pendingGeneration, "queued"));
      }
      return route.fulfill({ status: 500, body: "Unexpected synthetic verification mutation" });
    }
    if (path.endsWith("/auth/options")) return json({ signUpEnabled: false, googleEnabled: false });
    if (path.endsWith("/auth/google/pending")) return json(null);
    if (path.endsWith("/auth/members")) return json([]);
    if (path.endsWith("/auth/me")) return json(owner);
    if (path.endsWith("/settings")) return json(savedSettings);
    if (path === `/api/v1/businesses/${owner.businessId}`)
      return json({ name: "Synthetic UI verification", location: "", dataOrigin: "demo" });
    if (path.endsWith("/products")) return json(products);
    if (path.endsWith("/sales") || path.endsWith("/inventory-movements")) return json([]);
    if (path.endsWith("/forecast-status")) return json({ revision: String(revision) });
    if (path.endsWith("/forecast-dashboard")) return json(dashboard());
    throw new Error(`Unexpected verification request: ${request.method()} ${path}`);
  });

  const base = server.resolvedUrls.local[0];
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: /Morning briefing/ }).waitFor();
  const card = (name) =>
    page
      .locator("main .rounded-2xl")
      .filter({ has: page.getByText(name, { exact: true }) })
      .first();
  const maeCard = card("XGBoost MAE");
  const forecastAction = maeCard.getByRole("link", { name: "Forecasts", exact: true });
  await forecastAction.waitFor();
  await page.screenshot({ path: `${output}/overview.png`, fullPage: true, animations: "disabled" });
  await forecastAction.click();
  await page.waitForURL("**/forecasts");
  await page.getByRole("heading", { name: "Sales forecasts", exact: true }).waitFor();
  passed("Overview MAE card opens Forecasts through its own compact action.");

  const selector = page.getByRole("combobox", { name: "Forecast product", exact: true });
  await page.waitForFunction(
    () => document.querySelector("#forecast-results")?.value === "saved-rank-one",
  );
  assert.equal(await selector.locator('option[value=""]').count(), 0);
  assert.equal(
    await selector
      .locator("option")
      .filter({ hasText: /Overall/ })
      .count(),
    0,
  );
  passed(
    "Forecasts defaults to saved rank 1 despite catalog/array order and has no Overall option.",
  );

  await selector.selectOption("zero-demand");
  await page.getByRole("button", { name: "Refresh forecasts", exact: true }).click();
  await page.getByRole("button", { name: /Updating forecasts/ }).waitFor();
  await page.getByText(/Waiting to update forecasts/).waitFor();
  assert.equal(await selector.inputValue(), "zero-demand");
  stage = "running";
  revision++;
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Updating forecasts") &&
      !document.body.innerText.includes("Waiting to update forecasts"),
  );
  assert.equal(await selector.inputValue(), "zero-demand");
  passed(
    "A manual product selection stays selected while a replacement forecast is queued or running.",
  );

  stage = "completed-2";
  completedGeneration = 2;
  revision++;
  await page.waitForFunction(
    () => document.querySelector("#forecast-results")?.value === "catalog-first",
  );
  await selector.selectOption("zero-demand");
  const readsBeforeSameResult = report.requests.filter((item) =>
    item.path.endsWith("/forecast-dashboard"),
  ).length;
  revision++;
  await page.waitForResponse((response) => response.url().endsWith("/forecast-dashboard"));
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(
    () => document.querySelector("#forecast-results")?.value === "zero-demand",
  );
  assert.ok(
    report.requests.filter((item) => item.path.endsWith("/forecast-dashboard")).length >
      readsBeforeSameResult,
  );
  passed(
    "A newly completed forecast resets to its saved rank 1; rereading that result preserves manual selection.",
  );
  await page.screenshot({
    path: `${output}/forecasts.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("link", { name: "Restock", exact: true }).click();
  await page.getByRole("heading", { name: "Restocking recommendations", exact: true }).waitFor();
  const rankedCard = card(products[1].name);
  const details = rankedCard
    .locator("details")
    .filter({ has: page.getByText("Forecast details", { exact: true }) });
  await details.waitFor();
  assert.equal(await details.evaluate((element) => element.open), false);
  for (const label of [
    "Stock on hand",
    "Expected daily sales",
    "Order when stock reaches",
    "Days stock may last",
    "Suggested order",
  ])
    assert.equal(await rankedCard.getByText(label, { exact: true }).isVisible(), true);
  assert.equal(
    await rankedCard.getByRole("button", { name: "Record delivery", exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await rankedCard.getByText(/Accuracy checked on 14 of the requested 30 days/).isVisible(),
    true,
  );
  assert.equal(
    await rankedCard.getByText(/Synthetic warning: check missing receipts/).isVisible(),
    true,
  );
  assert.equal(await rankedCard.getByText(/Days with missing records:/).isVisible(), false);
  await details.locator("summary").click();
  assert.equal(await rankedCard.getByText(/Days with missing records: 2/).isVisible(), true);
  await details.locator("summary").click();
  passed(
    "Restock keeps core figures, delivery, limited-test and record warnings visible while forecast details start collapsed.",
  );
  await page.screenshot({ path: `${output}/restock.png`, fullPage: true, animations: "disabled" });

  assert.equal(
    await card(products[2].name)
      .getByText(/Sales estimate unavailable:/)
      .isVisible(),
    true,
  );
  assert.equal(
    await card(products[2].name)
      .getByRole("button", { name: "Record delivery", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await card(products[3].name)
      .getByText(/The current estimate is zero sales/)
      .isVisible(),
    true,
  );
  stage = "stale";
  revision++;
  await rankedCard.getByText("Refresh needed", { exact: true }).waitFor();
  stage = "expired";
  revision++;
  await rankedCard.getByText("Expired forecast", { exact: true }).waitFor();
  assert.equal(
    await rankedCard.getByText(/Synthetic expired forecast: refresh before ordering/).isVisible(),
    true,
  );
  assert.equal(
    await rankedCard.getByRole("button", { name: "Record delivery", exact: true }).isVisible(),
    true,
  );
  passed(
    "Unavailable, zero-demand, stale and expired advice retain visible warnings and delivery access.",
  );
  await page.screenshot({
    path: `${output}/restock-expired.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("tab", { name: "Account & settings", exact: true }).click();
  const currentPassword = page.getByLabel("Current password", { exact: true });
  const newPassword = page.getByLabel("New password", { exact: true });
  assert.equal(await currentPassword.inputValue(), "");
  assert.equal(await newPassword.inputValue(), "");
  await currentPassword.fill("Synthetic-current-only");
  await newPassword.fill("Synthetic-replacement-only");
  const mutationCount = mutations.length;
  await page.getByRole("button", { name: "Show current password", exact: true }).click();
  assert.equal(await currentPassword.getAttribute("type"), "text");
  assert.equal(await newPassword.getAttribute("type"), "password");
  await page.getByRole("button", { name: "Show new password", exact: true }).click();
  assert.equal(await currentPassword.getAttribute("type"), "text");
  assert.equal(await newPassword.getAttribute("type"), "text");
  const passwordForm = page.locator("form").filter({ has: currentPassword });
  await passwordForm.screenshot({
    path: `${output}/account-passwords.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const input of [currentPassword, newPassword]) {
    const bounds = await input.evaluate((field) => {
      const reveal = document.querySelector(`button[aria-controls="${field.id}"]`);
      if (!reveal) return null;
      const inputBox = field.getBoundingClientRect();
      const buttonBox = reveal.getBoundingClientRect();
      return {
        textRight: inputBox.right - Number.parseFloat(getComputedStyle(field).paddingRight),
        buttonLeft: buttonBox.left,
        buttonRight: buttonBox.right,
        inputRight: inputBox.right,
      };
    });
    assert.ok(bounds && bounds.textRight <= bounds.buttonLeft, "text ends before its eye control");
    assert.ok(bounds.buttonRight <= bounds.inputRight, "eye control stays inside the input");
  }
  await passwordForm.screenshot({
    path: `${output}/account-passwords-narrow.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "Hide current password", exact: true }).click();
  assert.equal(await currentPassword.getAttribute("type"), "password");
  assert.equal(await newPassword.getAttribute("type"), "text");
  await page.getByRole("button", { name: "Hide new password", exact: true }).click();
  assert.equal(await newPassword.getAttribute("type"), "password");
  assert.equal(await currentPassword.inputValue(), "Synthetic-current-only");
  assert.equal(await newPassword.inputValue(), "Synthetic-replacement-only");
  assert.equal(mutations.length, mutationCount);
  assert.equal(await currentPassword.getAttribute("autocomplete"), "current-password");
  assert.equal(await newPassword.getAttribute("autocomplete"), "new-password");
  assert.equal(await newPassword.getAttribute("minlength"), "12");
  await currentPassword.fill("");
  await newPassword.fill("");
  passed(
    "Current/new password eyes toggle independently, preserve values and constraints, and never submit the form.",
  );

  // A newer saved fixture provides a thirty-day past test, independent of its seven-day average.
  completedGeneration = 3;
  stage = "completed-3";
  revision++;
  const maWindow = page.getByLabel("Moving Average window (days)", { exact: true });
  assert.equal(await maWindow.inputValue(), "7");
  await maWindow.selectOption("14");
  await page
    .getByText(
      "Not saved yet. Saved window: 7 days. Choose Save settings, then Refresh forecasts.",
      {
        exact: true,
      },
    )
    .waitFor();
  assert.equal(settingsWrites.length, 0);
  assert.equal(savedSettings.movingAverageWindow, 7);
  await page.screenshot({
    path: `${output}/settings-unsaved.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByText(/Saved window: 14 days\. Save changes before/).waitFor();
  assert.equal(settingsWrites.length, 1);
  assert.equal(settingsWrites[0].movingAverageWindow, 14);
  assert.equal(settingsWrites[0].forecastHorizonDays, 30);
  assert.equal(savedSettings.movingAverageWindow, 14);
  const savedStoreWindow = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/lib/store.ts");
    return useAppStore.getState().settings.maWindow;
  });
  assert.equal(savedStoreWindow, 14);
  passed(
    "Selecting 14 shows an unsaved draft; Save settings sends PUT and stores the canonical fourteen-day window.",
  );

  await page.getByRole("link", { name: "Forecasts", exact: true }).click();
  const savedVsDisplayed = page.getByText(
    "Saved window: 14 days. Displayed results used 7 days. New results appear after a forecast refresh using the saved setting finishes.",
    { exact: true },
  );
  await savedVsDisplayed.waitFor();
  await page.getByText(/Uses the previous 7 days of sales for each average/).waitFor();
  await page
    .getByText(/Tested on 30 past days/)
    .first()
    .waitFor();
  await page.screenshot({
    path: `${output}/saved-vs-displayed-window.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Refresh forecasts", exact: true }).click();
  await page.getByText(/Waiting to update forecasts/).waitFor();
  assert.equal(savedRunWindows.get(pendingGeneration), 14);
  assert.equal(await savedVsDisplayed.isVisible(), true);
  assert.equal(
    await page.getByText(/Uses the previous 7 days of sales for each average/).isVisible(),
    true,
  );
  stage = "running";
  revision++;
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Updating forecasts") &&
      !document.body.innerText.includes("Waiting to update forecasts"),
  );
  assert.equal(await savedVsDisplayed.isVisible(), true);
  completedGeneration = pendingGeneration;
  stage = `completed-${completedGeneration}`;
  revision++;
  await page.getByText(/Uses the previous 14 days of sales for each average/).waitFor();
  assert.equal(await savedVsDisplayed.count(), 0);
  assert.equal(
    await page
      .getByText(/Tested on 30 past days/)
      .first()
      .isVisible(),
    true,
  );
  await page.screenshot({
    path: `${output}/moving-average-fourteen-test-thirty.png`,
    fullPage: true,
    animations: "disabled",
  });
  passed(
    "Refresh snapshots saved window 14, preserves old seven-day results while pending, then displays fourteen-day averages with the separate thirty-day past test.",
  );

  const settingsReadsBeforeReload = report.requests.filter(
    (item) => item.path.endsWith("/settings") && item.method === "GET",
  ).length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(/Uses the previous 14 days of sales for each average/).waitFor();
  await page
    .getByText(/Tested on 30 past days/)
    .first()
    .waitFor();
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("tab", { name: "Account & settings", exact: true }).click();
  assert.equal(
    await page.getByLabel("Moving Average window (days)", { exact: true }).inputValue(),
    "14",
  );
  assert.ok(
    report.requests.filter((item) => item.path.endsWith("/settings") && item.method === "GET")
      .length > settingsReadsBeforeReload,
  );
  passed(
    "A full reload reads saved window 14 from the synthetic API and retains its thirty-day past-test evidence.",
  );

  assert.deepEqual(mutations, [
    `/api/v1/businesses/${owner.businessId}/forecast-refresh`,
    `/api/v1/businesses/${owner.businessId}/settings`,
    `/api/v1/businesses/${owner.businessId}/forecast-refresh`,
  ]);
  assert.deepEqual(report.browserErrors, []);
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.failure = error.stack;
  if (page) {
    report.failurePage = await page
      .locator("body")
      .innerText()
      .catch(() => "Unavailable");
    await page
      .screenshot({ path: `${output}/failure.png`, fullPage: true, animations: "disabled" })
      .catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close();
  await server.close();
}
