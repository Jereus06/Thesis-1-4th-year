import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { preview } from "vite";

// Real production frontend, intercepted synthetic API responses; no live store writes.
const output = "benchmarks/lattice-background";
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: "127.0.0.1", port: 0 } });
const base = server.resolvedUrls.local[0];
const report = {
  provenance: "Synthetic HTTP and browser lifecycle events; no live records.",
  checks: [],
  errors: [],
};
const owner = {
  userId: "lattice-owner",
  businessId: "lattice-store",
  email: "owner@example.test",
  displayName: "Synthetic owner",
  role: "owner",
};
const product = {
  id: "p",
  sku: "SYN-001",
  name: "Synthetic product",
  category: "Test",
  unit: "piece",
  currentStock: "40",
  safetyStock: "5",
  unitCost: "20",
  leadTimeDays: 3,
  isActive: true,
};
let browser;
const contexts = [];
const passed = (message) => {
  report.checks.push(message);
  console.log(message);
};

async function open({ reducedMotion = "no-preference", unavailable = false, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion,
  });
  contexts.push(context);
  let signedIn = true;
  await context.addCookies([{ name: "stockcast_csrf", value: "synthetic-csrf", url: base }]);
  await context.addInitScript(
    ({ unavailable }) => {
      window.__latticeFrames = 0;
      window.__backgroundHidden = false;
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => window.__backgroundHidden,
      });
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.classList.contains("ambient-background__network")) window.__latticeFrames++;
        return clear.apply(this, args);
      };
      if (unavailable) {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args) {
          return this.classList.contains("ambient-background__network")
            ? null
            : getContext.apply(this, args);
        };
      }
    },
    { unavailable },
  );
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (path.endsWith("/auth/sign-out")) {
      assert.equal(request.method(), "POST");
      signedIn = false;
      return reply({ signedOut: true });
    }
    assert.equal(request.method(), "GET", `Unexpected write ${path}`);
    if (path.endsWith("/auth/options")) return reply({ signUpEnabled: true, googleEnabled: false });
    if (path.endsWith("/auth/google/pending")) return reply(null);
    if (path.endsWith("/auth/me")) return reply(signedIn ? owner : null);
    if (path.endsWith("/auth/activity")) return reply({ events: [], nextCursor: null });
    if (path.endsWith("/auth/members")) return reply([]);
    if (path.endsWith(`/businesses/${owner.businessId}`))
      return reply({ name: "Synthetic background test", location: "", dataOrigin: "demo" });
    if (path.endsWith("/products")) return reply([product]);
    if (
      path.endsWith("/product-photos") ||
      path.endsWith("/inventory-movements") ||
      path.endsWith("/data-quality")
    )
      return reply([]);
    if (path.endsWith("/sales"))
      return reply([
        { id: "s", productId: "p", saleDate: "2026-11-13", quantity: "3", source: "manual" },
      ]);
    if (path.endsWith("/settings"))
      return reply({
        businessId: owner.businessId,
        movingAverageWindow: 7,
        forecastHorizonDays: 30,
        targetCoverDays: 7,
        minimumHistoryWeeks: 8,
        minimumNonzeroDays: 100,
        topNProducts: 8,
        cvFolds: 3,
        timezone: "Asia/Manila",
      });
    if (path.endsWith("/forecast-status")) return reply({ revision: "1" });
    if (path.endsWith("/forecast-dashboard"))
      return reply({
        run: null,
        latestRun: null,
        stale: false,
        expired: false,
        asOf: null,
        forecastThrough: null,
        businessDay: "2026-11-14",
        businessTimezone: "Asia/Manila",
        summaries: {},
        predictions: [],
        metrics: [],
        recommendations: [],
      });
    throw new Error(`Unexpected request ${path}`);
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-14T04:00:00Z"));
  await page.goto(`${base}sales-report`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Sales report", exact: true }).waitFor();
  await page.locator(".ambient-background__network").waitFor();
  return page;
}

