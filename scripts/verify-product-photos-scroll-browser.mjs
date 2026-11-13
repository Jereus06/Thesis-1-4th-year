import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { preview } from "vite";
import { chromium } from "playwright";

// Production frontend, synthetic intercepted HTTP only. PostgreSQL is tested separately.
const output = "benchmarks/product-photos-scroll";
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: "127.0.0.1", port: 0 } });
const base = server.resolvedUrls.local[0];
const owner = {
  userId: "photo-owner",
  businessId: "photo-store",
  role: "owner",
  email: "owner@example.test",
  displayName: "Synthetic owner",
};
let role = "owner",
  revision = 0,
  failUpload = false;
const photos = new Map();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const products = Array.from({ length: 120 }, (_, i) => ({
  id: `p${i}`,
  sku: `SYN-${i.toString().padStart(3, "0")}`,
  name: `Synthetic item ${i.toString().padStart(3, "0")}`,
  category: i < 80 ? "Battery" : `Category ${i}`,
  unit: "piece",
  currentStock: "0",
  safetyStock: "5",
  unitCost: "2",
  leadTimeDays: 3,
  isActive: true,
}));
products[119].name +=
  " with a long product description and an unbroken identifier ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
products[119].unit = "unbrokencountingunitlabelthatisexactlyfiftycharacters".slice(0, 50);
for (const [index, unit] of [
  [118, "bottle"],
  [117, "can"],
  [116, "set"],
  [115, "kit"],
])
  products[index].unit = unit;
products[0].unitCost = "1234567.89";
const sales = products.flatMap((p, i) =>
  Array.from({ length: 3 }, (_, day) => ({
    id: `s${i}-${day}`,
    productId: p.id,
    saleDate: `2026-11-${11 + day}`,
    quantity: "1",
    source: "manual",
  })),
);
const movements = Array.from({ length: 155 }, (_, i) => ({
  id: `m${i}`,
  productId: products[i % 120].id,
  movementDate: "2026-11-12",
  movementType: "opening_balance",
  quantityDelta: "1",
  balanceAfter: "1",
  note: `Synthetic movement ${i}`,
  recordedBy: owner.displayName,
  recordedByUserId: owner.userId,
}));
const settings = {
  businessId: owner.businessId,
  movingAverageWindow: 7,
  forecastHorizonDays: 30,
  targetCoverDays: 7,
  minimumHistoryWeeks: 8,
  minimumNonzeroDays: 100,
  topNProducts: 1,
  cvFolds: 3,
  timezone: "Asia/Manila",
};
const report = {
  provenance:
    "Synthetic intercepted HTTP; no live records, physical camera or database simulated as verified.",
  checks: [],
  errors: [],
  writes: [],
};
const passed = (message) => {
  report.checks.push(message);
  console.log(message);
};
async function expectUnitQuantity(unit, value) {
  const entries = await page
    .getByRole("region", { name: "Sales summary" })
    .locator("dl > div")
    .evaluateAll((rows) =>
      Object.fromEntries(
        rows.map((row) => [
          row.querySelector("dt").textContent.trim(),
          row.querySelector("dd").textContent.trim(),
        ]),
      ),
    );
  assert.equal(entries[unit], value);
}
async function inspectSummaryCards(viewport) {
  const cards = await page
    .getByRole("region", { name: "Sales summary" })
    .getByRole("group")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label"),
          height: box.height,
          width: box.width,
          overflow: element.scrollWidth > element.clientWidth,
          text: element.innerText,
        };
      }),
    );
  assert.equal(cards.length, 4);
  assert(
    Math.max(...cards.map((card) => card.height)) - Math.min(...cards.map((card) => card.height)) <=
      1,
    "Summary cards share equal heights",
  );
  assert(
    cards.every((card) => !card.overflow),
    "Large currency and long units stay within cards",
  );
  report.summaryLayouts ??= [];
  report.summaryLayouts.push({ viewport, cards });
}
async function checkPieLabels() {
  const result = await page
    .locator('[aria-label="Product share of sales records"]')
    .evaluate((element) => {
      const svg = element.querySelector("svg").getBoundingClientRect();
      const slices = [...element.querySelectorAll(".recharts-pie-sector path")].map((path) =>
        path.getBoundingClientRect(),
      );
      const circle = {
        left: Math.min(...slices.map((r) => r.left)),
        right: Math.max(...slices.map((r) => r.right)),
      };
      const labels = [...element.querySelectorAll(".sales-pie-percentage text")].map((text) => {
        const r = text.getBoundingClientRect();
        return {
          text: text.textContent,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        };
      });
      return {
        labels,
        circle,
        svg: { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom },
      };
    });
  assert.equal(result.labels.length, 8);
  for (const label of result.labels) {
    assert(label.text.endsWith("%"));
    assert(
      label.right <= result.circle.left + 1 || label.left >= result.circle.right - 1,
      "Percentage is outside the circle",
    );
    assert(
      label.left >= result.svg.left - 1 &&
        label.right <= result.svg.right + 1 &&
        label.top >= result.svg.top - 1 &&
        label.bottom <= result.svg.bottom + 1,
      "Labels fit within the chart",
    );
  }
  for (let i = 0; i < result.labels.length; i++)
    for (let j = i + 1; j < result.labels.length; j++) {
      const a = result.labels[i],
        b = result.labels[j];
      assert(
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        "Percentage labels do not overlap",
      );
    }
  assert.equal(
    await page.locator(".recharts-pie-sector").last().locator("path").getAttribute("fill"),
    "#7BA3AE",
  );
  report.pieLabelLayouts ??= [];
  report.pieLabelLayouts.push(result);
}
let browser, context, page;
async function tableAligned(table, centered = []) {
  const problems = await table.evaluate((element, numeric) => {
    const headers = [...element.querySelectorAll("thead th")];
    const cells = [...element.querySelectorAll("tbody tr:first-child td")];
    const rangeBox = (cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return range.getBoundingClientRect();
    };
    return headers.flatMap((header, index) => {
      const label = rangeBox(header),
        value = rangeBox(cells[index]);
      const bounds = header.getBoundingClientRect(),
        body = cells[index].getBoundingClientRect();
      const issues = [];
      if (Math.abs(bounds.x - body.x) > 1 || Math.abs(bounds.width - body.width) > 1)
        issues.push(`Column ${index} cells differ`);
      if (Math.abs(label.y + label.height / 2 - bounds.y - bounds.height / 2) > 2)
        issues.push(`Heading ${index} is off-center vertically`);
      if (
        numeric.includes(index) &&
        Math.abs(label.x + label.width / 2 - value.x - value.width / 2) > 1
      )
        issues.push(`Column ${index} quantities differ in alignment`);
      return issues;
    });
  }, centered);
  assert.deepEqual(problems, []);
}
async function bounded(locator, label) {
  const box = await locator.evaluate((el) => ({
    height: el.clientHeight,
    content: el.scrollHeight,
    overflow: getComputedStyle(el).overflowY,
    overscroll: getComputedStyle(el).overscrollBehaviorY,
  }));
  assert(
    box.height > 0 && box.height <= 780,
    `${label} has bounded height: ${JSON.stringify(box)}`,
  );
  assert(box.content > box.height, `${label} actually scrolls: ${JSON.stringify(box)}`);
  assert.equal(box.overflow, "auto");
  assert.equal(box.overscroll, "auto", `${label} allows scrolling to reach its parent`);
  await locator.focus();
  await locator.press("End");
  await locator.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  assert(await locator.evaluate((el) => el.scrollTop > 0), `${label} reaches lower rows`);
  const opaqueHeaders = await locator.locator("thead th, thead td").evaluateAll((cells) =>
    cells.every((cell) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      context.fillStyle = getComputedStyle(cell).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] === 255;
    }),
  );
  assert(opaqueHeaders, `${label} has opaque heading cells`);
}

