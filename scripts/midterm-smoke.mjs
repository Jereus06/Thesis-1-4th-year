import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4173";
const OUT = "midterm-evidence";
const server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"], {
  stdio: "inherit",
});

async function ready() {
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error("Preview server exited early");
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      // The preview server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Preview server did not start within 40 seconds");
}

let browser;
try {
  await mkdir(OUT, { recursive: true });
  await ready();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("heading", { name: /Morning briefing/ }).waitFor({ timeout: 90000 });
  await page.screenshot({ path: `${OUT}/01-overview.png`, fullPage: true });

  const before = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("stockcast-v5") || "{}").state;
    return { sales: store.sales.length, stock: store.products[0].currentStock };
  });
  await page.getByRole("button", { name: "Record sale" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save sale" }).click();
  await page.getByText(/Recorded 1 /).waitFor({ timeout: 10000 });
  const after = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("stockcast-v5") || "{}").state;
    return { sales: store.sales.length, stock: store.products[0].currentStock };
  });
  if (after.sales !== before.sales + 1 || after.stock !== before.stock - 1) {
    throw new Error(`Sale did not update records and stock: ${JSON.stringify({ before, after })}`);
  }

  await page.getByRole("link", { name: "Inventory" }).click();
  await page.getByRole("heading", { name: "Inventory & records" }).waitFor();
  await page.screenshot({ path: `${OUT}/02-inventory.png`, fullPage: true });
  await page.getByRole("tab", { name: "Sales ledger" }).click();
  await page.getByRole("heading", { name: "Import CSV" }).waitFor();
  await page.screenshot({ path: `${OUT}/03-sales-ledger.png`, fullPage: true });

  await page.getByRole("link", { name: "Forecasts" }).click();
  await page.getByRole("heading", { name: "Forecast evaluation" }).waitFor();
  await page.screenshot({ path: `${OUT}/04-forecasts.png`, fullPage: true });

  await page.getByRole("link", { name: "Restock" }).click();
  await page.getByRole("heading", { name: "Restocking recommendations" }).waitFor();
  await page.screenshot({ path: `${OUT}/05-restock.png`, fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Restocking recommendations" }).waitFor({ timeout: 90000 });
  const persisted = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("stockcast-v5") || "{}").state;
    return { sales: store.sales.length, stock: store.products[0].currentStock };
  });
  if (persisted.sales !== after.sales || persisted.stock !== after.stock) {
    throw new Error(`Sale did not persist after refresh: ${JSON.stringify({ after, persisted })}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
  process.stdout.write("Midterm browser smoke check passed. Evidence screenshots are in midterm-evidence.\n");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