async function still(page) {
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => window.__latticeFrames);
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(() => window.__latticeFrames),
    before,
    "Paused background must stop drawing",
  );
}
async function moving(page) {
  const before = await page.evaluate(() => window.__latticeFrames);
  await page.waitForFunction((count) => window.__latticeFrames > count, before);
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  const page = await open();
  const canvas = page.locator(".ambient-background__network");
  const background = page.locator(".ambient-background");
  assert.equal(await background.getAttribute("aria-hidden"), "true");
  assert.equal(await background.evaluate((el) => getComputedStyle(el).pointerEvents), "none");
  const first = await canvas.evaluate((el) => el.toDataURL());
  await moving(page);
  assert.notEqual(
    await canvas.evaluate((el) => el.toDataURL()),
    first,
    "Actual canvas pixels must move",
  );
  const dimensions = await canvas.evaluate((el) => ({ width: el.width, height: el.height }));
  assert(
    dimensions.width * dimensions.height <= 1_605_000,
    "Bound canvas memory on large displays",
  );
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  passed(
    "The green network paints changing canvas pixels behind the real app, stays decorative, and bounds its resolution.",
  );

  await page.getByRole("button", { name: "Pause background motion", exact: true }).click();
  await still(page);
  const frozen = await canvas.evaluate((el) => el.toDataURL());
  await page.mouse.move(1200, 120);
  await page.mouse.click(1200, 120);
  await still(page);
  assert.equal(await canvas.evaluate((el) => el.toDataURL()), frozen);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Resume background motion", exact: true }).waitFor();
  await still(page);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("stockcast-background-motion")),
    "paused",
  );
  await page.getByRole("button", { name: "Resume background motion", exact: true }).click();
  await moving(page);
  passed(
    "Pause freezes canvas drawing and pointer effects, persists after reload, and resumes correctly.",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  assert(
    await page.getByRole("button", { name: "Background motion reduced", exact: true }).isDisabled(),
  );
  await still(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await moving(page);
  await page.evaluate(() => {
    window.__backgroundHidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await still(page);
  await page.evaluate(() => {
    window.__backgroundHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await moving(page);
  passed(
    "Changing reduced-motion preferences or tab visibility stops the renderer and restores it without a second animation loop.",
  );

  await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
  await still(page);
  await page.emulateMedia({ media: "print" });
  assert.equal(await background.evaluate((el) => getComputedStyle(el).display), "none");
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => dispatchEvent(new Event("afterprint")));
  await moving(page);
  await canvas.evaluate((el) => el.dispatchEvent(new Event("contextlost")));
  await still(page);
  await canvas.evaluate((el) => el.dispatchEvent(new Event("contextrestored")));
  await moving(page);
  passed(
    "Printing hides and pauses the decoration; canvas context loss and restoration recover cleanly.",
  );

  await page.getByRole("button", { name: "Record sale", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("spinbutton", { name: /quantity/i }).fill("2");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "Forecasts", exact: true }).click();
  await page.getByRole("heading", { name: "Sales forecasts", exact: true }).waitFor();
  assert.equal(await canvas.count(), 1);
  await moving(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
  assert.equal(await canvas.count(), 0);
  await still(page);
  passed(
    "Forms and navigation remain interactive; route changes keep one canvas and signing out destroys the renderer.",
  );

  const mobile = await open({ mobile: true });
  await moving(mobile);
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const mobileDimensions = await mobile
    .locator(".ambient-background__network")
    .evaluate((el) => ({ width: el.width, cssWidth: el.getBoundingClientRect().width }));
  assert(
    mobileDimensions.width <= mobileDimensions.cssWidth * 1.5 + 1,
    "Cap high-DPI rendering on phones",
  );
  await mobile.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  passed(
    "At 390px and device scale 3 the network stays inside the viewport and uses capped rendering resolution.",
  );

  const reduced = await open({ reducedMotion: "reduce" });
  await still(reduced);
  assert(
    await reduced
      .getByRole("button", { name: "Background motion reduced", exact: true })
      .isDisabled(),
  );
  assert(
    (await reduced.evaluate(() => window.__latticeFrames)) > 0,
    "Reduced motion keeps a static network image",
  );
  const fallback = await open({ unavailable: true });
  assert.equal(await fallback.evaluate(() => window.__latticeFrames), 0);
  assert(await fallback.locator(".ambient-background__glow").first().isVisible());
  await fallback.getByRole("button", { name: "Record sale", exact: true }).click();
  await fallback.getByRole("dialog").waitFor();
  await fallback.screenshot({ path: `${output}/canvas-fallback.png` });
  assert.deepEqual(report.errors, []);
  passed(
    "Reduced-motion startup draws a still image; unavailable canvas keeps the CSS background and usable forms without errors.",
  );
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await Promise.all(contexts.map((context) => context.close()));
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
