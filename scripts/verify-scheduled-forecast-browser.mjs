import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Real browser interaction with isolated synthetic HTTP responses, not a database/model test.
const base = process.argv[2] ?? "http://127.0.0.1:4177";
const artifacts = `benchmarks/scheduled-forecast/${new URL(base).port}`;
mkdirSync(artifacts, { recursive: true });
const timezone = "Asia/Manila";
const parts = new Intl.DateTimeFormat("en", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const part = (name) => parts.find((p) => p.type === name).value;
const day = `${part("year")}-${part("month")}-${part("day")}`;
const relativeDay = (offset) => {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const businessId = "00000000-0000-4000-8000-000000009992";
const product = {
  id: "synthetic-schedule-product",
  sku: "SCHEDULE-001",
  name: "Synthetic schedule product",
  category: "Synthetic",
  unit: "unit",
  currentStock: "20",
  leadTimeDays: 3,
  safetyStock: "2",
  unitCost: "10",
  isActive: true,
};
const completedRun = {
  id: "synthetic-daily-run",
  status: "completed",
  createdAt: new Date().toISOString(),
  timing: {},
  finalTestStart: relativeDay(-14),
  finalTestEnd: relativeDay(-1),
  failureMessage: null,
  dataSnapshot: { settings: { moving_average_window: 7 } },
  configuration: {
    requestedFrom: "daily_schedule",
    scheduledFor: day,
    historyThrough: relativeDay(-1),
  },
};
let stage = "queued";
let legacyStatus = false;
function dashboard() {
  const saved = !["queued", "running"].includes(stage);
  const expired = stage === "expired";
  const run = saved
    ? { ...completedRun, ...(stage === "legacy_window" ? { dataSnapshot: {} } : {}) }
    : null;
  const latestRun =
    stage === "failed"
      ? {
          ...completedRun,
          id: "synthetic-failed-run",
          status: "failed",
          failureMessage: "Synthetic scheduled test failure",
        }
      : stage.startsWith("replacement_")
        ? {
            ...completedRun,
            id: "synthetic-thirty-day-replacement",
            status: stage.slice("replacement_".length),
            dataSnapshot: { settings: { moving_average_window: 30 } },
          }
        : { ...completedRun, status: saved ? "completed" : stage };
  return {
    forecastSchedule: { enabled: stage !== "disabled", localTime: "00:15", timezone },
    stale: false,
    expired,
    forecastThrough: expired ? relativeDay(-1) : relativeDay(7),
    businessDay: day,
    businessTimezone: timezone,
    asOf: relativeDay(-1),
    run,
    latestRun,
    message: "Synthetic scheduler browser fixture",
    summaries: {
      [product.id]: {
        historyDays: 70,
        nonzeroDays: 70,
        eligible: false,
        operatingMethod: "fallback",
        fallbackReason: "Synthetic insufficient-training-history fallback",
        unknownDays: 0,
        excludedDays: 0,
        qualityWarnings: [],
      },
    },
    metrics: [],
    predictions:
      saved && !expired
        ? Array.from({ length: 7 }, (_, i) => ({
            productId: product.id,
            predictionDate: relativeDay(i + 1),
            method: "fallback",
            datasetSplit: "future",
            predictedQuantity: "2",
            actualQuantity: null,
            lowerBound: null,
            upperBound: null,
          }))
        : [],
    recommendations: [
      {
        productId: product.id,
        method: "fallback",
        confidenceLevel: "low",
        demandAvailable: saved && !expired,
        forecastExpired: expired,
        unavailableReason: expired
          ? "Forecast expired"
          : saved
            ? null
            : "Waiting for saved forecasts",
        daily_demand: saved && !expired ? "2" : null,
        demand_during_lead_time: saved && !expired ? "6" : null,
        reorder_point: saved && !expired ? "8" : null,
        target_stock: saved && !expired ? "20" : null,
        suggested_quantity: "0",
        days_of_cover: saved && !expired ? "10" : null,
        status: "healthy",
      },
    ],
  };
}
const report = {
  measuredAt: new Date().toISOString(),
  base,
  provenance:
    "Isolated headless Edge with synthetic staff/API fixtures. No live database or actual training duration claimed.",
  requests: [],
  checks: [],
  browserErrors: [],
};
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const browserPage = await context.newPage();
const page = await context.newCDPSession(browserPage);
page.evaluate = (expression) => browserPage.evaluate(expression);
page.waitFor = async (expression, label, timeout = 30_000) => {
  try {
    await browserPage.waitForFunction(expression, null, { timeout });
  } catch (cause) {
    throw new Error(`Browser readiness timed out: ${label}`, { cause });
  }
};
report.software = { edge: browser.version(), node: process.version };
page.on("Runtime.exceptionThrown", (e) => report.browserErrors.push(e.exceptionDetails?.text));
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*api/v1/*" }] });
page.on("Fetch.requestPaused", async (event) => {
  try {
    const path = new URL(event.request.url).pathname;
    report.requests.push({ method: event.request.method, path, stage });
    let data;
    let responseCode = 200;
    if (path.endsWith("/auth/me"))
      data = {
        businessId,
        userId: "synthetic-staff",
        email: "synthetic-staff@example.invalid",
        displayName: "Synthetic staff",
        role: "staff",
      };
    else if (path.endsWith("/products")) data = [product];
    else if (path.endsWith("/sales") || path.endsWith("/inventory-movements")) data = [];
    else if (path.endsWith("/settings"))
      data = {
        movingAverageWindow: 30,
        forecastHorizonDays: 7,
        targetCoverDays: 7,
        minimumHistoryWeeks: 8,
        minimumNonzeroDays: 100,
        topNProducts: 10,
        cvFolds: 3,
        timezone,
      };
    else if (path.endsWith("/forecast-status")) {
      data = { revision: stage };
      if (legacyStatus) responseCode = 404;
    } else if (path.endsWith("/forecast-dashboard")) data = dashboard();
    else data = { name: "Synthetic staff schedule verification", location: "", dataOrigin: "demo" };
    await page.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(JSON.stringify({ data })).toString("base64"),
    });
  } catch (error) {
    report.browserErrors.push(error.message);
  }
});

async function assertNoRefresh() {
  assert.equal(
    await page.evaluate(
      `[...document.querySelectorAll('button')].some(b => /refresh forecasts|updating forecasts/i.test(b.textContent))`,
    ),
    false,
  );
}
async function assertNoScheduleSentence() {
  assert.equal(
    await page.evaluate(
      `Boolean(document.querySelector('[data-forecast-schedule]')) || document.body.innerText.includes('Forecasts update daily at')`,
    ),
    false,
    "daily schedule sentence is not displayed",
  );
}
try {
  await page.send("Page.navigate", { url: base + "/forecasts" });
  await page.waitFor(
    `document.body.innerText.includes('Waiting to update forecasts')`,
    "queued status",
    120_000,
  );
  await assertNoRefresh();
  await assertNoScheduleSentence();
  report.checks.push({
    name: "staff sees queued state without Refresh or the daily schedule sentence",
    passed: true,
  });
  const fullReads = report.requests.filter((r) => r.path.endsWith("/forecast-dashboard")).length;
  const statusReads = report.requests.filter((r) => r.path.endsWith("/forecast-status")).length;
  await page.waitFor(
    "document.body.innerText.includes('Waiting to update forecasts')",
    "queued status remains available",
    20_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  assert.equal(
    report.requests.filter((r) => r.path.endsWith("/forecast-dashboard")).length,
    fullReads,
    "unchanged polls reuse the full dashboard",
  );
  assert.ok(
    report.requests.filter((r) => r.path.endsWith("/forecast-status")).length >= statusReads + 2,
  );
  report.checks.push({
    name: "unchanged five-second polls use only the smaller status request",
    passed: true,
  });
  for (const [nextStage, expected] of [
    ["running", "Updating forecasts"],
    ["completed", "Forecast saved through"],
    ["failed", "Synthetic scheduled test failure"],
    ["expired", "Forecast expired"],
  ]) {
    stage = nextStage;
    const started = performance.now();
    await page.waitFor(
      `document.body.innerText.includes(${JSON.stringify(expected)})`,
      `${stage} via existing poll`,
      20_000,
    );
    await assertNoRefresh();
    await assertNoScheduleSentence();
    report.checks.push({
      name: `${stage} updates automatically when the status revision changes`,
      passed: true,
      observedWaitMs: performance.now() - started,
    });
    if (stage === "completed") {
      const shot = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(resolve(artifacts, "staff-completed.png"), Buffer.from(shot.data, "base64"));
    }
  }
  stage = "disabled";
  const disabledStarted = performance.now();
  await page.waitFor(
    `document.body.innerText.includes('The owner can refresh forecasts after records change.')`,
    "disabled schedule owner advice via existing poll",
    20_000,
  );
  await assertNoRefresh();
  await assertNoScheduleSentence();
  report.checks.push({
    name: "disabled schedule updates owner advice through dashboard polling without a schedule sentence",
    passed: true,
    observedWaitMs: performance.now() - disabledStarted,
  });
  for (const nextStage of ["replacement_queued", "replacement_running"]) {
    stage = nextStage;
    const progress =
      stage === "replacement_queued" ? "Waiting to update forecasts" : "Updating forecasts";
    await page.waitFor(
      `document.body.innerText.includes(${JSON.stringify(progress)}) && document.body.innerText.includes('Your previous forecast is shown for now') && document.body.innerText.includes('Uses the previous 7 days of sales')`,
      `${stage} keeps the completed forecast's seven-day window`,
      20_000,
    );
    assert.equal(
      await page.evaluate("document.querySelector('#forecast-results').value"),
      product.id,
    );
    const text = await page.evaluate("document.body.innerText");
    assert.match(text, new RegExp(`Past test results for ${product.name}`));
    assert.match(text, /Uses the previous 7 days of sales/);
    assert.doesNotMatch(text, /Uses the previous 30 days of sales|Overall results/);
    report.checks.push({
      name: `${stage} preserves saved seven-day comparison settings for the selected product while current settings use thirty`,
      passed: true,
    });
  }
  stage = "legacy_window";
  await page.waitFor(
    `document.body.innerText.includes('Sales window unavailable for these results')`,
    "legacy results disclose an unavailable window",
    20_000,
  );
  assert.doesNotMatch(
    await page.evaluate("document.body.innerText"),
    /Uses the previous (?:7|30) days of sales/,
  );
  report.checks.push({
    name: "legacy completed results do not borrow the current thirty-day setting",
    passed: true,
  });
  legacyStatus = true;
  stage = "completed";
  await page.waitFor(
    `document.body.innerText.includes('Forecast saved through')`,
    "legacy API without forecast-status falls back to full reads",
    20_000,
  );
  stage = "failed";
  await page.waitFor(
    `document.body.innerText.includes('Synthetic scheduled test failure')`,
    "legacy API continues polling without a status endpoint",
    20_000,
  );
  report.checks.push({
    name: "a missing status endpoint preserves full polling for the optional demonstration API",
    passed: true,
  });
  assert.ok(report.requests.filter((r) => r.path.endsWith("/forecast-dashboard")).length >= 6);
  assert.ok(
    report.requests.every((r) => r.method === "GET"),
    "staff never submits a forecast job",
  );
  assert.deepEqual(report.browserErrors, []);
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.failure = error.stack;
  report.failurePage = await page.evaluate("document.body.innerText").catch(() => "unavailable");
  console.error(error);
  console.error(report.failurePage?.slice(0, 3000));
} finally {
  writeFileSync(resolve(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
if (report.outcome !== "passed") process.exitCode = 1;
