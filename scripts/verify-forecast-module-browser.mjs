import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { preview } from "vite";
import { chromium } from "playwright";

// Run after an API-mode production build. Every API response below is synthetic.
const output = "benchmarks/forecast-module/browser";
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: "127.0.0.1", port: 0 } });
const owner = {
  userId: "forecast-test-owner",
  businessId: "forecast-test-store",
  role: "owner",
  email: "forecast@example.test",
  displayName: "Synthetic owner",
};
const day = "2026-11-13";
const date = (offset) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const products = [
  { id: "ml", sku: "ML", name: "Synthetic forecast product" },
  { id: "baseline", sku: "BASE", name: "Synthetic baseline product" },
].map((p) => ({
  ...p,
  category: "Test",
  unit: "piece",
  currentStock: "100",
  safetyStock: "5",
  unitCost: "2",
  leadTimeDays: 3,
  isActive: true,
}));
const scores = {
  moving_average: { mae: "2", rmse: "2" },
  xgboost: { mae: "1", rmse: "1" },
  ensemble: { mae: "1.5", rmse: "1.5" },
};
const methods = { moving_average: "8", xgboost: "9", ensemble: "8.5" };
const predictions = products.flatMap((p) =>
  Array.from({ length: 60 }, (_, i) => i - 30).flatMap((offset) =>
    Object.entries(p.id === "ml" ? methods : { moving_average: "8" }).map(
      ([method, predictedQuantity]) => ({
        productId: p.id,
        predictionDate: date(offset),
        method,
        datasetSplit: offset < 0 ? "final_test" : "future",
        predictedQuantity,
        actualQuantity: offset < 0 ? "10" : null,
        lowerBound: null,
        upperBound: null,
      }),
    ),
  ),
);
const run = {
  id: "forecast-test-run",
  status: "completed",
  createdAt: `${day}T00:00:00Z`,
  finalTestStart: date(-30),
  finalTestEnd: date(-1),
  forecastHorizonDays: 30,
  timing: {},
  configuration: {},
  dataSnapshot: { settings: { moving_average_window: 7 } },
};
const dashboard = {
  run,
  latestRun: run,
  stale: false,
  expired: false,
  forecastThrough: date(29),
  businessDay: day,
  businessTimezone: "Asia/Manila",
  asOf: date(-1),
  forecastSchedule: { enabled: false },
  trainingScope: {
    limit: 1,
    trainingStart: date(-180),
    trainingEnd: date(-59),
    ranking: "training_sales_volume_v1",
    products: [{ productId: "ml", rank: 1, trainingQuantity: "1500" }],
  },
  modelComparison: Object.fromEntries(
    ["validation", "finalTest"].map((key) => [
      key,
      { productIds: ["ml"], observationCount: 30, scores },
    ]),
  ),
  summaries: Object.fromEntries(
    products.map((p) => [
      p.id,
      {
        historyDays: 120,
        nonzeroDays: 120,
        eligible: p.id === "ml",
        operatingMethod: p.id === "ml" ? "xgboost" : "fallback",
        unknownDays: 0,
        excludedDays: 0,
        qualityWarnings: [],
        ...(p.id === "baseline"
          ? { fallbackReason: "Outside the saved ML product limit. Moving Average only." }
          : {}),
      },
    ]),
  ),
  predictions,
  metrics: products.flatMap((p) =>
    ["validation", "final_test"].flatMap((datasetSplit) =>
      Object.entries(p.id === "ml" ? scores : { moving_average: scores.moving_average }).map(
        ([method, score]) => ({
          productId: p.id,
          method,
          datasetSplit,
          observationCount: 30,
          ...score,
        }),
      ),
    ),
  ),
  recommendations: products.map((p) => ({
    productId: p.id,
    method: p.id === "ml" ? "xgboost" : "fallback",
    confidenceLevel: "low",
    demandAvailable: true,
    forecastExpired: false,
    daily_demand: p.id === "ml" ? "9" : "8",
    demand_during_lead_time: "27",
    reorder_point: "32",
    target_stock: "95",
    suggested_quantity: "0",
    days_of_cover: "11",
    status: "healthy",
    forecastEvidence: { status: "tested", testObservations: 30, mae: "1", rmse: "1" },
  })),
};
const report = {
  provenance:
    "Synthetic intercepted HTTP against the production frontend; no database or live writes.",
  checks: [],
  tableLayouts: [],
  chartLayouts: [],
  errors: [],
};

