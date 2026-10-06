import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchEdge } from "./benchmark-browser.mjs";

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
  configuration: {
    requestedFrom: "daily_schedule",
    scheduledFor: day,
    historyThrough: relativeDay(-1),
  },
};
let stage = "queued";
function dashboard() {
  const saved = !["queued", "running"].includes(stage);
  const expired = stage === "expired";
  const run = saved ? completedRun : null;
  const latestRun =
    stage === "failed"
      ? {
          ...completedRun,
          id: "synthetic-failed-run",
          status: "failed",
          failureMessage: "Synthetic scheduled test failure",
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
const edge = await launchEdge({
  executable: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  artifactsDirectory: artifacts,
});
report.software = { ...edge.software, node: process.version };
const page = edge.page;
page.on("Runtime.exceptionThrown", (e) => report.browserErrors.push(e.exceptionDetails?.text));
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*api/v1/*" }] });
page.on("Fetch.requestPaused", async (event) => {
  try {
    const path = new URL(event.request.url).pathname;
    report.requests.push({ method: event.request.method, path, stage });
    let data;
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
        movingAverageWindow: 7,
        forecastHorizonDays: 7,
        targetCoverDays: 7,
        minimumHistoryWeeks: 8,
        minimumNonzeroDays: 100,
        topNProducts: 10,
        cvFolds: 3,
        timezone,
      };
    else if (path.endsWith("/forecast-dashboard")) data = dashboard();
    else data = { name: "Synthetic staff schedule verification", location: "", dataOrigin: "demo" };
    await page.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode: 200,
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
      `[...document.querySelectorAll('button')].some(b => /refresh forecasts|forecast queued/i.test(b.textContent))`,
    ),
    false,
  );
}
try {
  await page.send("Page.navigate", { url: base + "/forecasts" });
  await page.waitFor(
    `document.querySelector('[data-forecast-schedule]')`,
    "staff schedule",
    120_000,
  );
  const schedule = await page.evaluate(
    `document.querySelector('[data-forecast-schedule]').textContent`,
  );
  assert.match(schedule, /00:15.*Asia\/Manila/);
  await page.waitFor(
    `document.body.innerText.includes('Forecast refresh is queued')`,
    "queued status",
  );
  await assertNoRefresh();
  report.checks.push({
    name: "staff sees daily schedule and queued state without Refresh",
    passed: true,
  });
  for (const [nextStage, expected] of [
    ["running", "Forecast refresh is running"],
    ["completed", "Saved Python forecast through"],
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
    report.checks.push({
      name: `${stage} updates automatically through dashboard polling`,
      passed: true,
      observedWaitMs: performance.now() - started,
    });
    if (stage === "completed") {
      const shot = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(resolve(artifacts, "staff-completed.png"), Buffer.from(shot.data, "base64"));
    }
  }
  stage = "disabled";
  await page.waitFor(
    `!document.querySelector('[data-forecast-schedule]')`,
    "disabled schedule",
    20_000,
  );
  report.checks.push({ name: "disabled schedules do not promise daily refresh", passed: true });
  assert.ok(report.requests.filter((r) => r.path.endsWith("/forecast-dashboard")).length >= 5);
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
  await edge.close();
}
if (report.outcome !== "passed") process.exitCode = 1;
