import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Fresh browser context, real UI/store/API client, intercepted synthetic HTTP only.
// This script does not access a saved profile, PostgreSQL, or live business records.
process.env.VITE_DATA_MODE = "browser-demo";
process.env.VITE_API_URL = "/api/v1";
const output = resolve("benchmarks/sales-delete");
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: resolve(output, "vite-cache"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const report = {
  provenance:
    "Synthetic intercepted HTTP in an isolated browser context; actual sales ledger UI, store and API client; no database writes.",
  checks: [],
  requests: [],
  unexpectedRequests: [],
  pageErrors: [],
};
const owner = {
  userId: "synthetic-owner",
  businessId: "synthetic-business",
  email: "ledger@example.test",
  displayName: "Synthetic owner",
  role: "owner",
};
const nonImportedRows = [
  {
    id: "manual-sale",
    productId: "synthetic-product",
    date: "2026-10-09",
    qty: 100,
    source: "manual",
  },
  { id: "demo-sale", productId: "synthetic-product", date: "2026-10-08", qty: 101, source: "demo" },
];
let sales = [
  ...nonImportedRows,
  ...Array.from({ length: 43 }, (_, index) => ({
    id: `synthetic-import-${index}`,
    productId: "synthetic-product",
    date: "2026-10-01",
    qty: index + 1,
    source: index % 2 ? "pos_import" : "csv_import",
  })),
];
let movements = [
  {
    id: "synthetic-sale-movement",
    businessId: owner.businessId,
    productId: "synthetic-product",
    movementDate: "2026-10-09",
    movementType: "sale",
    quantityDelta: -100,
    balanceAfter: 17.125,
    dataOrigin: "demo",
    saleId: "manual-sale",
    note: null,
    recordedBy: owner.userId,
  },
];
const originalMovements = structuredClone(movements);
let product;
let failNextDelete = false;
let pendingGate;
let browser;
let page;
function passed(message) {
  report.checks.push(message);
  console.log(`Passed ${report.checks.length}: ${message}`);
}
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "stockcast_csrf", value: "synthetic-csrf", url: base }]);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const json = (data, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data }) });
    if (request.method() === "DELETE" && pathname.includes("/sales/")) {
      report.requests.push({
        method: request.method(),
        pathname,
        csrf: request.headers()["x-csrf-token"],
      });
      if (pendingGate) {
        const gate = pendingGate;
        pendingGate = null;
        await gate.promise;
      }
      if (failNextDelete) {
        failNextDelete = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "synthetic_failure", message: "Synthetic delete failed. Try again." },
          }),
        });
        return;
      }
      const id = pathname.split("/").at(-1);
      const deleted = sales.filter(
        (row) =>
          (id === "imported" && row.source.endsWith("_import")) ||
          (row.id === id && (row.source === "manual" || row.source.endsWith("_import"))),
      );
      sales = sales.filter((row) => !deleted.includes(row));
      for (const recorded of deleted.filter((row) => row.source === "manual")) {
        product = { ...product, currentStock: product.currentStock + recorded.qty };
        movements = [
          ...movements,
          {
            ...originalMovements[0],
            id: `synthetic-correction-${recorded.id}`,
            movementType: "adjustment",
            quantityDelta: recorded.qty,
            balanceAfter: product.currentStock,
            saleId: null,
            note: `Deleted recorded sale ${recorded.id}`,
          },
        ];
      }
      return json({ deletedRows: deleted.length });
    }
    if (pathname.endsWith("/sales") && request.method() === "GET") {
      const cursor = url.searchParams.get("beforeId");
      const offset = cursor
        ? sales.findIndex((row) => row.id === cursor) + 1
        : Number(url.searchParams.get("offset") ?? 0);
      return json(
        sales
          .slice(offset, offset + Number(url.searchParams.get("limit") ?? 1000))
          .map((row) => ({ ...row, saleDate: row.date, quantity: String(row.qty) })),
      );
    }
    if (pathname.endsWith("/products") && request.method() === "GET")
      return json(product ? [product] : []);
    if (pathname.endsWith("/inventory-movements") && request.method() === "GET")
      return json(
        movements.map((movement) => ({
          ...movement,
          quantityDelta: String(movement.quantityDelta),
          balanceAfter: String(movement.balanceAfter),
        })),
      );
    if (pathname.endsWith("/auth/options"))
      return json({ signUpEnabled: false, googleEnabled: false });
    if (pathname.endsWith("/auth/google/pending")) return json(null);
    if (pathname.endsWith("/forecast-dashboard"))
      return json({
        stale: false,
        expired: false,
        forecastThrough: null,
        businessDay: "2026-10-09",
        businessTimezone: "Asia/Manila",
        run: null,
        latestRun: null,
        asOf: "2026-10-09T00:00:00Z",
        message: "Synthetic ledger verification",
        summaries: {},
        predictions: [],
        metrics: [],
        recommendations: [],
      });
    report.unexpectedRequests.push({ method: request.method(), pathname });
    await route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.goto(`${base}inventory`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("tab", { name: "Sales ledger", exact: true }).waitFor();
  product = await page.evaluate(
    async ({ owner: session, sales: records, movements: audit }) => {
      const { useAppStore } = await import("/src/lib/store.ts");
      const catalogItem = {
        ...useAppStore.getState().products[0],
        id: "synthetic-product",
        sku: "LEDGER-1",
        name: "Synthetic Ledger Product",
        currentStock: 17.125,
        isActive: true,
      };
      useAppStore.setState({
        dataMode: "api",
        session,
        apiStatus: "ready",
        products: [catalogItem],
        sales: records,
        inventoryMovements: audit,
        importRefreshWarning: null,
        connectApi: async () => {},
      });
      return catalogItem;
    },
    { owner, sales, movements },
  );
  await page.getByRole("tab", { name: "Sales ledger", exact: true }).click();
  const rows = () => page.locator("table tbody tr");
  const dialog = () => page.getByRole("dialog");
  const bulk = () => page.getByRole("button", { name: "Delete imported sales", exact: true });
  const importedButtons = () => page.getByRole("button", { name: /^Delete imported sale for / });
  const recordedButtons = () => page.getByRole("button", { name: /^Delete recorded sale for / });
  const storeSnapshot = () =>
    page.evaluate(async () => {
      const { useAppStore } = await import("/src/lib/store.ts");
      const state = useAppStore.getState();
      return {
        stock: state.products[0].currentStock,
        sales: state.sales.map((row) => row.id),
        movements: state.inventoryMovements,
      };
    });
  assert.equal(await rows().count(), 40);
  assert.equal(await recordedButtons().count(), 1);
  assert.equal(
    await rows()
      .filter({ hasText: "2026-10-09" })
      .getByRole("button", { name: /^Delete recorded sale for / })
      .count(),
    1,
  );
  assert.equal(await rows().filter({ hasText: "2026-10-08" }).getByRole("button").count(), 0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(await rows().count(), 5);
  assert.equal(await importedButtons().count(), 5);
  passed(
    "Owner can delete recorded and imported rows while demo rows stay protected; pagination reaches rows after the first 40.",
  );

  await importedButtons().first().click();
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(report.requests.length, 0);
  assert.equal(await rows().count(), 5);
  passed("Cancelling the single-sale confirmation sends no request and retains every row.");

  failNextDelete = true;
  await importedButtons().first().click();
  await dialog().getByRole("button", { name: "Delete sale", exact: true }).click();
  await dialog().getByRole("alert").waitFor();
  assert.match(await dialog().getByRole("alert").innerText(), /Synthetic delete failed/);
  assert.equal(await rows().count(), 5);
  assert.equal(report.requests.length, 1);
  assert.equal(sales.length, 45);
  passed(
    "A failed single deletion leaves the confirmation open with its error and preserves the ledger.",
  );

  let release;
  pendingGate = {
    promise: new Promise((resolveGate) => {
      release = resolveGate;
    }),
  };
  await dialog()
    .getByRole("button", { name: "Delete sale", exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await dialog().getByRole("button", { name: "Deleting…", exact: true }).waitFor();
  assert.equal(
    await dialog().getByRole("button", { name: "Deleting…", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await dialog().getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await dialog().isVisible(), true);
  release();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(
    report.requests.length,
    2,
    "double click during retry sends exactly one additional request",
  );
  assert.equal(await rows().count(), 4);
  assert.equal(sales.length, 44);
  passed(
    "Retry succeeds once despite two same-task clicks; pending controls disable, Escape preserves the dialog, and the last page shows the remaining rows.",
  );

  await bulk().click();
  assert.match(
    await dialog().innerText(),
    /all 42 imported sales rows.*including rows on other pages/,
  );
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(report.requests.length, 2);
  await bulk().click();
  await dialog().getByRole("button", { name: "Delete imported sales", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  assert.deepEqual(sales, nonImportedRows);
  assert.equal(await rows().count(), 2);
  assert.equal(await bulk().isDisabled(), true);
  assert.equal(await importedButtons().count(), 0);
  const saved = await storeSnapshot();
  assert.deepEqual(saved, {
    stock: 17.125,
    sales: nonImportedRows.map((row) => row.id),
    movements: originalMovements,
  });
  passed(
    "Bulk confirmation covers imported rows on every page, preserves manual/demo sales and current stock, and adjusts pagination after deletion.",
  );

  const requestsBeforeRecorded = report.requests.length;
  await recordedButtons().click();
  await dialog().getByRole("heading", { name: "Delete recorded sale?", exact: true }).waitFor();
  const recordedConfirmation = await dialog().innerText();
  assert.match(recordedConfirmation, /100/);
  assert.match(recordedConfirmation, /restor/i);
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(report.requests.length, requestsBeforeRecorded);
  assert.deepEqual(await storeSnapshot(), saved);
  passed(
    "Recorded-sale confirmation explains stock restoration; cancelling retains the sale and stock.",
  );

  failNextDelete = true;
  await recordedButtons().click();
  await dialog().getByRole("button", { name: "Delete sale", exact: true }).click();
  await dialog().getByRole("alert").waitFor();
  assert.match(await dialog().getByRole("alert").innerText(), /Synthetic delete failed/);
  assert.deepEqual(await storeSnapshot(), saved);
  assert.deepEqual(sales, nonImportedRows);
  assert.equal(product.currentStock, 17.125);
  passed(
    "A failed recorded-sale deletion keeps its row, stock and audit unchanged and allows retry.",
  );

  await dialog().getByRole("button", { name: "Delete sale", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(report.requests.length, requestsBeforeRecorded + 2);
  assert.ok(report.requests.at(-1).pathname.endsWith("/sales/manual-sale"));
  assert.equal(await rows().count(), 1);
  assert.equal(await recordedButtons().count(), 0);
  assert.equal(await importedButtons().count(), 0);
  assert.equal(await bulk().isDisabled(), true);
  assert.deepEqual(sales, [nonImportedRows[1]]);
  const corrected = await storeSnapshot();
  assert.deepEqual(corrected, {
    stock: 117.125,
    sales: ["demo-sale"],
    movements,
  });
  assert.deepEqual(corrected.movements[0], originalMovements[0]);
  assert.equal(corrected.movements[1].movementType, "adjustment");
  assert.equal(corrected.movements[1].quantityDelta, 100);
  passed(
    "Confirmed recorded-sale deletion removes its row, refreshes restored stock and a compensating audit, and leaves imported bulk deletion separate.",
  );

  await page.evaluate(async (session) => {
    const { useAppStore } = await import("/src/lib/store.ts");
    useAppStore.setState({
      session: { ...session, role: "staff" },
      sales: [
        {
          id: "staff-visible-recorded",
          productId: "synthetic-product",
          date: "2026-10-09",
          qty: 2,
          source: "manual",
        },
        {
          id: "staff-visible-import",
          productId: "synthetic-product",
          date: "2026-10-01",
          qty: 1,
          source: "csv_import",
        },
      ],
    });
  }, owner);
  assert.equal(await bulk().count(), 0);
  assert.equal(await importedButtons().count(), 0);
  assert.equal(await recordedButtons().count(), 0);
  assert.equal(await rows().count(), 2);
  passed("Staff can read recorded and imported sales and have no row or bulk deletion controls.");

  assert.ok(report.requests.every((request) => request.csrf === "synthetic-csrf"));
  assert.deepEqual(report.unexpectedRequests, []);
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
  await page.screenshot({ path: resolve(output, "sales-delete-passed.png"), fullPage: true });
  console.log(
    `All ${report.checks.length} sales deletion browser checks passed; every API request was intercepted.`,
  );
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  if (page) {
    report.renderedBody = await page
      .locator("body")
      .innerText({ timeout: 5000 })
      .catch(() => "Unavailable");
    await page
      .screenshot({ path: resolve(output, "sales-delete-failed.png"), fullPage: true })
      .catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, "sales-delete-result.json"), JSON.stringify(report, null, 2));
  await browser?.close();
  await server.close();
}