async function inspectForecastCandles(page, predicted = 9, hasRange = false, viewport = "1440px") {
  const candles = await page.locator(".forecast-candle").evaluateAll((elements) => {
    const gridLine = document.querySelector(".recharts-cartesian-grid-horizontal line");
    return elements.map((element) => {
      const box = element.getBBox();
      const predicted = element.querySelector(".forecast-candle-predicted");
      const actual = element.querySelector(".forecast-candle-actual");
      const wick = element.querySelector(".forecast-candle-wick");
      return {
        date: element.dataset.date,
        predicted: Number(element.dataset.predicted),
        actual: element.dataset.actual === undefined ? null : Number(element.dataset.actual),
        low: element.dataset.low === undefined ? null : Number(element.dataset.low),
        high: element.dataset.high === undefined ? null : Number(element.dataset.high),
        predictedY: Number(predicted.getAttribute("y1")),
        actualY: actual ? Number(actual.getAttribute("y1")) : null,
        wickTop: wick ? Number(wick.getAttribute("y1")) : null,
        wickBottom: wick ? Number(wick.getAttribute("y2")) : null,
        body: Boolean(element.querySelector(".forecast-candle-body")),
        x: box.x,
        width: box.width,
        left: Number(gridLine.getAttribute("x1")),
        right: Number(gridLine.getAttribute("x2")),
      };
    });
  });
  assert.equal(candles.length, 60);
  candles.forEach((candle, index) => {
    assert.equal(candle.date, date(index - 30));
    assert.equal(candle.predicted, predicted);
    assert.equal(candle.actual, index < 30 ? 10 : null);
    assert.equal(candle.body, index < 30);
    assert(
      candle.width > 0 &&
        candle.x >= candle.left - 1 &&
        candle.x + candle.width <= candle.right + 1,
    );
    if (hasRange) {
      assert.equal(candle.low, 7);
      assert.equal(candle.high, 11);
      assert(candle.wickTop < candle.predictedY && candle.predictedY < candle.wickBottom);
      if (candle.actualY !== null) {
        const pixelsPerUnit = (candle.predictedY - candle.actualY) / (10 - predicted);
        assert(Math.abs(candle.wickBottom - candle.wickTop - 4 * pixelsPerUnit) < 0.01);
      }
    } else
      assert.equal(candle.wickTop, null, "Missing saved ranges do not acquire invented whiskers");
  });
  report.chartLayouts.push({ viewport, type: "candlestick", candles });
}

async function forecastLegend(page) {
  return page.getByRole("list", { name: "Forecast chart legend" }).evaluate((list) =>
    [...list.children].map((item) => ({
      text: item.textContent,
      icons: [...item.querySelectorAll("svg > *")].map((icon) => icon.tagName),
    })),
  );
}

async function hoverForecastCandle(page, position) {
  const marker = page.locator(".forecast-candle-predicted");
  const element = position === "last" ? marker.last() : marker.first();
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y);
}

async function forecastTooltipRows(page, expectedDate) {
  const tooltip = page.locator(".recharts-tooltip-wrapper").first();
  await tooltip.waitFor({ state: "visible" });
  await tooltip
    .locator(".recharts-tooltip-label")
    .filter({ hasText: expectedDate })
    .waitFor({ state: "visible" });
  return tooltip.locator(".recharts-tooltip-item").evaluateAll((items) =>
    items.map((item) => ({
      name: item.querySelector(".recharts-tooltip-item-name").textContent,
      value: item.querySelector(".recharts-tooltip-item-value").textContent,
    })),
  );
}

