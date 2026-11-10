import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Exercises the actual owner UI and API adapter against synthetic HTTP only.
// This does not implement or verify durable server auditing or database permissions.
process.env.VITE_DATA_MODE = "api";
process.env.VITE_API_URL = "/api/v1";
const output = resolve("benchmarks/account-activity");
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: resolve(output, "vite-cache"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const owner = {
  userId: "synthetic-activity-owner",
  businessId: "synthetic-activity-business",
  role: "owner",
  displayName: "Synthetic owner",
  email: "activity-owner@example.test",
};
const settings = {
  businessId: owner.businessId,
  businessName: "Synthetic activity store",
  businessLocation: "",
  dataOrigin: "demo",
  movingAverageWindow: 7,
  forecastHorizonDays: 30,
  targetCoverDays: 7,
  minimumHistoryWeeks: 8,
  minimumNonzeroDays: 100,
  topNProducts: 5,
  cvFolds: 3,
  timezone: "Asia/Manila",
};
const events = Array.from({ length: 53 }, (_, index) => ({
  id: `synthetic-activity-${String(index).padStart(3, "0")}`,
  businessId: owner.businessId,
  userId: index % 2 ? "synthetic-activity-staff" : owner.userId,
  displayName:
    index === 52 ? "Synthetic Older Match" : index % 2 ? "Synthetic Staff" : owner.displayName,
  email:
    index === 52
      ? "older-match@example.test"
      : index % 2
        ? "activity-staff@example.test"
        : owner.email,
  role: index % 2 ? "staff" : "owner",
  event: index % 2 ? "signed_out" : "signed_in",
  occurredAt: new Date(Date.parse("2026-11-09T23:30:00Z") - index * 3_600_000).toISOString(),
}));
let role = "owner";
let mode = "ready";
let holdSearch = null;
const heldRoutes = new Map();
const report = {
  provenance:
    "Synthetic intercepted HTTP in isolated Edge and real Inventory UI/API adapter. No live writes, credentials, database/schema changes, or durable server-audit verification.",
  checks: [],
  activityRequests: [],
  unexpectedRequests: [],
  browserErrors: [],
};
let browser;
let context;
let page;
let base;
const panel = () => page.getByRole("region", { name: "Sign-in activity", exact: true });
const entries = () => panel().getByRole("list", { name: "Sign-in activity entries", exact: true });
const search = () => panel().getByRole("searchbox", { name: "Search team activity", exact: true });
const filter = () => panel().getByLabel("Activity type", { exact: true });
const refresh = () => panel().getByRole("button", { name: "Refresh activity", exact: true });
function passed(message) {
  report.checks.push(message);
  console.log(`Passed ${report.checks.length}: ${message}`);
}
async function waitHeld(key) {
  const deadline = Date.now() + 30_000;
  while (!heldRoutes.has(key) && Date.now() < deadline) {
    await new Promise((release) => setTimeout(release, 10));
  }
  assert.ok(heldRoutes.has(key), `Synthetic request for ${key} reached its hold gate.`);
}
async function waitEntries(count) {
  await page.waitForFunction((expected) => {
    const list = document.querySelector('[aria-label="Sign-in activity entries"]');
    return list && list.querySelectorAll("li").length === expected;
  }, count);
  assert.equal(await entries().getByRole("listitem").count(), count);
}
async function openAccount() {
  await page.goto(`${base}inventory`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page
    .getByRole("tab", { name: role === "owner" ? "Account & settings" : "Account", exact: true })
    .click();
}
async function screenshot(name, fullPage = true) {
  await page.screenshot({ path: resolve(output, name), fullPage });
}
async function activityGeometry() {
  return panel().evaluate((card) => {
    const list = card.querySelector('[aria-label="Sign-in activity entries"]');
    const rect = list.getBoundingClientRect();
    return {
      cardHeight: card.getBoundingClientRect().height,
      listHeight: rect.height,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      overflowY: getComputedStyle(list).overflowY,
    };
  });
}
async function assertInternalScroll() {
  const scroll = await entries().evaluate((list) => {
    list.scrollTop = list.scrollHeight;
    const last = list.lastElementChild.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    return { scrollTop: list.scrollTop, lastBottom: last.bottom, listBottom: bounds.bottom };
  });
  assert.ok(scroll.scrollTop > 0, "Many activity entries scroll inside their list.");
  assert.ok(scroll.lastBottom <= scroll.listBottom + 1, "The final saved entry is reachable.");
  await entries().evaluate((list) => {
    list.scrollTop = 0;
  });
}

try {
  await server.listen();
  base = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    timezoneId: "America/Los_Angeles",
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (data) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (request.method() === "GET") {
      if (path.endsWith("/auth/options"))
        return json({ signUpEnabled: false, googleEnabled: false });
      if (path.endsWith("/auth/google/pending")) return json(null);
      if (path.endsWith("/auth/me")) return json({ ...owner, role });
      if (path.endsWith("/auth/members")) return json([]);
      if (path.endsWith("/auth/activity")) {
        const query = Object.fromEntries(url.searchParams);
        report.activityRequests.push(query);
        assert.equal(query.limit, "50", "Activity requests use the agreed 50-record page size.");
        assert.ok(!query.search || query.search.length <= 160);
        if (holdSearch !== null && query.search === holdSearch) {
          await new Promise((release) => heldRoutes.set(query.search, release));
        }
        if (mode === "unconfigured" || mode === "failed")
          return route.fulfill({
            status: mode === "unconfigured" ? 404 : 503,
            contentType: "application/json",
            body: JSON.stringify({
              detail: mode === "unconfigured" ? "Not Found" : "Synthetic activity unavailable",
            }),
          });
        let matching = mode === "empty" ? [] : events;
        if (query.event) matching = matching.filter((event) => event.event === query.event);
        if (query.search)
          matching = matching.filter((event) =>
            `${event.displayName} ${event.email}`
              .toLowerCase()
              .includes(query.search.toLowerCase()),
          );
        const offset = query.before ? Number(query.before.replace("synthetic-cursor-", "")) : 0;
        const nextOffset = offset + Number(query.limit);
        return json({
          events: matching.slice(offset, nextOffset),
          nextCursor: nextOffset < matching.length ? `synthetic-cursor-${nextOffset}` : null,
        });
      }
      if (
        path.endsWith("/products") ||
        path.endsWith("/sales") ||
        path.endsWith("/inventory-movements")
      )
        return json([]);
      if (path.endsWith("/settings")) return json(settings);
      if (path === `/api/v1/businesses/${owner.businessId}`)
        return json({ name: settings.businessName, location: "", dataOrigin: "demo" });
      if (path.endsWith("/forecast-status")) return json({ revision: "synthetic-activity-static" });
      if (path.endsWith("/forecast-dashboard"))
        return json({
          stale: false,
          expired: false,
          businessDay: "2026-11-10",
          businessTimezone: settings.timezone,
          run: null,
          latestRun: null,
          summaries: {},
          predictions: [],
          metrics: [],
          recommendations: [],
          sharedState: { products: [], settings },
        });
    }
    report.unexpectedRequests.push({ method: request.method(), path });
    return route.fulfill({ status: 500, body: "Unexpected synthetic verification request" });
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-10T01:00:00Z"));

  await openAccount();
  await panel().waitFor();
  await waitEntries(50);
  const desktopMany = await activityGeometry();
  assert.equal(desktopMany.listHeight, 320);
  assert.equal(desktopMany.overflowY, "auto");
  assert.ok(desktopMany.scrollHeight > desktopMany.clientHeight);
  await assertInternalScroll();
  assert.equal(await page.getByText("Your account", { exact: true }).count(), 1);
  assert.match(await entries().innerText(), /Synthetic owner/);
  assert.match(await entries().innerText(), /activity-staff@example\.test/);
  assert.match(await entries().innerText(), /Signed in/);
  assert.match(await entries().innerText(), /Signed out/);
  assert.equal(
    await panel()
      .getByText(/^(online|offline|currently signed in)$/i)
      .count(),
    0,
  );
  passed(
    "Owners find Sign-in activity beside their account details, with saved names, emails, roles and distinct sign-in/sign-out events.",
  );

  const firstTime = entries().locator("time").first();
  assert.equal(await firstTime.getAttribute("datetime"), events[0].occurredAt);
  assert.match(await firstTime.innerText(), /Nov(?:ember)?\s+10|10\s+Nov/);
  assert.match(await firstTime.innerText(), /7:30|07:30/);
  assert.match(await panel().innerText(), /Asia\/Manila/);
  passed(
    "Event dates and times use the saved store timezone across a UTC date boundary, independently of the browser timezone.",
  );
  await panel().scrollIntoViewIfNeeded();
  await screenshot("desktop-account-activity.png");
  await panel().evaluate((section) =>
    window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - 76 }),
  );
  await screenshot("desktop-account-activity-viewport.png", false);

  mode = "failed";
  await panel().getByRole("button", { name: "Load older activity", exact: true }).click();
  await panel().getByRole("button", { name: "Try again", exact: true }).waitFor();
  await waitEntries(50);
  assert.equal(report.activityRequests.at(-1).before, "synthetic-cursor-50");
  mode = "ready";
  await panel().getByRole("button", { name: "Try again", exact: true }).click();
  await waitEntries(53);
  const desktopOlder = await activityGeometry();
  assert.equal(desktopOlder.listHeight, desktopMany.listHeight);
  assert.equal(desktopOlder.cardHeight, desktopMany.cardHeight);
  assert.equal(report.activityRequests.at(-1).before, "synthetic-cursor-50");
  assert.equal(
    await panel().getByRole("button", { name: "Load older activity", exact: true }).count(),
    0,
  );
  assert.match(await entries().innerText(), /Synthetic Older Match/);
  await refresh().click();
  await waitEntries(50);
  assert.equal(report.activityRequests.at(-1).before, undefined);
  passed(
    "Load older follows the opaque server cursor, appends older events once, and refresh restarts from the latest page.",
  );
  passed("A failed older-page request retains the 50 loaded events and retries the same cursor.");

  await search().fill("  OLDER-match@example.test  ");
  await waitEntries(1);
  const desktopSingle = await activityGeometry();
  assert.equal(desktopSingle.listHeight, desktopMany.listHeight);
  assert.equal(desktopSingle.cardHeight, desktopMany.cardHeight);
  assert.equal(report.activityRequests.at(-1).search, "OLDER-match@example.test");
  assert.match(await entries().innerText(), /Synthetic Older Match/);
  assert.equal(await search().getAttribute("maxlength"), "160");
  await search().fill("Synthetic Staff");
  await waitEntries(26);
  assert.equal(report.activityRequests.at(-1).search, "Synthetic Staff");
  passed(
    "Name/email search is trimmed and sent to the server, including a matching event beyond the initially visible 50 records.",
  );

  await search().fill("");
  await filter().selectOption("signed_out");
  await waitEntries(26);
  assert.equal(report.activityRequests.at(-1).event, "signed_out");
  assert.doesNotMatch(await entries().innerText(), /Signed in/);
  await filter().selectOption("signed_in");
  await waitEntries(27);
  assert.equal(report.activityRequests.at(-1).event, "signed_in");
  assert.doesNotMatch(await entries().innerText(), /Signed out/);
  passed(
    "Activity-type filtering queries all matching server records and shows only the selected sign-in or sign-out event type.",
  );

  await filter().selectOption("all");
  await search().fill("no such synthetic member");
  await panel().getByText("No matching activity", { exact: true }).waitFor();
  assert.equal(await entries().count(), 0);
  passed("Unmatched filters show No matching activity without inventing sign-in records.");

  holdSearch = "slow";
  const delayedRequest = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("search") === "slow",
  );
  await search().fill("slow");
  await delayedRequest;
  await waitHeld("slow");
  await search().fill("older-match@example.test");
  await waitEntries(1);
  const latestRequestCount = report.activityRequests.length;
  holdSearch = null;
  const delayedResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("search") === "slow",
  );
  heldRoutes.get("slow")();
  await delayedResponse;
  await page.waitForTimeout(100);
  assert.match(await entries().innerText(), /Synthetic Older Match/);
  assert.equal(report.activityRequests.length, latestRequestCount);
  passed("A delayed response for an earlier search cannot replace newer matching activity.");

  await search().fill("");
  await waitEntries(50);
  await page.setViewportSize({ width: 390, height: 900 });
  await panel().evaluate((section) =>
    window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - 76 }),
  );
  const bounds = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  report.mobileBounds = bounds;
  assert.ok(bounds.document <= bounds.viewport + 1, JSON.stringify(bounds));
  assert.ok(bounds.body <= bounds.viewport + 1, JSON.stringify(bounds));
  const mobileMany = await activityGeometry();
  assert.equal(mobileMany.listHeight, 288);
  assert.ok(mobileMany.scrollHeight > mobileMany.clientHeight);
  await assertInternalScroll();
  await screenshot("mobile-account-activity.png", false);
  await search().fill("older-match@example.test");
  await waitEntries(1);
  const mobileSingle = await activityGeometry();
  assert.equal(mobileSingle.listHeight, mobileMany.listHeight);
  assert.equal(mobileSingle.cardHeight, mobileMany.cardHeight);
  report.geometry = { desktopMany, desktopOlder, desktopSingle, mobileMany, mobileSingle };
  await screenshot("mobile-account-activity-single.png", false);
  passed(
    "The 390px layout keeps owner activity, search, event filters and member details inside the page width.",
  );
  passed(
    "The activity card retains its height for one or many events; its 320px desktop/288px mobile list scrolls internally to the last entry.",
  );

  holdSearch = "delayed owner";
  const oldAccountRequest = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("search") === "delayed owner",
  );
  await search().fill("delayed owner");
  await oldAccountRequest;
  await waitHeld("delayed owner");
  holdSearch = null;
  await page.evaluate(async (syntheticOwner) => {
    const { useAppStore } = await import("/src/lib/store.ts");
    useAppStore.setState({
      session: {
        ...syntheticOwner,
        userId: "synthetic-second-owner",
        displayName: "Synthetic second owner",
      },
    });
  }, owner);
  await waitEntries(50);
  const oldAccountResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("search") === "delayed owner",
  );
  heldRoutes.get("delayed owner")();
  await oldAccountResponse;
  await page.waitForTimeout(100);
  await waitEntries(50);
  assert.equal(await search().inputValue(), "");
  passed(
    "Switching signed-in account resets activity filters and ignores an older account's delayed response.",
  );

  await page.setViewportSize({ width: 1440, height: 1100 });
  mode = "failed";
  await openAccount();
  await panel().getByRole("button", { name: "Try again", exact: true }).waitFor();
  assert.equal(await entries().count(), 0);
  mode = "ready";
  await panel().getByRole("button", { name: "Try again", exact: true }).click();
  await waitEntries(50);
  passed(
    "Failed activity reads show a clear retry state, and successful retry restores saved events without modifying any records.",
  );

  mode = "unconfigured";
  await openAccount();
  await panel().getByText("Sign-in activity is not configured", { exact: true }).waitFor();
  assert.equal(await entries().count(), 0);
  assert.equal(await panel().getByText("No activity recorded yet", { exact: true }).count(), 0);
  passed(
    "An unavailable server endpoint is labeled Not configured, distinct from a successfully read empty history.",
  );

  mode = "empty";
  await openAccount();
  await panel().getByText("No activity recorded yet", { exact: true }).waitFor();
  assert.equal(await entries().count(), 0);
  passed(
    "A successful empty history reports no recorded activity rather than implying a failed read or an online/offline status.",
  );

  mode = "ready";
  role = "staff";
  const beforeStaff = report.activityRequests.length;
  await openAccount();
  await page.getByText("Your account", { exact: true }).waitFor();
  assert.equal(await panel().count(), 0);
  assert.equal(report.activityRequests.length, beforeStaff);
  passed(
    "Staff retain their own Account screen without the owner activity card or any request for team activity.",
  );

  assert.deepEqual(report.browserErrors, []);
  assert.deepEqual(report.unexpectedRequests, []);
  passed(
    "All cases used intercepted read-only synthetic transport with no browser errors, live writes or changes to authentication persistence.",
  );
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.failure = error.stack;
  if (page) {
    report.failurePage = await page
      .locator("body")
      .innerText()
      .catch(() => "Unavailable");
    await screenshot("failure.png").catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const release of heldRoutes.values()) release();
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await context?.unrouteAll({ behavior: "wait" }).catch(() => {});
  await browser?.close();
  await server.close();
}