async function wheelAtEdge(locator, edge) {
  await locator.evaluate((el, at) => {
    el.scrollTop = at === "top" ? 0 : el.scrollHeight;
    el.scrollIntoView({ block: "center" });
  }, edge);
  if (edge === "bottom") await page.evaluate(() => scrollBy(0, -120));
  const box = await locator.boundingBox();
  assert(box && box.y > 0 && box.y < 1000, "Scrollable box is in the viewport");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(100, box.height / 2));
  const before = await page.evaluate(() => scrollY);
  assert(
    edge === "top"
      ? before > 0
      : await page.evaluate(() => scrollY + innerHeight < document.documentElement.scrollHeight),
    "The page has room to scroll",
  );
  await page.mouse.wheel(0, edge === "top" ? -260 : 260);
  await page.waitForFunction(
    ({ previous, at }) => (at === "top" ? scrollY < previous : scrollY > previous),
    { previous: before, at: edge },
  );
}
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    window.__cameraTest = { streams: [], requests: [], failure: null, hold: false, release: null };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const test = window.__cameraTest;
      test.requests.push(constraints);
      if (test.failure) throw new DOMException("Synthetic camera failure", test.failure);
      const stream = await original(constraints);
      test.streams.push(stream);
      if (test.hold)
        await new Promise((resolve) => {
          test.release = resolve;
        });
      return stream;
    };
  });
  await context.addCookies([{ name: "stockcast_csrf", value: "synthetic-photo-csrf", url: base }]);
  page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-13T04:00:00Z"));
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const reply = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (path.endsWith("/photo")) {
      const id = path.split("/").at(-2);
      if (request.method() === "GET")
        return route.fulfill({
          status: photos.has(id) ? 200 : 404,
          contentType: "image/png",
          body: png,
        });
      assert.equal(request.headers()["x-csrf-token"], "synthetic-photo-csrf");
      assert.equal(role, "owner");
      report.writes.push({ method: request.method(), path });
      if (failUpload)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Synthetic upload failure" }),
        });
      if (request.method() === "PUT") {
        const bytes = request.postDataBuffer();
        if (request.headers()["content-type"] === "image/jpeg") {
          assert(
            bytes.length > 1000 && bytes[0] === 255 && bytes[1] === 216,
            "Camera sends a real captured JPEG",
          );
        } else assert.deepEqual(bytes, png, "Send binary file bytes, not JSON");
        const metadata = {
          productId: id,
          updatedAt: `2026-11-13T00:00:${String(++revision).padStart(2, "0")}Z`,
        };
        photos.set(id, metadata);
        return reply(metadata);
      }
      assert.equal(request.method(), "DELETE");
      return reply({ deleted: photos.delete(id) });
    }
    assert.equal(request.method(), "GET", `Unexpected write ${path}`);
    if (path.endsWith("/auth/options"))
      return reply({ signUpEnabled: false, googleEnabled: false });
    if (path.endsWith("/auth/google/pending")) return reply(null);
    if (path.endsWith("/auth/me")) return reply({ ...owner, role });
    if (path.endsWith("/auth/members"))
      return reply(
        Array.from({ length: 80 }, (_, i) => ({
          id: `u${i}`,
          email: `staff${i}@example.test`,
          displayName: `Synthetic staff ${i}`,
          role: "staff",
          isActive: true,
        })),
      );
    if (path.endsWith("/auth/activity")) return reply({ events: [], nextCursor: null });
    if (path.endsWith("/settings")) return reply(settings);
    if (path.endsWith(`/businesses/${owner.businessId}`))
      return reply({ name: "Synthetic photo test", location: "", dataOrigin: "demo" });
    if (path.endsWith("/products")) return reply(products);
    if (path.endsWith("/product-photos")) return reply([...photos.values()]);
    if (path.endsWith("/sales")) return reply(sales);
    if (path.endsWith("/inventory-movements")) return reply(movements);
    if (path.endsWith("/data-quality"))
      return reply(
        Array.from({ length: 80 }, (_, i) => ({
          productId: products[i].id,
          classificationDate: "2026-11-12",
          classification: "confirmed_zero",
          note: `Synthetic review ${i}`,
        })),
      );
    if (path.endsWith("/forecast-status")) return reply({ revision: "1" });
    if (path.endsWith("/forecast-dashboard"))
      return reply({
        run: null,
        latestRun: null,
        stale: false,
        expired: false,
        asOf: null,
        forecastThrough: null,
        businessDay: "2026-11-13",
        businessTimezone: "Asia/Manila",
        summaries: {},
        predictions: [],
        metrics: [],
        recommendations: [],
      });
    throw new Error(`Unexpected request ${path}`);
  });
  await page.goto(`${base}sales-report`, { waitUntil: "networkidle" });
  const ambient = page.locator(".ambient-background");
  assert.equal(await ambient.getAttribute("aria-hidden"), "true");
  assert.equal(
    await ambient.evaluate((element) => getComputedStyle(element).pointerEvents),
    "none",
  );
  await page.getByRole("button", { name: "Pause background motion", exact: true }).click();
  assert.equal(await ambient.getAttribute("data-paused"), "true");
  assert(
    await page
      .locator(".ambient-background__glow")
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).animationPlayState === "paused"),
      ),
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Resume background motion", exact: true }).waitFor();
  assert.equal(await ambient.getAttribute("data-paused"), "true");
  await page.getByRole("button", { name: "Resume background motion", exact: true }).click();
  assert.equal(await ambient.getAttribute("data-paused"), "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Background motion reduced", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Background motion reduced", exact: true }).isDisabled(),
  );
  assert(
    await page
      .locator(".ambient-background__glow")
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).animationName === "none"),
      ),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Pause background motion", exact: true }).waitFor();
  await page.emulateMedia({ media: "print" });
  assert.equal(await ambient.evaluate((element) => getComputedStyle(element).display), "none");
  await page.emulateMedia({ media: "screen" });
  await inspectSummaryCards("1440px");
  passed(
    "Ambient background is decorative and cannot intercept input; pause/resume survives reload, OS reduced motion stops animation, and print omits the decoration.",
  );
  await page.getByRole("button", { name: "Product", exact: true }).click();
  const option = page.getByRole("option", { name: /Synthetic item 000/ });
  await option.waitFor();
  assert(
    await option.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }),
    "Dropdown options are above the summary cards",
  );
  await page.screenshot({ path: `${output}/sales-report-dropdown.png`, fullPage: true });
  await page.getByPlaceholder("Search name or SKU").fill("SYN-079");
  await page.getByRole("option", { name: /Synthetic item 079/ }).click();
  const performance = page.getByRole("table", { name: "Product performance", exact: true });
  await tableAligned(performance, [1, 2, 3]);
  assert.match(await performance.locator("tbody").innerText(), /3 piece/);
  await page.screenshot({ path: `${output}/product-performance-balanced.png`, fullPage: true });
  passed("Sales report dropdown remains above summary cards and search/select works.");

  const dateMode = page.getByRole("group", { name: "Report date selection mode" });
  const salesSummary = page.getByRole("region", { name: "Sales summary" });
  assert.equal(
    await dateMode.getByRole("button", { name: "Date range" }).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.getByLabel("From", { exact: true }).inputValue(), "2026-11-11");
  assert.equal(await page.getByLabel("To", { exact: true }).inputValue(), "2026-11-13");
  await expectUnitQuantity("piece", "3");
  await dateMode.getByRole("button", { name: "Single day" }).click();
  assert.equal(await page.getByLabel("Sales date").inputValue(), "2026-11-13");
  await expectUnitQuantity("piece", "1");
  await page.getByLabel("Sales date").fill("2026-11-12");
  const chartType = page.getByLabel("Chart type", { exact: true });
  for (const type of ["line", "area"]) {
    await chartType.selectOption(type);
    await page.waitForFunction(
      () => document.querySelectorAll(".recharts-line-dot, .recharts-area-dot").length > 0,
    );
    assert.equal(
      await page.locator(".recharts-line-dot, .recharts-area-dot").count(),
      1,
      "One-day charts have one visible point",
    );
    const dot = await page.locator(".recharts-line-dot, .recharts-area-dot").first().boundingBox();
    assert(dot && dot.width > 0 && dot.height > 0, "The one-day point is visible");
  }
  await chartType.selectOption("bar");
  await page.locator(".recharts-bar-rectangle").first().waitFor();
  assert.equal(await page.locator(".recharts-bar-rectangle").count(), 1);
  await chartType.selectOption("pie");
  await page.locator(".recharts-pie-sector").first().waitFor();
  assert.equal(await page.locator(".recharts-pie-sector").count(), 1);
  await page
    .getByText("Each slice shows a product's share of sales records in the selected period.", {
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: `${output}/sales-report-single-day-pie.png`, fullPage: true });
  await dateMode.getByRole("button", { name: "Date range" }).click();
  assert.equal(await page.getByLabel("From", { exact: true }).inputValue(), "2026-11-11");
  assert.equal(await page.getByLabel("To", { exact: true }).inputValue(), "2026-11-13");
  await expectUnitQuantity("piece", "3");
  await chartType.selectOption("line");
  await page.waitForFunction(() => document.querySelectorAll(".recharts-line-dot").length === 3);
  await page.getByLabel("To", { exact: true }).fill("2026-11-11");
  await expectUnitQuantity("piece", "1");
  assert.match(await performance.locator("tbody").innerText(), /1 piece/);
  await page.getByLabel("To", { exact: true }).fill("2026-11-13");
  await page.getByLabel("From", { exact: true }).fill("2026-11-12");
  await expectUnitQuantity("piece", "2");
  await page.getByLabel("To", { exact: true }).fill("2026-11-11");
  await page
    .getByText("Choose a valid date range ending on or before today.", { exact: true })
    .waitFor();
  assert.equal(await salesSummary.count(), 0, "Invalid ranges cannot show stale totals");
  await page.getByLabel("To", { exact: true }).fill("2026-11-14");
  assert.equal(await salesSummary.count(), 0, "Future dates are rejected");
  await page.getByLabel("From", { exact: true }).fill("2026-11-11");
  await page.getByLabel("To", { exact: true }).fill("2026-11-13");
  await dateMode.getByRole("button", { name: "Single day" }).click();
  assert.equal(await page.getByLabel("Sales date").inputValue(), "2026-11-12");
  await page.getByLabel("Sales date").fill("");
  await page.getByText("Choose a valid sales date on or before today.", { exact: true }).waitFor();
  assert.equal(await salesSummary.count(), 0);
  await page.getByLabel("Sales date").fill("2026-11-10");
  await page.getByText("No sales match these filters.", { exact: true }).waitFor();
  assert.equal(await page.locator(".recharts-line-curve").count(), 0);
  await dateMode.getByRole("button", { name: "Date range" }).click();
  passed(
    "Single-day and inclusive range filters update every report total and ranking, preserve separate drafts, reject invalid/future dates, and keep one-day Line/Area points visible.",
  );

  await page.getByRole("button", { name: "Product", exact: true }).click();
  await page.getByRole("option", { name: "All products", exact: true }).click();
  await chartType.selectOption("pie");
  await page.waitForFunction(() => document.querySelectorAll(".recharts-pie-sector").length === 8);
  await page.getByText(/^Other products \(113\):/).waitFor();
  const sectors = await page.locator(".recharts-pie-sector").evaluateAll((elements) =>
    elements.map((el) => {
      const key = Object.keys(el).find((name) => name.startsWith("__reactProps$"));
      const props = el[key];
      return props?.children?.props?.payload;
    }),
  );
  report.salesReportPie = sectors;
  assert.equal(
    sectors.reduce((sum, sector) => sum + sector.records, 0),
    360,
  );
  assert.equal(sectors.at(-1).records, 339);
  assert(Math.abs(sectors.reduce((sum, sector) => sum + sector.percentage, 0) - 100) < 1e-9);
  assert.equal(
    await page.getByRole("list", { name: "Product share legend" }).getByRole("listitem").count(),
    8,
  );
  await checkPieLabels();
  await page.setViewportSize({ width: 390, height: 844 });
  await checkPieLabels();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/sales-report-pie-mobile.png`, fullPage: true });
  await chartType.selectOption("bar");
  assert.equal(
    await page.locator(".recharts-bar").count(),
    6,
    "Different counting units have separate chart series",
  );
  await expectUnitQuantity("piece", "345");
  await expectUnitQuantity(products[119].unit, "3");
  await inspectSummaryCards("390px");
  const unitList = page
    .getByRole("region", { name: "Sales summary" })
    .getByLabel("Units sold by counting unit");
  assert(await unitList.evaluate((element) => element.scrollHeight > element.clientHeight));
  await unitList.focus();
  await unitList.press("End");
  await page.waitForFunction(() => {
    const list = document.querySelector('dl[aria-label="Units sold by counting unit"]');
    return (
      list && list.scrollTop > 0 && list.scrollTop + list.clientHeight >= list.scrollHeight - 1
    );
  });
  await unitList.evaluate((element) => {
    element.scrollTop = 0;
    element.blur();
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(1, 1);
  assert.equal(await unitList.evaluate((element) => element.scrollTop), 0);
  await page.screenshot({ path: `${output}/ui-refresh-mobile.png`, fullPage: true });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await inspectSummaryCards(`${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNav = page.locator(".app-mobile-nav");
  assert.equal(await mobileNav.getByRole("link").count(), 7);
  const navRows = await mobileNav
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
  assert(
    Math.max(...navRows) - Math.min(...navRows) <= 1,
    "All seven navigation links occupy one row",
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(1, 1);
  await page.screenshot({ path: `${output}/ui-refresh-desktop.png`, fullPage: true });
  passed(
    "Summary cards have equal heights, separate scrollable counting-unit rows and readable large values at 1440/768/390/320px; mobile navigation keeps all seven links on one row.",
  );
  passed(
    "Sales report offers Bar, Line, Area and product-share Pie charts; large product lists use seven slices plus Other and fit mobile screens.",
  );
  passed(
    "Every pie percentage sits outside the circle without overlaps or clipping on desktop and mobile; Other is muted blue and matches its legend.",
  );

  await page.getByRole("button", { name: "Record sale", exact: true }).click();
  const saleDialog = page.getByRole("dialog", { name: "Record a sale", exact: true });
  const saleSearch = saleDialog.getByRole("combobox", { name: "Search products", exact: true });
  const saleProduct = saleDialog.getByLabel("Product", { exact: true });
  assert.equal(await saleSearch.count(), 0, "Search is inside the closed Product dropdown");
  const originalSelection = await saleProduct.getAttribute("data-product-id");
  await saleProduct.click();
  await saleSearch.waitFor();
  assert.equal(await saleSearch.evaluate((element) => document.activeElement === element), true);
  const saleOptions = saleDialog.getByRole("listbox", { name: "Products", exact: true });
  assert.equal(await saleOptions.getByRole("option").count(), 120);
  assert(
    await saleOptions.evaluate(
      (element) => element.scrollHeight > element.clientHeight && element.clientHeight <= 201,
    ),
  );
  await saleSearch.fill(" syn-079 ");
  assert.equal(await saleProduct.getAttribute("data-product-id"), originalSelection);
  assert.equal(await saleOptions.getByRole("option").count(), 1);
  await saleOptions.getByRole("option", { name: /SYN-079/ }).click();
  assert.equal(await saleProduct.getAttribute("data-product-id"), "p79");
  assert.equal(await saleSearch.count(), 0);
  await saleProduct.click();
  await saleSearch.fill("ITEM 019");
  assert.equal(
    await saleProduct.getAttribute("data-product-id"),
    "p79",
    "Searching alone cannot change the product being sold",
  );
  assert(await saleOptions.getByRole("option", { name: /SYN-019/ }).count());
  await saleSearch.press("ArrowDown");
  await saleSearch.press("Enter");
  assert.equal(await saleProduct.evaluate((element) => document.activeElement === element), true);
  assert.equal(await saleProduct.getAttribute("data-product-id"), "p19");
  assert.equal(report.writes.length, 0, "Search does not submit a sale");
  await saleProduct.click();
  await saleSearch.fill("no product matches this");
  await saleDialog.getByText("No matching products", { exact: true }).waitFor();
  assert.equal(await saleProduct.getAttribute("data-product-id"), "p19");
  assert.equal(await saleOptions.getByRole("option").count(), 0);
  await saleSearch.press("Escape");
  assert.equal(await saleSearch.count(), 0);
  assert(await saleDialog.isVisible(), "Escape dismisses dropdown before the sale dialog");
  await saleProduct.click();
  await saleProduct.focus();
  await saleProduct.press("End");
  assert(await saleOptions.evaluate((element) => element.scrollTop > 0));
  await saleDialog.getByLabel("Date", { exact: true }).click();
  assert.equal(await saleSearch.count(), 0, "Outside click closes only the dropdown");
  await saleDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Record sale", exact: true }).click();
  assert.equal(await saleSearch.count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await saleProduct.click();
  assert.equal(await saleSearch.inputValue(), "");
  assert.equal(await saleOptions.getByRole("option").count(), 120);
  await page.screenshot({ path: `${output}/sale-product-dropdown-mobile.png` });
  await saleSearch.fill("SYN-119");
  await saleOptions.getByRole("option", { name: /SYN-119/ }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/sale-product-search-mobile.png`, fullPage: true });
  await saleDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  passed(
    "Record a sale searches inside the Product dropdown, supports keyboard selection/Escape/outside dismissal, preserves selection while typing, and fits long product labels on mobile without accidental submission.",
  );

  await page.goto(`${base}inventory`, { waitUntil: "networkidle" });
  const catalog = page.getByRole("region", { name: "Product categories", exact: true });
  await bounded(catalog, "Catalog categories");
  await catalog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.locator("summary").filter({ hasText: "Battery" }).click();
  const category = page.getByRole("region", { name: "Battery products", exact: true });
  await bounded(category, "Category products");
  await category.evaluate((el) => {
    el.scrollTop = 0;
  });
  await category.getByRole("button", { name: "Add photo", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Product photo", exact: true });
  await dialog.waitFor();
  assert.equal(
    await dialog.getByLabel("Take product photo").count(),
    0,
    "Take photo is not a hidden file picker",
  );
  await dialog
    .getByLabel("Choose product photo")
    .setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Choose a JPEG, PNG or WebP photo." })
    .waitFor();
  await dialog
    .getByLabel("Choose product photo")
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: png });
  failUpload = true;
  await dialog.getByRole("button", { name: "Save photo", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Synthetic upload failure" }).waitFor();
  assert.equal(photos.size, 0);
  failUpload = false;
  await dialog.getByRole("button", { name: "Save photo", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(photos.size, 1);
  await category.getByRole("img", { name: "Photo of Synthetic item 000", exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("summary").filter({ hasText: "Battery" }).click();
  await category.getByRole("img", { name: "Photo of Synthetic item 000", exact: true }).waitFor();
  await category.getByRole("button", { name: "Change photo", exact: true }).click();
  let fileChoosers = 0;
  page.on("filechooser", () => {
    fileChoosers++;
  });
  const startCamera = async () => {
    await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
    await dialog.getByRole("button", { name: "Capture photo", exact: true }).waitFor();
    await page.waitForFunction(() => {
      const video = document.querySelector('video[aria-label="Live camera preview"]');
      return (
        video?.videoWidth > 0 &&
        video.readyState >= 2 &&
        !document.querySelector('section[aria-label="Product camera"] button')?.disabled
      );
    });
  };
  const tracksStopped = () =>
    page.waitForFunction(() =>
      window.__cameraTest.streams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    );
  await startCamera();
  assert.equal(
    await dialog
      .locator("video")
      .evaluate(
        (video) =>
          video.playsInline &&
          video.muted &&
          video.srcObject.getAudioTracks().length === 0 &&
          video.srcObject.getVideoTracks()[0].readyState === "live",
      ),
    true,
  );
  assert.equal(fileChoosers, 0);
  await page.screenshot({ path: `${output}/live-camera-desktop.png`, fullPage: true });
  await dialog.getByRole("button", { name: "Capture photo", exact: true }).click();
  await dialog.getByText("Selected: product-photo.jpg", { exact: true }).waitFor();
  await tracksStopped();
  await startCamera();
  await dialog.getByRole("button", { name: "Cancel camera", exact: true }).click();
  await tracksStopped();
  await dialog.getByRole("button", { name: "Save photo", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(photos.get("p0").updatedAt, "2026-11-13T00:00:02Z");
  await page.screenshot({ path: `${output}/inventory-photo-scroll.png`, fullPage: true });
  passed(
    "Upload validates files, retries failed saves, survives reload and replaces the photo with a captured JPEG from a live camera; capture/cancel stop all tracks.",
  );

  await category.getByRole("button", { name: "Change photo", exact: true }).click();
  for (const [failure, message] of [
    ["NotAllowedError", "Camera access is blocked."],
    ["NotFoundError", "No camera was found."],
    ["NotReadableError", "The camera could not start."],
  ]) {
    await page.evaluate((name) => {
      window.__cameraTest.failure = name;
    }, failure);
    await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: message }).waitFor();
    assert.equal(
      await dialog.getByRole("button", { name: "Choose photo", exact: true }).isEnabled(),
      true,
    );
    await dialog.getByRole("button", { name: "Cancel camera", exact: true }).click();
  }
  await page.evaluate(() => {
    window.__cameraTest.failure = null;
    window.__cameraTest.secureDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "isSecureContext",
    );
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
  });
  await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Live camera needs a secure HTTPS address" })
    .waitFor();
  await dialog.getByRole("button", { name: "Cancel camera", exact: true }).click();
  await page.evaluate(() => {
    const descriptor = window.__cameraTest.secureDescriptor;
    if (descriptor) Object.defineProperty(window, "isSecureContext", descriptor);
    else delete window.isSecureContext;
  });
  await page.evaluate(() => {
    window.__cameraTest.failure = null;
    window.__cameraTest.hold = true;
  });
  await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
  await page.waitForFunction(() => typeof window.__cameraTest.release === "function");
  await dialog.getByRole("button", { name: "Cancel camera", exact: true }).click();
  await page.evaluate(() => {
    window.__cameraTest.hold = false;
    window.__cameraTest.release();
  });
  await tracksStopped();
  await page.setViewportSize({ width: 390, height: 844 });
  await startCamera();
  await page.screenshot({ path: `${output}/live-camera-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await tracksStopped();
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(fileChoosers, 0);
  passed(
    "Camera errors remain actionable; late permission results and closing the mobile dialog release the camera without opening a file chooser.",
  );

  await page.getByRole("tab", { name: "Stock movements", exact: true }).click();
  const movementTable = page.getByRole("table", { name: "Inventory stock movements" });
  const movementScroll = movementTable.locator("..");
  await bounded(movementScroll, "Stock movement ledger");
  const headerTop = await movementTable
    .locator("thead")
    .evaluate((el) => el.getBoundingClientRect().top);
  const scrollTop = await movementScroll.evaluate((el) => el.getBoundingClientRect().top);
  assert(Math.abs(headerTop - scrollTop) < 2, "Table header remains visible while rows scroll");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("51–100 of 155 movements", { exact: true }).waitFor();
  passed("Movement ledger scrolls internally with a sticky header and retains 50-row pagination.");
  await page.getByRole("tab", { name: "Daily sales", exact: true }).click();
  const daily = page.locator('[data-state="active"] .record-scroll').first();
  await bounded(daily, "Daily sales table");
  await page.getByRole("tab", { name: "Sales ledger", exact: true }).click();
  await bounded(page.locator('[data-state="active"] .record-scroll').first(), "Sales ledger");
  const ledger = page.getByRole("table", { name: "Recent sales", exact: true });
  await tableAligned(ledger, [2]);
  assert.equal(await ledger.locator("thead th").count(), 5);
  assert.equal(await ledger.locator("tbody tr").count(), 40);
  await page.getByRole("textbox", { name: "Search sales", exact: true }).fill("SYN-000");
  await tableAligned(ledger, [2]);
  assert.equal(await ledger.locator("tbody tr").count(), 3);
  assert(
    await ledger
      .locator("tbody button")
      .first()
      .evaluate((button) => {
        const box = button.getBoundingClientRect(),
          panel = button.closest(".record-scroll").getBoundingClientRect();
        return box.left >= panel.left && box.right <= panel.right;
      }),
    "Desktop ledger actions are visible without horizontal scrolling",
  );
  await page.screenshot({ path: `${output}/sales-ledger-balanced.png`, fullPage: true });
  passed(
    "Sales ledger and Product performance headings align with values, keeping filtered records and 40-row ledger pages.",
  );
  await page.getByRole("tab", { name: "Low stock", exact: true }).click();
  const lowStock = page.locator('[data-state="active"] .record-scroll').first();
  await bounded(lowStock, "Low stock table");
  await lowStock.evaluate((el) => {
    el.scrollTop = 39;
    el.scrollIntoView({ block: "center" });
  });
  const headingPixels = async () => {
    const box = await lowStock.locator("thead").boundingBox();
    const visibleRight = await lowStock.evaluate(
      (element) => element.getBoundingClientRect().left + element.clientWidth,
    );
    // Exclude the fractional bottom border pixel that can include the next body row.
    // The horizontally scrolled table can extend beyond its panel; exclude that clipped area and scrollbar gutter.
    return page.screenshot({
      clip: {
        x: Math.ceil(box.x),
        y: Math.ceil(box.y) + 1,
        width: Math.floor(Math.min(box.x + box.width, visibleRight) - Math.ceil(box.x)) - 1,
        height: Math.floor(box.height) - 2,
      },
    });
  };
  const headingsBefore = await headingPixels();
  await lowStock.evaluate((el) => {
    el.scrollTop = 81;
  });
  const headingsAfter = await headingPixels();
  await writeFile(`${output}/heading-before.png`, headingsBefore);
  await writeFile(`${output}/heading-after.png`, headingsAfter);
  assert(
    headingsBefore.equals(headingsAfter),
    "Scrolling rows underneath cannot change the header pixels",
  );
  await page.screenshot({ path: `${output}/low-stock-opaque-headings.png`, fullPage: true });
  await wheelAtEdge(lowStock, "top");
  await wheelAtEdge(lowStock, "bottom");
  passed(
    "Low-stock headers stay opaque while rows move; mouse-wheel scrolling reaches the page at both box edges.",
  );
  await page.getByRole("tab", { name: "Least selling", exact: true }).click();
  await bounded(
    page.locator('[data-state="active"] .record-scroll').first(),
    "Least selling table",
  );
  const ranking = page.getByRole("table", { name: "Least selling items", exact: true });
  const columnWidths = () =>
    ranking
      .locator("thead th")
      .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
  const alignedText = async () => {
    const errors = await ranking.evaluate((table) => {
      const heading = [...table.querySelectorAll("thead th")];
      const row = [...table.querySelectorAll("tbody tr:first-child td")];
      const textBox = (cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return range.getBoundingClientRect();
      };
      return heading.flatMap((cell, index) => {
        const label = textBox(cell),
          value = textBox(row[index]);
        const box = cell.getBoundingClientRect();
        return [
          ...(Math.abs(label.y + label.height / 2 - box.y - box.height / 2) > 2
            ? [`Heading ${index} is not vertically centered`]
            : []),
          ...((
            index < 2
              ? Math.abs(label.x - value.x) > 1
              : Math.abs(label.x + label.width / 2 - value.x - value.width / 2) > 1
          )
            ? [`Column ${index} heading/value alignment differs`]
            : []),
        ];
      });
    });
    assert.deepEqual(errors, []);
  };
  const fullWidths = await columnWidths();
  await page.getByRole("searchbox", { name: "Search selling items", exact: true }).fill("SYN-000");
  assert.equal(await ranking.locator("tbody tr").count(), 1);
  const oneRowWidths = await columnWidths();
  assert(
    fullWidths.every((width, index) => Math.abs(width - oneRowWidths[index]) < 1),
    "Filtering to one row preserves column widths",
  );
  await alignedText();
  await page.screenshot({ path: `${output}/least-selling-balanced-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Best selling", exact: true }).click();
  await page.getByRole("table", { name: "Best selling items", exact: true }).waitFor();
  await page.getByRole("button", { name: "Least selling", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search selling items", exact: true }).fill("SYN-119");
  await page.setViewportSize({ width: 390, height: 844 });
  await alignedText();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert(
    await ranking.locator("..").evaluate((el) => el.scrollWidth > el.clientWidth),
    "Narrow screens scroll the table internally",
  );
  await ranking.getByText(products[119].name, { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/least-selling-balanced-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  passed(
    "Selling-table headings and values align, column widths survive single-result filtering, and long names remain readable with internal mobile scrolling.",
  );
  await page.getByRole("tab", { name: "Account & settings", exact: true }).click();
  await bounded(
    page.getByRole("region", { name: "Staff accounts", exact: true }),
    "Staff accounts",
  );
  await page.goto(`${base}data-quality`, { waitUntil: "networkidle" });
  await bounded(
    page.getByRole("region", { name: "Reviewed dates", exact: true }),
    "Reviewed dates",
  );
  passed(
    "Daily sales, sales ledger, stock lists, staff accounts and reviewed dates keep long content inside bounded panels.",
  );

  role = "staff";
  await page.goto(`${base}inventory`, { waitUntil: "networkidle" });
  await page.locator("summary").filter({ hasText: "Battery" }).click();
  await category.getByRole("img", { name: "Photo of Synthetic item 000", exact: true }).waitFor();
  assert.equal(await category.getByRole("button", { name: /Add photo|Change photo/ }).count(), 0);
  passed("Staff can see product photos without owner modification controls.");
  role = "owner";
  await page.reload({ waitUntil: "networkidle" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("summary").filter({ hasText: "Battery" }).click();
  await category.getByRole("button", { name: "Change photo", exact: true }).click();
  assert(await dialog.evaluate((el) => el.getBoundingClientRect().height <= innerHeight - 20));
  await page.screenshot({ path: `${output}/mobile-photo.png`, fullPage: true });
  await dialog.getByRole("button", { name: "Remove photo", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(photos.size, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.getByRole("img", { name: "Photo of Synthetic item 000", exact: true }).count(),
    0,
  );
  assert.deepEqual(report.errors, []);
  passed(
    "Photo removal survives reload; the mobile dialog fits and Inventory has no horizontal page overflow.",
  );
} catch (error) {
  report.layoutFailure = await page
    .evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll("body *")]
        .map((element) => ({
          tag: element.tagName,
          class: element.className?.baseVal ?? element.className,
          text: element.textContent?.slice(0, 90),
          right: element.getBoundingClientRect().right,
          left: element.getBoundingClientRect().left,
        }))
        .filter((element) => element.right > innerWidth + 1 || element.left < -1)
        .slice(0, 40),
    }))
    .catch(() => null);
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