async function inspectTableLayout(table, name, numericColumns) {
  const layout = await table.evaluate((element) => {
    const measure = (cell) => {
      const bounds = cell.getBoundingClientRect();
      const text = document.createRange();
      text.selectNodeContents(cell);
      const textBounds = text.getBoundingClientRect();
      const style = getComputedStyle(cell);
      return {
        label: cell.textContent.trim(),
        x: bounds.x,
        width: bounds.width,
        centerX: bounds.x + bounds.width / 2,
        centerY: bounds.y + bounds.height / 2,
        textCenterX: textBounds.x + textBounds.width / 2,
        textCenterY: textBounds.y + textBounds.height / 2,
        textAlign: style.textAlign,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
          Number.parseFloat,
        ),
      };
    };
    return {
      tableLayout: getComputedStyle(element).tableLayout,
      headers: [...element.tHead.rows[0].cells].map(measure),
      values: [...element.tBodies[0].rows[0].cells].map(measure),
    };
  });
  assert.equal(layout.tableLayout, "fixed", `${name} uses stable column widths.`);
  assert.equal(layout.headers.length, layout.values.length, `${name} header/body column count.`);
  for (let index = 0; index < layout.headers.length; index++) {
    const header = layout.headers[index];
    const value = layout.values[index];
    const column = `${name}: ${header.label}`;
    assert.deepEqual(header.padding, [12, 16, 12, 16], `${column} balanced header padding.`);
    assert.deepEqual(value.padding, header.padding, `${column} matching body padding.`);
    assert(Math.abs(header.x - value.x) <= 1, `${column} header/body start at the same x.`);
    assert(Math.abs(header.width - value.width) <= 1, `${column} header/body widths agree.`);
    assert(
      Math.abs(header.textCenterY - header.centerY) <= 3,
      `${column} heading text is vertically centered.`,
    );
    if (numericColumns.includes(index)) {
      assert.equal(header.textAlign, "center", `${column} heading alignment.`);
      assert.equal(value.textAlign, "center", `${column} numeric alignment.`);
      assert(
        Math.abs(header.textCenterX - header.centerX) <= 1,
        `${column} heading text is centered in its column.`,
      );
      assert(
        Math.abs(value.textCenterX - value.centerX) <= 1,
        `${column} numeric text is centered in its column.`,
      );
    }
  }
  report.tableLayouts.push({ name, ...layout });
  return layout;
}

