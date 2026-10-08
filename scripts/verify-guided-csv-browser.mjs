import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// This creates only synthetic records in a disposable loopback installation.
// --mock starts Vite and intercepts transport; it is NOT PostgreSQL evidence.
const mock = process.argv.includes("--mock");
let base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:8080";
let server;
if (mock) {
  const { createServer } = await import("vite");
  server = await createServer({
    server: { host: "127.0.0.1", port: 5187, strictPort: true },
    logLevel: "error",
  });
  await server.listen();
  base = "http://127.0.0.1:5187";
}
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
  "Use a disposable local test installation.",
);
const output = "benchmarks/guided-csv";
await mkdir(output, { recursive: true });
const report = {
  measuredAt: new Date().toISOString(),
  transport: mock ? "mocked API; no database" : "real Python API / PostgreSQL",
  provenance:
    "Generated synthetic records in a new isolated test business; no client records or research findings.",
  checks: [],
};
let browser;
let page;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CSV_BROWSER_EXECUTABLE
      ? {
          executablePath: process.env.CSV_BROWSER_EXECUTABLE,
          args: [
            "--no-sandbox",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-dev-shm-usage",
            "--no-zygote",
          ],
        }
      : {}),
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const session = {
    businessId: "00000000-0000-4000-8000-000000009993",
    userId: "synthetic-owner",
    role: "owner",
    displayName: "CSV test owner",
    email: "csv-test@example.com",
  };
  const products = [],
    sales = [],
    sourceKeys = new Map();
  if (mock) {
    await context.addCookies([{ name: "stockcast_csrf", value: "synthetic-csrf", url: base }]);
    await context.route("**/api/v1/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        path = url.pathname;
      let data;
      if (path.endsWith("/auth/me")) data = session;
      else if (path.endsWith("/auth/options")) data = { signUpEnabled: true, googleEnabled: false };
      else if (path.endsWith("/auth/google/pending")) data = null;
      else if (path.endsWith("/inventory-imports")) {
        const rows = request.postDataJSON().rows;
        rows.forEach((row) => {
          const old = products.find(
            (product) => product.sku.toLowerCase() === row.sku.toLowerCase(),
          );
          if (old) Object.assign(old, row);
          else products.push({ ...row, id: `p-${row.sku}`, isActive: true });
        });
        data = { created: rows.length, updated: 0 };
      } else if (path.endsWith("/data-imports") && request.method() === "POST") {
        const rows = request.postDataJSON().rows,
          errors = [];
        rows.forEach((row, index) => {
          if (sourceKeys.has(row.sourceRecordKey))
            errors.push({ row: index + 1, code: "duplicate_source_record_key" });
          else {
            sourceKeys.set(row.sourceRecordKey, row);
            sales.push({
              id: `s-${sales.length}`,
              productId: products.find((item) => item.sku === row.sku).id,
              saleDate: row.saleDate,
              quantity: row.quantity,
            });
          }
        });
        data = { acceptedRows: rows.length - errors.length, rejectedRows: errors.length, errors };
      } else if (path.endsWith("/products")) data = products;
      else if (path.endsWith("/sales"))
        data = sales.slice(
          Number(url.searchParams.get("offset") ?? 0),
          Number(url.searchParams.get("offset") ?? 0) +
            Number(url.searchParams.get("limit") ?? 200),
        );
      else if (path.endsWith("/sales/export.csv")) {
        await route.fulfill({
          contentType: "text/csv",
          body:
            "Date,SKU,Quantity\n" +
            sales.map((row) => `${row.saleDate},SYN-001,${row.quantity}`).join("\n"),
        });
        return;
      } else if (path.endsWith("/settings"))
        data = {
          movingAverageWindow: 7,
          forecastHorizonDays: 14,
          targetCoverDays: 14,
          minimumHistoryWeeks: 8,
          minimumNonzeroDays: 100,
          topNProducts: 10,
          cvFolds: 3,
          timezone: "Asia/Manila",
        };
      else if (path.endsWith("/forecast-dashboard"))
        data = {
          stale: true,
          run: null,
          latestRun: null,
          recommendations: [],
          predictions: [],
          metrics: [],
          summaries: {},
          businessDay: "2026-10-08",
        };
      else if (path.endsWith(`/businesses/${session.businessId}`))
        data = {
          id: session.businessId,
          name: "Synthetic CSV test",
          location: "",
          dataOrigin: "demo",
        };
      else if (/forecast-schedule/.test(path))
        data = { enabled: false, time: "00:15", timezone: "Asia/Manila" };
      else data = [];
      await route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: { data } });
    });
  } else {
    const response = await context.request.post(`${base}/api/v1/auth/sign-up`, {
      headers: { Origin: base },
      data: {
        businessName: "Synthetic guided CSV verification",
        dataOrigin: "demo",
        displayName: "CSV test owner",
        email: `csv-${randomUUID()}@example.com`,
        password: randomUUID() + randomUUID(),
      },
    });
    assert.equal(response.status(), 201, "Test business registration must succeed.");
    Object.assign(session, (await response.json()).data);
  }
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const writes = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(inventory-imports|data-imports)$/.test(new URL(request.url()).pathname)
    )
      writes.push({ url: request.url(), rows: request.postDataJSON().rows });
  });
  await page.goto(base + "/inventory");
  await page.getByRole("tab", { name: "Products", exact: true }).waitFor();
  const apiData = async (path) =>
    page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`Read failed: ${response.status}`);
      return (await response.json()).data;
    }, `/api/v1/businesses/${session.businessId}${path}`);
  const importer = () => page.locator("[data-csv-state]");
  const waitState = async (state) => {
    await page.locator(`[data-csv-state="${state}"]`).waitFor({ timeout: 30_000 });
  };
  const upload = async (text, name = "synthetic.csv") => {
    await importer()
      .locator('input[type="file"]')
      .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  };
  const review = async () => {
    await importer()
      .getByRole("checkbox", { name: /I checked the column matches/ })
      .check();
  };
  const writeResponse = (suffix) =>
    page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith(suffix),
      { timeout: 240_000 },
    );
  const check = (name) => {
    report.checks.push({ name, passed: true });
    console.log(`Passed: ${name}`);
  };

  await page.getByRole("button", { name: "Import inventory", exact: true }).click();
  const inventoryText =
    "Vendor ID;Item Name;Group;UOM;Stock On Hand;Lead Time Days;Buffer Stock;Cost;Supplier\nSYN-001;Synthetic Rice;Staples;bag;1.234,500;3;1,5;40,2500;Ignored\nSYN-002;Synthetic Milk;Dairy;bottle;50;2;10;30;Ignored";
  await upload(inventoryText, "synthetic-inventory-locale.csv");
  await waitState("error");
  await importer().getByLabel("SKU *", { exact: true }).selectOption("0");
  await importer().getByLabel("Number format", { exact: true }).selectOption("decimal-comma");
  await waitState("ready");
  assert.equal(
    await importer().getByRole("button", { name: "Import inventory", exact: true }).isDisabled(),
    true,
  );
  await review();
  const inventoryResponse = writeResponse("/inventory-imports");
  await importer().getByRole("button", { name: "Import inventory", exact: true }).click();
  assert.equal((await inventoryResponse).status(), 201);
  await page.locator("[data-csv-state]").waitFor({ state: "detached" });
  const catalog = await apiData("/products"),
    rice = catalog.find((item) => item.sku === "SYN-001");
  assert.equal(catalog.length, 2);
  assert.equal(Number(rice.currentStock), 1234.5);
  assert.equal(Number(rice.unitCost), 40.25);
  assert.equal(writes[0].rows[0].sku, "SYN-001");
  check("inventory mapping and explicit locale conversion save verified current counts");

  await page.getByRole("button", { name: "Import inventory", exact: true }).click();

  const duplicate =
    "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost\nSYN-001,Synthetic Rice,Staples,bag,2,3,1,40\nsyn-001,Synthetic Rice,Staples,bag,3,3,1,40";
  await upload(duplicate, "synthetic-duplicate-inventory.csv");
  await waitState("error");
  assert.equal(
    await importer().getByRole("button", { name: "Import inventory", exact: true }).isDisabled(),
    true,
  );
  assert.equal(writes.length, 1);
  assert.equal(
    Number((await apiData("/products")).find((item) => item.sku === "SYN-001").currentStock),
    1234.5,
  );
  check("duplicate inventory SKUs block the complete snapshot without a write");

  await upload(
    "SKU,Product,On Hand\nNEW,Synthetic new product,2",
    "synthetic-missing-metadata.csv",
  );
  await waitState("error");
  for (const [field, value] of [
    ["Category", "Synthetic"],
    ["Unit", "piece"],
    ["Lead Time", "3"],
    ["Safety Stock", "0"],
    ["Unit Cost", "1.2500"],
  ]) {
    await importer().getByLabel(`${field} *`, { exact: true }).selectOption("fixed");
    await importer().getByLabel(`Verified value for ${field}`, { exact: true }).fill(value);
  }
  await waitState("ready");
  assert.equal(writes.length, 1);
  assert.match(
    await importer().getByRole("table", { name: "Converted CSV preview" }).innerText(),
    /piece/,
  );
  check(
    "missing inventory metadata accepts only explicit verified shared values and stays unsaved during review",
  );

  await page.getByRole("tab", { name: "Sales ledger", exact: true }).click();
  const mappedSales =
    "Booked On;Old Item;Units Sold;Line Key;UOM;Customer\n05/10/2026;Legacy Rice;1,250;legacy:1;bag;Ignored\n06/10/2026;Legacy Rice;2,5;legacy:2;bag;Ignored";
  await upload(mappedSales, "synthetic-sales-mapping.csv");
  await waitState("error");
  await importer().getByLabel("Date *", { exact: true }).selectOption("0");
  await importer().getByLabel("Product / SKU *", { exact: true }).selectOption("1");
  await importer().getByLabel("Source Record Key", { exact: true }).selectOption("3");
  await importer().getByLabel("Date format", { exact: true }).selectOption("dmy");
  await importer().getByLabel("Number format", { exact: true }).selectOption("decimal-comma");
  await waitState("error");
  await importer()
    .getByLabel("Match product for Legacy Rice", { exact: true })
    .selectOption(rice.id);
  await waitState("ready");
  const converted = importer().getByRole("table", { name: "Converted CSV preview" });
  assert.match(await converted.innerText(), /2026-10-05/);
  assert.match(await converted.innerText(), /1\.25/);
  await review();
  // Any option change resets the review and prevents the previous payload from being submitted.
  await importer().getByLabel("Number format", { exact: true }).selectOption("decimal-point");
  assert.equal(
    await importer().getByRole("button", { name: "Import rows", exact: true }).isDisabled(),
    true,
  );
  await waitState("error");
  await importer().getByLabel("Number format", { exact: true }).selectOption("decimal-comma");
  await waitState("ready");
  assert.equal(
    await importer()
      .getByRole("checkbox", { name: /I checked/ })
      .isChecked(),
    false,
  );
  await review();
  const salesResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Import rows", exact: true }).click();
  const result = await (await salesResponse).json();
  assert.equal(result.data.acceptedRows, 2);
  await waitState("idle");
  assert.equal((await apiData("/sales")).length, 2);
  assert.equal(
    Number((await apiData("/products")).find((item) => item.sku === "SYN-001").currentStock),
    1234.5,
  );
  assert.deepEqual(
    writes[1].rows.map((row) => [row.sku, row.saleDate, Number(row.quantity), row.sourceRecordKey]),
    [
      ["SYN-001", "2026-10-05", 1.25, "legacy:1"],
      ["SYN-001", "2026-10-06", 2.5, "legacy:2"],
    ],
  );
  check(
    "sales mapping, date conversion, product resolution and review invalidation preserve current stock",
  );

  const invalidText =
    "Date,SKU,Quantity\n" +
    Array.from({ length: 75 }, (_, i) => `2026-02-30,Unknown-${i},bad`).join("\n");
  await upload(invalidText, "synthetic-all-errors.csv");
  await waitState("error");
  assert.equal(
    await importer().getByRole("table", { name: "CSV row errors" }).locator("tbody tr").count(),
    50,
  );
  const downloadEvent = page.waitForEvent("download");
  await importer().getByRole("button", { name: "Download complete error report" }).click();
  const download = await downloadEvent,
    errorPath = `${output}/all-errors.csv`;
  await download.saveAs(errorPath);
  const { parseCsvRecords } = await import("../src/lib/import-csv.ts");
  const errors = parseCsvRecords(await readFile(errorPath, "utf8"));
  assert.equal(errors.length, 226);
  assert.equal(errors.at(-1).fields[0], "76");
  assert.equal(writes.length, 2);
  await page.screenshot({ path: `${output}/row-errors.png`, fullPage: true });
  check(
    "bounded browser errors and worker download include all 225 field problems without a write",
  );

  const large =
    "Transaction Date;Item Code;Units Sold;Transaction Line ID;Unused\n" +
    Array.from({ length: 100_000 }, (_, i) => `2026-10-06;SYN-001;1.001;large:${i};ignored`).join(
      "\n",
    );
  await upload(large, "synthetic-replaced.csv");
  await upload(
    "Date,SKU,Quantity,Source Record Key\n2026-10-06,SYN-001,1,tiny",
    "synthetic-latest.csv",
  );
  await waitState("ready");
  assert.match(await importer().innerText(), /synthetic-latest\.csv/);
  assert.match(await importer().innerText(), /1 valid rows/);
  assert.equal(
    await importer()
      .getByRole("table", { name: "Converted CSV preview" })
      .locator("tbody tr")
      .count(),
    1,
  );
  check(
    "replacing a large source prevents stale worker results from replacing the latest preparation",
  );

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await upload(large, "synthetic-cancelled.csv");
  await importer().getByRole("button", { name: "Cancel preparation", exact: true }).click();
  await waitState("cancelled");
  assert.equal(
    await importer().getByRole("button", { name: "Import rows", exact: true }).isDisabled(),
    true,
  );
  await importer().getByRole("button", { name: "Prepare again", exact: true }).click();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await waitState("ready");
  check("cancellation blocks submission, retains the source, and supports preparing again");

  await upload(large, "synthetic-100000.csv");
  await waitState("ready");
  assert.match(await importer().innerText(), /100,000 valid rows/);
  assert.equal(
    await importer()
      .getByRole("table", { name: "Converted CSV preview" })
      .locator("tbody tr")
      .count(),
    50,
  );
  await review();
  const largeResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Import rows", exact: true }).click();
  const largeResult = await (await largeResponse).json();
  assert.equal(largeResult.data.acceptedRows, 100_000);
  await waitState("idle");
  assert.equal(writes[2].rows.length, 100_000);
  assert.equal(writes[2].rows.at(-1).sourceRecordKey, "large:99999");
  const beyond = await apiData("/sales?limit=1&offset=100001");
  assert.equal(beyond.length, 1);
  assert.equal(
    Number((await apiData("/products")).find((item) => item.sku === "SYN-001").currentStock),
    1234.5,
  );
  check(
    "100,000 mapped sales reach the import endpoint, reload beyond the preview, and preserve stock",
  );

  const overlap =
    "Date,SKU,Quantity,Source Record Key\n2026-10-05,SYN-001,1.25,legacy:1\n2026-10-06,SYN-001,2,overlap:new";
  await upload(overlap, "synthetic-overlap.csv");
  await waitState("ready");
  await review();
  const overlapResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Import rows", exact: true }).click();
  const overlapResult = await (await overlapResponse).json();
  assert.equal(overlapResult.data.acceptedRows, 1);
  assert.equal(overlapResult.data.rejectedRows, 1);
  await page
    .getByText(/already imported rows skipped/)
    .first()
    .waitFor();
  await waitState("ready");
  assert.match(await importer().innerText(), /synthetic-overlap\.csv/);
  check("backend overlap detection remains authoritative and retains a partially rejected source");
  assert.deepEqual(browserErrors, []);
  await page.screenshot({ path: `${output}/converted-sales.png`, fullPage: true });
  report.passed = true;
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  report.passed = false;
  report.error = error.stack ?? String(error);
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  await server?.close();
}
