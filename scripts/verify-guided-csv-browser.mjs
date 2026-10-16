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
      : process.platform === "win32"
        ? { channel: "msedge" }
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
      } else if (/\/products\/[^/]+$/.test(path) && request.method() === "PATCH") {
        const product = products.find((item) => item.id === path.split("/").at(-1));
        assert.ok(product, "Synthetic product to update must exist.");
        Object.assign(product, request.postDataJSON());
        data = product;
      } else if (path.endsWith("/products")) data = products;
      else if (path.endsWith("/sales")) {
        const cursorId = url.searchParams.get("beforeId");
        const offset = cursorId
          ? sales.findIndex((row) => row.id === cursorId) + 1
          : Number(url.searchParams.get("offset") ?? 0);
        data = sales.slice(offset, offset + Number(url.searchParams.get("limit") ?? 200));
      } else if (path.endsWith("/sales/export.csv")) {
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
      writes.push({ url: request.url(), ...request.postDataJSON() });
  });
  await page.goto(base + "/inventory", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("tab", { name: "Products", exact: true }).waitFor({ timeout: 60_000 });
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
  const upload = async (text, name = "synthetic.csv", activation = "click") => {
    const chooserPromise = page.waitForEvent("filechooser");
    const button = importer().getByRole("button", { name: "Choose CSV file", exact: true });
    if (activation === "keyboard") {
      await button.focus();
      await button.press("Enter");
    } else await button.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
    await importer().getByText(name, { exact: true }).waitFor();
  };
  const adjust = async () => {
    const details = importer()
      .locator("details")
      .filter({ has: page.getByText("Adjust import", { exact: true }) });
    if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  };
  const importDetails = async () => {
    const details = importer()
      .locator("details")
      .filter({ has: page.getByText("Import details", { exact: true }) });
    if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
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
  await adjust();
  await importer().getByLabel("SKU *", { exact: true }).selectOption("0");
  await importer().getByLabel("Number format", { exact: true }).selectOption("decimal-comma");
  await waitState("ready");
  assert.equal(
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
    false,
  );
  const inventoryResponse = writeResponse("/inventory-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
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
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
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
  await adjust();
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
  const mappedFilename = "synthetic sales café.csv";
  await upload(mappedSales, mappedFilename);
  await waitState("error");
  await adjust();
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
  // Any option change invalidates preparation and prevents the previous payload from being submitted.
  await importer().getByLabel("Number format", { exact: true }).selectOption("decimal-point");
  assert.equal(
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
    true,
  );
  await waitState("error");
  await importer().getByLabel("Number format", { exact: true }).selectOption("decimal-comma");
  await waitState("ready");
  assert.equal(
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
    false,
  );
  const salesResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  const result = await (await salesResponse).json();
  assert.equal(result.data.acceptedRows, 2);
  assert.equal(writes[1].originalFilename, mappedFilename);
  if (!mock) {
    assert.equal(result.data.originalFilename, mappedFilename);
    const savedImport = await apiData(`/data-imports/${result.data.id}`);
    assert.equal(savedImport.originalFilename, mappedFilename);
  }
  check("uploaded historical filenames preserve spaces and Unicode through the saved import");
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
    "sales mapping, date conversion, product resolution and preparation invalidation preserve current stock",
  );

  const invalidText =
    "Date,SKU,Quantity\n" +
    Array.from({ length: 75 }, (_, i) => `2026-02-30,Unknown-${i},bad`).join("\n");
  await upload(invalidText, "synthetic-all-errors.csv");
  await waitState("error");
  assert.equal(await importer().getByRole("alert").count(), 0);
  await importDetails();
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
  assert.match(await importer().innerText(), /1 records ready to import/);
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
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
    true,
  );
  await importer().getByRole("button", { name: "Prepare again", exact: true }).click();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await waitState("ready");
  check("cancellation blocks submission, retains the source, and supports preparing again");

  await upload(large, "synthetic-100000.csv");
  await waitState("ready");
  assert.match(await importer().innerText(), /100,000 records ready to import/);
  assert.equal(
    await importer()
      .getByRole("table", { name: "Converted CSV preview" })
      .locator("tbody tr")
      .count(),
    50,
  );
  const largeResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  const largeResult = await (await largeResponse).json();
  assert.equal(largeResult.data.acceptedRows, 100_000);
  assert.equal(writes[2].originalFilename, "synthetic-100000.csv");
  if (!mock) {
    const savedImport = await apiData(`/data-imports/${largeResult.data.id}`);
    assert.equal(savedImport.originalFilename, "synthetic-100000.csv");
  }
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
  const overlapResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
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

  // Inject only a failed follow-up read; the import write still reaches the real database in CI.
  let failNextRead = true;
  await context.route("**/sales?limit=1000*", async (route) => {
    if (failNextRead) {
      failNextRead = false;
      await route.fulfill({ status: 503, json: { detail: "Synthetic follow-up read failure" } });
    } else await route.fallback();
  });
  await upload(
    "Date,SKU,Quantity,Source Record Key\n2026-10-06,SYN-001,1,reload:new",
    "synthetic-saved-read-failure.csv",
  );
  await waitState("ready");
  const savedResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  assert.equal((await (await savedResponse).json()).data.acceptedRows, 1);
  await waitState("idle");
  await page.getByText(/Sales import was saved, but the ledger could not be refreshed/).waitFor();
  await page.screenshot({ path: `${output}/saved-refresh-warning.png`, fullPage: true });
  const writeCount = writes.length;
  await page.getByRole("button", { name: "Reload saved records", exact: true }).click();
  await page
    .getByText(/Sales import was saved, but the ledger could not be refreshed/)
    .waitFor({ state: "hidden", timeout: 30_000 });
  assert.equal(writes.length, writeCount);
  assert.equal((await apiData("/sales?limit=1&offset=100003")).length, 1);
  check(
    "a saved import survives an injected refresh failure and reloads records without another write",
  );

  const reviewWriteCount = writes.length;
  await upload(
    "Date,SKU,Quantity,Source Record Key,Alternate SKU\n" +
      Array.from(
        { length: 55 },
        (_, i) => `2026-10-06,Legacy review ${i},1,review:${i},SYN-001`,
      ).join("\n"),
    "synthetic-many-product-matches.csv",
  );
  await waitState("error");
  await adjust();
  for (let i = 0; i < 55; i++) {
    await importer()
      .getByLabel(`Match product for Legacy review ${i}`, { exact: true })
      .selectOption(rice.id);
    await waitState(i === 54 ? "ready" : "error");
  }
  const selectedMatches = () =>
    importer().getByRole("region", { name: "Selected product matches" });
  assert.equal(await selectedMatches().getByRole("combobox").count(), 50);
  await selectedMatches()
    .getByRole("button", { name: "Next selected matches", exact: true })
    .click();
  assert.equal(await selectedMatches().getByRole("combobox").count(), 5);
  await page.screenshot({ path: `${output}/selected-match-page2.png`, fullPage: true });
  await selectedMatches()
    .getByRole("button", { name: "Previous selected matches", exact: true })
    .click();
  await selectedMatches()
    .getByLabel("Find selected product matches", { exact: true })
    .fill("Legacy review 54");
  assert.equal(await selectedMatches().getByRole("combobox").count(), 1);
  await selectedMatches()
    .getByLabel("Match product for Legacy review 54", { exact: true })
    .selectOption("");
  await waitState("error");
  await importer()
    .getByLabel("Match product for Legacy review 54", { exact: true })
    .selectOption(rice.id);
  await waitState("ready");
  await selectedMatches()
    .getByLabel("Find selected product matches", { exact: true })
    .fill("Synthetic Rice");
  assert.equal(await selectedMatches().getByRole("combobox").count(), 50);
  await selectedMatches()
    .getByLabel("Find selected product matches", { exact: true })
    .fill("does-not-match");
  await selectedMatches().getByText("No selected matches found.", { exact: false }).waitFor();
  assert.equal(await selectedMatches().getByRole("combobox").count(), 0);
  assert.equal(writes.length, reviewWriteCount);
  await page.screenshot({ path: `${output}/selected-match-search.png`, fullPage: true });
  check(
    "more than 50 selected product matches stay searchable, paged, editable, and unsaved during review",
  );

  await adjust();
  await importer().getByLabel("Product / SKU *", { exact: true }).selectOption("4");
  await waitState("ready");
  assert.equal(await selectedMatches().count(), 0);
  assert.equal(
    await importer()
      .getByRole("checkbox", { name: /I checked these records/ })
      .count(),
    0,
  );
  assert.equal(
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
    false,
  );
  assert.match(
    await importer().getByRole("table", { name: "Converted CSV preview" }).innerText(),
    /SYN-001/,
  );
  assert.equal(writes.length, reviewWriteCount);
  check("changing the product column clears earlier manual matches and prepares the new mapping");

  await upload("Date,SKU,Quantity\n2026-10-06,constructor,1", "synthetic-identifier-name.csv");
  await waitState("error");
  await adjust();
  assert.equal(
    await importer().getByLabel("Match product for constructor", { exact: true }).inputValue(),
    "",
  );
  await importer()
    .getByLabel("Match product for constructor", { exact: true })
    .selectOption(rice.id);
  await waitState("ready");
  await adjust();
  await importer()
    .getByRole("checkbox", { name: "First row contains column names", exact: true })
    .uncheck();
  await waitState("error");
  assert.equal(await selectedMatches().count(), 0);
  await importer()
    .getByRole("checkbox", { name: "First row contains column names", exact: true })
    .check();
  await waitState("error");
  await importer()
    .getByLabel("Match product for constructor", { exact: true })
    .selectOption(rice.id);
  await waitState("ready");
  await importer().getByLabel("Column separator", { exact: true }).selectOption(",");
  await waitState("error");
  assert.equal(await selectedMatches().count(), 0);
  assert.equal(writes.length, reviewWriteCount);
  check(
    "header/separator changes clear contextual matches and inherited object names are not preselected",
  );

  await importer().getByRole("button", { name: "Paste CSV", exact: true }).click();
  await upload(
    "Customer,Product Name,Date,SKU,Quantity,Source Record Key,Receipt Total\nIgnored,Synthetic Rice,2026-10-07,SYN-001,2,auto:sale,9999",
    "synthetic-automatic-sales.csv",
    "keyboard",
  );
  await waitState("ready");
  assert.equal(await importer().locator("details").first().getAttribute("open"), null);
  assert.equal(await importer().getByLabel("Confirm date meaning").count(), 0);
  assert.equal(await importer().getByLabel("Confirm number meaning").count(), 0);
  assert.equal(
    await importer()
      .getByRole("checkbox", { name: /I checked these records/ })
      .count(),
    0,
  );
  const autoSaleResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  assert.equal((await autoSaleResponse).status(), 201);
  await waitState("idle");
  assert.equal(Number(writes.at(-1).rows[0].quantity), 2);
  assert.equal(writes.at(-1).rows[0].sourceRecordKey, "auto:sale");
  check(
    "ordinary sales import automatically detects useful columns and skips extras without opening settings",
  );

  await upload(
    "Date;SKU;Quantity;Source Record Key\n05/10/2026;SYN-001;1,234;auto:defaults",
    "synthetic-ambiguous-values.csv",
  );
  await waitState("ready");
  const beforeDefaults = writes.length;
  assert.equal(await importer().locator("details").first().getAttribute("open"), null);
  assert.equal(await importer().getByLabel("Confirm date meaning").count(), 0);
  assert.equal(await importer().getByLabel("Confirm number meaning").count(), 0);
  assert.equal(
    await importer()
      .getByText(/^Dates: Day \/ month \/ year.*Numbers: Decimal point, comma grouping/)
      .isVisible(),
    true,
  );
  assert.match(
    await importer().getByRole("table", { name: "Converted CSV preview" }).innerText(),
    /2026-10-05/,
  );
  assert.match(
    await importer().getByRole("table", { name: "Converted CSV preview" }).innerText(),
    /1234/,
  );
  assert.equal(
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
    false,
  );
  assert.equal(writes.length, beforeDefaults);
  const defaultsResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  assert.equal((await defaultsResponse).status(), 201);
  await waitState("idle");
  assert.equal(writes.at(-1).rows[0].saleDate, "2026-10-05");
  assert.equal(Number(writes.at(-1).rows[0].quantity), 1234);
  check("ambiguous dates and numbers prepare and import automatically with visible default values");

  await upload(
    "Date;SKU;Quantity;Source Record Key\n05/10/2026;SYN-001;1,234;auto:override",
    "synthetic-optional-format-override.csv",
  );
  await waitState("ready");
  await adjust();
  await importer().getByLabel("Date format", { exact: true }).selectOption("mdy");
  await importer().getByLabel("Number format", { exact: true }).selectOption("decimal-comma");
  await waitState("ready");
  const overrideResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  assert.equal((await overrideResponse).status(), 201);
  await waitState("idle");
  assert.equal(writes.at(-1).rows[0].saleDate, "2026-05-10");
  assert.equal(Number(writes.at(-1).rows[0].quantity), 1.234);
  check("optional format overrides replace automatic choices and save the revalidated values");

  await page.getByRole("tab", { name: "Products", exact: true }).click();
  const beforeCount = (await apiData("/products")).find((item) => item.sku === "SYN-001");
  await page.getByRole("button", { name: "Import inventory", exact: true }).click();
  await upload("SKU,Stock On Hand,Supplier\nSYN-001,47.5,Ignored", "synthetic-count-only.csv");
  await waitState("ready");
  assert.match(await importer().innerText(), /Saved details are kept for 1 existing products/);
  assert.equal(await importer().locator("details").first().getAttribute("open"), null);
  await page.screenshot({ path: `${output}/simple-inventory-preview.png`, fullPage: true });
  const countResponse = writeResponse("/inventory-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  assert.equal((await countResponse).status(), 201);
  await page.locator("[data-csv-state]").waitFor({ state: "detached" });
  assert.deepEqual(writes.at(-1).rows, [{ sku: "SYN-001", currentStock: 47.5 }]);
  const afterCount = (await apiData("/products")).find((item) => item.sku === "SYN-001");
  assert.equal(Number(afterCount.currentStock), 47.5);
  for (const field of ["id", "name", "category", "unit", "unitCost", "leadTimeDays", "safetyStock"])
    assert.equal(afterCount[field], beforeCount[field]);
  check(
    "count-only inventory imports preserve saved product details through the authenticated write path",
  );

  await page.getByRole("button", { name: "Import inventory", exact: true }).click();
  await upload("SKU,On Hand\nSYN-001,2\nUNKNOWN-NEW,3", "synthetic-incomplete-new-product.csv");
  await waitState("error");
  const afterWrites = writes.length;
  assert.equal(
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    Number((await apiData("/products")).find((item) => item.sku === "SYN-001").currentStock),
    47.5,
  );
  assert.equal(writes.length, afterWrites);
  check(
    "an incomplete new product blocks the entire mixed inventory import before any counts are changed",
  );
  await page.screenshot({ path: `${output}/incomplete-new-product.png`, fullPage: true });

  await upload(
    "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost\n" +
      "SAMPLE-WATER,Synthetic sample water,Synthetic,bottle,11,1,0,1\n" +
      "SAMPLE-NOODLES,Synthetic sample noodles,Synthetic,pack,22,1,0,1\n" +
      "SAMPLE-RICE,Synthetic sample rice,Synthetic,bag,33,1,0,1",
    "synthetic-historical-catalog.csv",
  );
  await waitState("ready");
  const sampleCatalogResponse = writeResponse("/inventory-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  assert.equal((await sampleCatalogResponse).status(), 201);
  await page.locator("[data-csv-state]").waitFor({ state: "detached" });
  const sampleWater = (await apiData("/products")).find((item) => item.sku === "SAMPLE-WATER");
  const deactivateStatus = await page.evaluate(
    async ({ businessId, productId }) => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("stockcast_csrf="))
        ?.slice("stockcast_csrf=".length);
      const response = await fetch(`/api/v1/businesses/${businessId}/products/${productId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrf ?? ""),
        },
        body: JSON.stringify({ isActive: false }),
      });
      return response.status;
    },
    { businessId: session.businessId, productId: sampleWater.id },
  );
  assert.equal(deactivateStatus, 200);
  await page.reload();
  await page.getByRole("tab", { name: "Sales ledger", exact: true }).click();
  const beforeHistoricalCatalog = await apiData("/products");
  assert.equal(beforeHistoricalCatalog.find((item) => item.id === sampleWater.id).isActive, false);
  const historicalSample =
    "Date,SKU,Quantity,Source Record Key\n" +
    Array.from({ length: 7 }, (_, index) =>
      ["SAMPLE-WATER", "SAMPLE-NOODLES", "SAMPLE-RICE"]
        .map((sku) => `2026-10-07,${sku},2,synthetic-inactive:${index}:${sku}`)
        .join("\n"),
    ).join("\n");
  await upload(historicalSample, "synthetic-stockcast-sales.csv");
  await waitState("ready");
  assert.equal(
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isEnabled(),
    true,
  );
  assert.match(
    await importer().locator("[data-csv-feedback]").innerText(),
    /File ready: 21 sales records/,
  );
  assert.equal(await importer().locator("details[open]").count(), 0);
  assert.equal(await importer().getByRole("combobox").count(), 0);
  assert.equal(await importer().getByRole("checkbox").count(), 0);
  assert.equal(await importer().getByRole("alert").count(), 0);
  await page.screenshot({ path: `${output}/inactive-historical-sales-ready.png`, fullPage: true });
  const historicalResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  const historicalResult = (await (await historicalResponse).json()).data;
  assert.equal(historicalResult.acceptedRows, 21);
  assert.equal(historicalResult.rejectedRows, 0);
  await waitState("idle");
  assert.equal(writes.at(-1).rows.length, 21);
  assert.equal(writes.at(-1).rows.filter((row) => row.sku === "SAMPLE-WATER").length, 7);
  assert.deepEqual(await apiData("/products"), beforeHistoricalCatalog);
  const sampleIds = new Set(
    beforeHistoricalCatalog.filter((item) => item.sku.startsWith("SAMPLE-")).map((item) => item.id),
  );
  const persistedHistorical = mock
    ? sales.slice(-21)
    : (await apiData("/sales?limit=200")).filter((row) => sampleIds.has(row.productId));
  assert.equal(persistedHistorical.length, 21);
  assert.equal(persistedHistorical.filter((row) => row.productId === sampleWater.id).length, 7);
  check(
    "all 21 historical sales, including seven inactive-SKU rows, save without questions, reactivation or stock changes",
  );

  const beforeReportReview = writes.length;
  for (const delimiter of [";", "\t"]) {
    await upload(
      [
        ["Date", "SKU", "Quantity", "Locations, channels, regions, groups, totals"].join(delimiter),
        ["2026-10-07", "SYN-001", "2", "North, Metro, West, Daily, All"].join(delimiter),
      ].join("\n"),
      delimiter === ";" ? "synthetic-comma-rich-semicolon.csv" : "synthetic-comma-rich-tab.csv",
    );
    await waitState("ready");
    assert.equal(await importer().locator("details[open]").count(), 0);
    assert.match(
      await importer().getByRole("table", { name: "Converted CSV preview" }).innerText(),
      /SYN-001/,
    );
  }
  check("comma-rich unused notes do not override a semicolon or tab report's actual columns");

  const extraHeaders = Array.from({ length: 201 }, (_, index) => `Unused ${index + 1}`);
  await upload(
    [
      [...extraHeaders, "Date", "SKU", "Quantity", "Source Record Key"].join(","),
      [...extraHeaders.map(() => "ignored"), "2026-10-07", "SYN-001", "2", "wide:line1"].join(","),
    ].join("\n"),
    "synthetic-wide-required-columns.csv",
  );
  await waitState("ready");
  assert.equal(await importer().locator("details[open]").count(), 0);
  await adjust();
  for (const [label, value] of [
    ["Date *", "201"],
    ["Product / SKU *", "202"],
    ["Quantity *", "203"],
    ["Source Record Key", "204"],
  ]) {
    const select = importer().getByLabel(label, { exact: true });
    assert.equal(await select.inputValue(), value);
    assert.ok((await select.locator("option").count()) < 120, "Wide source choices stay bounded");
    await select.selectOption(value);
    await waitState("ready");
  }
  assert.match(await importer().innerText(), /205-column file/);
  const lateProduct = importer().getByLabel("Product / SKU *", { exact: true });
  await lateProduct.selectOption("");
  await waitState("error");
  assert.equal(await lateProduct.locator('option[value="202"]').count(), 1);
  await lateProduct.selectOption("202");
  await waitState("ready");
  assert.equal(await lateProduct.inputValue(), "202");
  check(
    "wide reports prepare automatically and optional controls preserve real late-column indices",
  );

  await upload(
    "Date,SKU,Product,Quantity,Receipt\n2026-10-07,OLD,Retired unknown product,2,SYN-001",
    "synthetic-unrelated-catalog-value.csv",
  );
  await waitState("error");
  assert.equal(
    await importer().getByRole("button", { name: "Upload CSV", exact: true }).isDisabled(),
    true,
  );
  assert.equal(writes.length, beforeReportReview);
  check(
    "an unrelated receipt value cannot silently replace unknown product identifiers; review sends no writes",
  );

  await importer().getByRole("button", { name: "Paste CSV", exact: true }).click();
  await importer().getByLabel("Paste CSV text", { exact: true }).fill(
    "Date,SKU,Quantity,Source Record Key\n2026-10-07,SYN-001,1,provenance:pasted",
  );
  await waitState("ready");
  const pastedResponse = writeResponse("/data-imports");
  await importer().getByRole("button", { name: "Upload CSV", exact: true }).click();
  const pastedResult = (await (await pastedResponse).json()).data;
  assert.equal(pastedResult.acceptedRows, 1);
  await waitState("idle");
  assert.equal(Object.hasOwn(writes.at(-1), "originalFilename"), false);
  if (!mock) {
    const savedImport = await apiData(`/data-imports/${pastedResult.id}`);
    assert.equal(savedImport.originalFilename, null);
  }
  check("switching from a selected file to pasted sales saves no invented or previous filename");

  assert.deepEqual(browserErrors, []);
  await page.screenshot({ path: `${output}/historical-sales-saved.png`, fullPage: true });
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