async function assertMobileTableScroll(table, name) {
  await table.scrollIntoViewIfNeeded();
  const scroll = await table.evaluate((element) => {
    const container = element.closest(".record-scroll");
    const initial = {
      visibleWidth: container.clientWidth,
      contentWidth: container.scrollWidth,
      tableWidth: element.getBoundingClientRect().width,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
    container.scrollLeft = container.scrollWidth;
    const moved = container.scrollLeft;
    const finalHeading = element.tHead.rows[0].cells[element.tHead.rows[0].cells.length - 1];
    const finalBounds = finalHeading.getBoundingClientRect();
    const containerBounds = container.getBoundingClientRect();
    const lastCells = [
      finalHeading,
      ...[...element.tBodies[0].rows].map((row) => [...row.cells].at(-1)),
    ];
    const contentBounds = lastCells.flatMap((cell) => {
      const nodes = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const rectangles = [];
      while (nodes.nextNode()) {
        if (!nodes.currentNode.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(nodes.currentNode);
        rectangles.push(
          ...[...range.getClientRects()].map((rect) => ({ left: rect.left, right: rect.right })),
        );
      }
      return rectangles;
    });
    // Chromium reserves a stable gutter in clientWidth even when no vertical
    // scrollbar is needed, but its horizontal scroll limit uses the border box.
    // Check the cell against that box and its actual text against clientWidth.
    const lastColumnVisible =
      finalBounds.right <= containerBounds.right + 1 &&
      finalBounds.left >= containerBounds.left - 1;
    const lastColumnTextVisible = contentBounds.every(
      (rect) =>
        rect.left >= containerBounds.left - 1 &&
        rect.right <= containerBounds.left + container.clientWidth + 1,
    );
    container.scrollLeft = 0;
    return {
      ...initial,
      moved,
      lastColumnVisible,
      lastColumnTextVisible,
      finalColumnLeft: finalBounds.left,
      finalColumnRight: finalBounds.right,
      containerLeft: containerBounds.left,
      containerRight: containerBounds.right,
      paddingLeft: getComputedStyle(container).paddingLeft,
      paddingRight: getComputedStyle(container).paddingRight,
      contentBounds,
    };
  });
  report.tableLayouts.push({ name, viewport: "390px", scroll });
  assert(scroll.tableWidth > scroll.visibleWidth, `${name} keeps readable mobile columns.`);
  assert(scroll.contentWidth > scroll.visibleWidth, `${name} overflow stays inside its panel.`);
  assert(scroll.moved > 0, `${name} can scroll horizontally.`);
  assert(scroll.lastColumnVisible, `${name} final column can be reached.`);
  assert(scroll.lastColumnTextVisible, `${name} final-column text is fully visible.`);
  assert(scroll.pageWidth <= scroll.viewportWidth, `${name} does not widen the document.`);
}

let showGap = false;
let showRanges = false;
let archiveFailure = true;
let archiveReads = 0;
const gapArchive = predictions.map((row) => ({
  ...row,
  predictionDate: new Date(Date.parse(`${row.predictionDate}T00:00:00Z`) - 16 * 86400000)
    .toISOString()
    .slice(0, 10),
}));
function currentDashboard() {
  if (!showGap)
    return {
      ...dashboard,
      predictions: showRanges
        ? predictions.map((row) => ({ ...row, lowerBound: "7", upperBound: "11" }))
        : predictions,
    };
  const olderRun = {
    ...run,
    id: "forecast-gap-run",
    finalTestStart: date(-46),
    finalTestEnd: date(-17),
  };
  return {
    ...dashboard,
    run: olderRun,
    latestRun: olderRun,
    asOf: date(-17),
    forecastThrough: date(13),
    predictions: gapArchive.filter(
      (row) => row.datasetSplit !== "future" || row.predictionDate >= day,
    ),
  };
}
let browser;
let context;
const passed = (message) => {
  report.checks.push(message);
  console.log(message);
};
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  // Let time advance from the fixture day: freezing Date.now prevents Recharts'
  // throttled pointer handler from progressing to a second tooltip observation.
  await page.clock.install({ time: new Date(`${day}T04:00:00Z`) });
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    assert.equal(route.request().method(), "GET", `No writes expected: ${path}`);
    if (path.endsWith("/auth/options"))
      return reply({ signUpEnabled: false, googleEnabled: false });
    if (path.endsWith("/auth/google/pending")) return reply(null);
    if (path.endsWith("/auth/me")) return reply(owner);
    if (path.endsWith("/products")) return reply(products);
    if (path.endsWith("/sales")) return reply([]);
    if (path.endsWith("/settings"))
      return reply({
        businessId: owner.businessId,
        movingAverageWindow: 7,
        forecastHorizonDays: 30,
        targetCoverDays: 7,
        minimumHistoryWeeks: 8,
        minimumNonzeroDays: 100,
        topNProducts: 1,
        cvFolds: 3,
        timezone: "Asia/Manila",
      });
    if (path.endsWith(`/businesses/${owner.businessId}`))
      return reply({ name: "Synthetic test store", location: "", dataOrigin: "demo" });
    if (path.endsWith("/forecast-status")) return reply({ revision: "1" });
    if (path.endsWith("/forecast-dashboard")) return reply(currentDashboard());
    if (path.endsWith("/forecast-runs/forecast-gap-run/predictions")) {
      archiveReads++;
      if (archiveFailure)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Synthetic archive failure" }),
        });
      const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
      return reply(gapArchive.slice(offset, offset + 1000));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto(`${server.resolvedUrls.local[0]}forecasts`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Sales forecasts", exact: true }).waitFor();
  // A horizontal SVG path has a zero-height bounding box but a visible stroke.
  await page.locator(".recharts-line-curve").first().waitFor({ state: "attached" });
  await page.locator(".recharts-surface").first().waitFor();
  await page.getByText("Predicted (XGBoost)", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".recharts-line-curve").length === 2);
  assert.equal(await page.locator("#forecast-horizon").count(), 0);
  assert.equal(await page.locator("summary", { hasText: "Advanced options" }).count(), 0);
  assert.equal(await page.locator("#forecast-grain").isVisible(), true);
  assert.equal(
    await page.getByRole("checkbox", { name: "Compare models", exact: true }).isVisible(),
    true,
  );
  assert.equal(await page.locator("#forecast-metric").count(), 0);
  assert.equal(await page.getByRole("combobox", { name: "Forecast horizon unit" }).count(), 0);
  const scoresText = await page.getByRole("region", { name: "Model scores" }).innerText();
  assert.match(scoresText, /MAE 1/);
  assert.equal(await page.getByText("Chosen method", { exact: true }).count(), 2); // XGBoost card + table header.
  await page.screenshot({ path: `${output}/simplified-default.png`, fullPage: true });
  passed(
    "Daily view shows the saved 30-day forecast with Actual and the chosen prediction; View and Compare models are visible without a second horizon control.",
  );
  const chartType = page.locator("#forecast-chart-type");
  assert.equal(
    await chartType.isVisible(),
    true,
    "Chart choices are available without advanced options.",
  );
  assert.equal(await chartType.inputValue(), "line");
  assert.deepEqual(
    await chartType
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value)),
    ["line", "area", "candlestick", "step"],
  );
  const lineLegend = await forecastLegend(page);
  assert(lineLegend.every((item) => item.icons.join(",") === "line,circle"));
  await chartType.selectOption("area");
  await page
    .locator('.recharts-area-curve[name="Predicted (XGBoost)"]')
    .waitFor({ state: "attached" });
  assert.equal(await page.locator(".recharts-line-curve").count(), 0);
  for (const [name, observations] of [
    ["Actual", 30],
    ["Predicted (XGBoost)", 60],
  ]) {
    const path = await page.locator(`.recharts-area-curve[name="${name}"]`).getAttribute("d");
    assert.equal(
      (path.match(/[ML]/g) ?? []).length,
      observations,
      `${name} area uses only known observations.`,
    );
  }
  assert.equal(await page.getByRole("region", { name: "Model scores" }).innerText(), scoresText);
  assert.equal(await page.locator("#forecast-horizon").count(), 0);
  await page.screenshot({ path: `${output}/chart-area.png`, fullPage: true });
  passed(
    "Area view keeps the 30 known actual observations and all 60 saved predictions without creating future actuals or changing scores.",
  );
  assert.deepEqual(await forecastLegend(page), lineLegend);
  await chartType.selectOption("step");
  const stepPath = await page
    .locator('.recharts-line-curve[name="Predicted (XGBoost)"]')
    .getAttribute("d");
  assert(
    (stepPath.match(/[ML]/g) ?? []).length > 60,
    "Step draws horizontal/vertical segments between saved dates",
  );
  assert.deepEqual(await forecastLegend(page), lineLegend);
  assert.equal(await page.getByRole("region", { name: "Model scores" }).innerText(), scoresText);
  await page.screenshot({ path: `${output}/chart-step.png`, fullPage: true });
  await chartType.selectOption("candlestick");
  await page.locator(".forecast-candle").first().waitFor();
  await inspectForecastCandles(page);
  assert.deepEqual(await forecastLegend(page), lineLegend);
  assert.equal(await page.locator(".recharts-bar").count(), 0);
  await hoverForecastCandle(page, "first");
  const pastTooltip = await forecastTooltipRows(page, date(-30));
  assert.deepEqual(
    pastTooltip.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "Actual", value: "10" },
      { name: "Predicted (XGBoost)", value: "9" },
    ],
  );
  await hoverForecastCandle(page, "last");
  assert.deepEqual(await forecastTooltipRows(page, date(29)), [
    { name: "Predicted (XGBoost)", value: "9" },
  ]);
  await page.screenshot({ path: `${output}/chart-candlestick.png`, fullPage: true });
  await page.getByRole("checkbox", { name: "Compare models", exact: true }).check();
  await page.waitForFunction(() => document.querySelectorAll(".recharts-line-curve").length === 4);
  await inspectForecastCandles(page);
  assert.equal(await page.getByRole("region", { name: "Model scores" }).innerText(), scoresText);
  await page.screenshot({ path: `${output}/chart-candlestick-comparison.png`, fullPage: true });
  await page.getByRole("checkbox", { name: "Compare models", exact: true }).uncheck();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await chartType.inputValue(), "candlestick");
  const savedView = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    `stockcast-forecast-view:${owner.businessId}:${owner.userId}`,
  );
  assert.equal(savedView.chartType, "candlestick");
  assert.equal(savedView.days, undefined);
  assert.equal(savedView.compare, false);
  const originalUserId = owner.userId;
  owner.userId = "forecast-test-other-owner";
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await chartType.inputValue(),
    "line",
    "Another account starts with its own chart preferences.",
  );
  owner.userId = originalUserId;
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await chartType.inputValue(),
    "candlestick",
    "Returning to the original account restores its chart preference.",
  );
  await chartType.selectOption("line");
  await page.waitForFunction(() => document.querySelectorAll(".recharts-line-curve").length === 2);
  const restoredLine = await page
    .locator('.recharts-line-curve[name="Predicted (XGBoost)"]')
    .getAttribute("d");
  assert.equal((restoredLine.match(/[ML]/g) ?? []).length, 60);
  assert.equal(await page.getByRole("region", { name: "Model scores" }).innerText(), scoresText);
  passed(
    "Candlestick and Step preserve actual/forecast quantities, omit future actuals, fit end markers and share the Line legend. Model comparison and per-account preferences remain available without changing scores or horizon.",
  );
  showRanges = true;
  await chartType.selectOption("candlestick");
  await page.reload({ waitUntil: "networkidle" });
  await inspectForecastCandles(page, 9, true);
  assert.equal(await page.locator(".forecast-candle-wick").count(), 60);
  await page
    .getByRole("list", { name: "Forecast chart legend" })
    .getByText("Estimated sales range", { exact: true })
    .waitFor();
  await page.screenshot({ path: `${output}/chart-candlestick-ranges.png`, fullPage: true });
  const preferenceKey = `stockcast-forecast-view:${owner.businessId}:${owner.userId}`;
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...saved, chartType: "bar" }));
  }, preferenceKey);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await chartType.inputValue(), "candlestick");
  await chartType.selectOption("step");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await chartType.inputValue(), "step");
  showRanges = false;
  await chartType.selectOption("line");
  await page.reload({ waitUntil: "networkidle" });
  passed(
    "Candles render exact saved range endpoints without inventing OHLC values; removed Bar preferences migrate to Candlestick and Step survives reload.",
  );
  const topProductsTable = page.getByRole("table", {
    name: "Top products for XGBoost",
    exact: true,
  });
  const errorTable = page.getByRole("table", {
    name: "Past forecast errors by product",
    exact: true,
  });
  await inspectTableLayout(topProductsTable, "Top products for XGBoost", [0, 2, 3]);
  const errorLayout = await inspectTableLayout(
    errorTable,
    "Past forecast errors by product",
    [1, 2, 3, 4],
  );
  assert.equal(await errorTable.locator("tbody tr").count(), 2);
  await page.getByRole("textbox", { name: "Search forecast errors", exact: true }).fill("baseline");
  await page.waitForFunction(
    () =>
      document.querySelectorAll('table[aria-label="Past forecast errors by product"] tbody tr')
        .length === 1,
  );
  const filteredErrorLayout = await inspectTableLayout(
    errorTable,
    "Past forecast errors filtered to one product",
    [1, 2, 3, 4],
  );
  errorLayout.headers.forEach((header, index) => {
    assert(
      Math.abs(header.width - filteredErrorLayout.headers[index].width) <= 1,
      `Filtering must preserve the ${header.label} column width.`,
    );
  });
  await page.getByRole("textbox", { name: "Search forecast errors", exact: true }).fill("");
  assert.equal(await errorTable.locator("tbody tr").count(), 2);
  passed(
    "Both forecast tables have balanced heading/body padding, matching column bounds, centered numeric values and vertically centered headings; filtering preserves column widths.",
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "Compare models", exact: true }).isChecked(),
    false,
  );
  await page.locator("#forecast-grain").selectOption("monthly");
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith("stockcast-forecast-view:"));
    if (!key) throw new Error("Missing chart preferences");
    localStorage.setItem(
      key,
      JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), days: 14 }),
    );
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Chart options", exact: true }).waitFor();
  assert.equal(await page.locator("#forecast-horizon").count(), 0);
  assert.equal(await page.locator("#forecast-grain").inputValue(), "monthly");
  await page.getByText("Partial periods are incomplete", { exact: false }).waitFor();
  await page.screenshot({ path: `${output}/monthly-persisted.png`, fullPage: true });
  await page.locator("#forecast-grain").selectOption("daily");
  const savedPath = await page
    .locator('.recharts-line-curve[name="Predicted (XGBoost)"]')
    .getAttribute("d");
  assert.equal((savedPath.match(/[ML]/g) ?? []).length, 60);
  assert.equal(await page.getByRole("region", { name: "Model scores" }).innerText(), scoresText);
  passed(
    "Monthly view persists; obsolete 14-day preferences cannot hide any saved predictions or change model scores.",
  );
  await page.getByRole("checkbox", { name: "Compare models", exact: true }).check();
  await page.waitForFunction(() => document.querySelectorAll(".recharts-line-curve").length === 4);
  await page.screenshot({ path: `${output}/chart-options.png`, fullPage: true });
  passed("Compare models shows all three methods without changing scores or saving settings.");
  await page.getByRole("checkbox", { name: "Compare models", exact: true }).uncheck();
  await page.getByText("Predicted (XGBoost)", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".recharts-line-curve").length === 2);
  assert.equal(await page.locator(".recharts-line-curve").count(), 2);
  const selectedPath = await page.locator(".recharts-line-curve").first().getAttribute("d");
  assert(selectedPath?.includes("L"));
  passed("Disabling comparison keeps Actual and the chosen XGBoost prediction visible.");
  await page.locator("#forecast-grain").selectOption("weekly");
  await page.getByText("Partial periods are incomplete", { exact: false }).waitFor();
  assert.equal(await page.locator(".recharts-line-curve").count(), 2);
  const actualWeekly = await page.locator('.recharts-line-curve[name="Actual"]').getAttribute("d");
  const weeklyY = [...actualWeekly.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((match) => match[1]);
  assert(
    new Set(weeklyY).size > 1,
    "Partial and complete weeks must have different actual totals.",
  );
  await page.screenshot({ path: `${output}/weekly.png`, fullPage: true });
  passed("Weekly view preserves both series and explains partial weeks.");
  await page.getByRole("button", { name: "Synthetic forecast product", exact: true }).click();
  await page.getByRole("option", { name: "Synthetic baseline product", exact: true }).click();
  await page.getByText("Predicted (Moving Average)", { exact: true }).waitFor();
  assert.equal(await page.locator(".recharts-line-curve").count(), 2);
  passed("Switching to a baseline product uses its Moving Average and retains actual sales.");
  await page.locator("#forecast-grain").selectOption("daily");
  await page.setViewportSize({ width: 390, height: 844 });
  await chartType.selectOption("candlestick");
  await page.locator(".forecast-candle").first().waitFor();
  await inspectForecastCandles(page, 8, false, "390px");
  await chartType.selectOption("step");
  assert.deepEqual(await forecastLegend(page), [
    { text: "Actual", icons: ["line", "circle"] },
    { text: "Predicted (Moving Average)", icons: ["line", "circle"] },
  ]);
  await chartType.selectOption("area");
  await page
    .locator('.recharts-area-curve[name="Predicted (Moving Average)"]')
    .waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await chartType.selectOption("line");
  await page.waitForFunction(() => document.querySelectorAll(".recharts-line-curve").length === 2);
  passed(
    "Candlestick, Step and Area work at 390px with consistent legends, unclipped markers, and no horizontal page overflow.",
  );
  await assertMobileTableScroll(topProductsTable, "Top products for XGBoost");
  await assertMobileTableScroll(errorTable, "Past forecast errors by product");
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(report.errors, []);
  passed("The 390px layout has no horizontal page overflow or browser exceptions.");
  passed(
    "Both forecast tables keep readable columns on mobile and scroll internally to the final column without widening the document.",
  );
  showGap = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByText("Earlier saved predictions could not be loaded.", { exact: false })
    .waitFor();
  assert.equal(archiveReads, 1);
  archiveFailure = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page
    .getByText("Includes earlier saved forecasts.", { exact: true })
    .waitFor();
  assert.equal(archiveReads, 2);
  const path = await page
    .locator('.recharts-line-curve[name="Predicted (XGBoost)"]')
    .getAttribute("d");
  assert.equal(
    (path.match(/M/g) ?? []).length,
    1,
    "The 16 elapsed days must not break the saved prediction line.",
  );
  assert.equal(
    (path.match(/[ML]/g) ?? []).length,
    60,
    "Every plotted quantity must come from a test or saved forecast date.",
  );
  assert.equal(await page.getByRole("region", { name: "Model scores" }).innerText(), scoresText);
  await page.getByText("Expected daily sales: 9.0 piece", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/restored-history.png`, fullPage: true });
  passed(
    "A failed archive read retries and fills all 16 elapsed dates with saved predictions, preserving scores and daily demand.",
  );
  await page.getByRole("button", { name: "Synthetic forecast product", exact: true }).click();
  await page.getByRole("option", { name: "Synthetic baseline product", exact: true }).click();
  await page
    .getByText("Includes earlier saved forecasts.", { exact: true })
    .waitFor();
  await page.getByText("Expected daily sales: 8.0 piece", { exact: true }).waitFor();
  await page.getByText("Predicted (Moving Average)", { exact: true }).waitFor();
  assert.equal(archiveReads, 2, "Switching products reuses the same run's history.");
  await page.getByRole("checkbox", { name: "Compare models", exact: true }).check();
  await page.locator('.recharts-line-curve[name="Moving Average"]').waitFor({ state: "attached" });
  assert.equal(
    await page
      .locator('.recharts-line-curve[name="XGBoost"]')
      .evaluateAll((nodes) => nodes.every((node) => !node.getAttribute("d"))),
    true,
    "Unavailable XGBoost values must not draw a path.",
  );
  assert.equal(await page.locator('.recharts-line-curve[name="Moving Average"]').count(), 1);
  assert.deepEqual(report.errors, []);
  passed("Switching products reuses saved history and keeps unavailable model lines absent.");
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
