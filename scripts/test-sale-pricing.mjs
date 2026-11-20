import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({
  configFile: false,
  logLevel: "silent",
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  server: { middlewareMode: true, watch: null },
});
after(() => server.close());
const { salePricing, saleRevenue } = await server.ssrLoadModule("/src/lib/sale-pricing.ts");
const { summarizeDailySales } = await server.ssrLoadModule("/src/lib/daily-sales.ts");
const { compareSalesForecast, estimatedRevenue } = await server.ssrLoadModule(
  "/src/lib/sales-forecast.ts",
);
const { buildSalesTrend, buildSalesShares } = await server.ssrLoadModule(
  "/src/lib/sales-report-chart.ts",
);
const { parseCsvRecords, parseSalesCsv, parseInventoryCsv } =
  await server.ssrLoadModule("/src/lib/import-csv.ts");
const { suggestCsvOptions, validateGuidedCsv } =
  await server.ssrLoadModule("/src/lib/guided-csv.ts");
const { deduplicateSales } = await server.ssrLoadModule("/src/lib/sales-import.ts");
const { peso } = await server.ssrLoadModule("/src/lib/format.ts");
const { ReportForecastPanels } = await server.ssrLoadModule(
  "/src/components/report-forecast-panels.tsx",
);
const product = {
  id: "p",
  sku: "SYNTHETIC",
  name: "Synthetic cable",
  category: "Cable",
  brand: "Synthetic",
  model: "M1",
  variant: "USB-C 2m",
  unit: "pc",
  unitCost: 100,
  sellingPrice: 20,
  currentStock: 10,
  leadTimeDays: 0,
  safetyStock: 0,
};
const day = "2026-01-01";
const sale = { id: "s", productId: "p", date: day, qty: 0.125, ...salePricing(0.125, 12.3456) };
function guided(text, kind) {
  const records = parseCsvRecords(text);
  return validateGuidedCsv(records, kind, [product], suggestCsvOptions(records, kind, [product]));
}

test("saved revenue is independent of changing cost, price, and product activity", () => {
  const summary = summarizeDailySales(
    [sale],
    [{ ...product, unitCost: 999, sellingPrice: 999, isActive: false }],
    day,
  );
  assert.equal(summary.totalAmount, 1.5432);
  assert.equal(summary.rows[0].isActive, false);
  assert.equal(summary.rows[0].quantity, 0.125);
  assert.equal(peso(summary.totalAmount), "₱1.54");
});

test("unknown, partial, and explicit zero revenue remain distinct at every total", () => {
  const unknown = { ...sale, id: "unknown", sellingPrice: undefined, salesAmount: undefined };
  const missing = summarizeDailySales([unknown], [product], day);
  assert.equal(missing.totalAmount, null);
  assert.equal(missing.products[0].totalAmount, null);
  assert.equal(missing.totals[0].totalAmount, null);
  assert.equal(missing.unpricedCount, 1);
  const partial = summarizeDailySales([sale, unknown], [product], day);
  assert.equal(partial.totalAmount, 1.5432);
  assert.equal(partial.rows[0].unpricedCount, 1);
  assert.equal(partial.totals[0].unpricedCount, 1);
  assert.equal(saleRevenue({ ...sale, ...salePricing(sale.qty, 0) }), 0);
  assert.equal(peso(null), "Unavailable");
  assert.equal(peso(0), "₱0.00");
});

test("fractional prices keep seven-place amounts and reject inconsistent source amounts", () => {
  assert.deepEqual(salePricing(2.125, 3.4567), { sellingPrice: 3.4567, salesAmount: 7.3454875 });
  assert.throws(() => salePricing(2, null, 5), /requires/);
  assert.throws(() => salePricing(2, 3, 5), /equal/);
  for (const price of [-1, NaN, Infinity, 1.12345]) assert.throws(() => salePricing(2, price));
});

test("both import paths retain actual prices and attributes with independent SKUs", () => {
  const csv =
    "Date,SKU,Quantity,Actual Selling Price,Sales Amount,Source Record Key\n2026-01-01,SYNTHETIC,2.125,3.4567,7.3454875,line-1";
  const simple = parseSalesCsv(csv, [product])[0];
  assert.equal(simple.salesAmount, 7.3454875);
  const converted = guided(csv, "sales");
  assert.deepEqual(converted.issues, []);
  assert.equal(converted.data.rows[0].sellingPrice, 3.4567);
  assert(converted.convertedHeaders.includes("Sales Amount"));
  assert(converted.convertedPreview[0].fields.includes("7.3454875"));
  const inventory =
    "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost,Selling Price,Brand,Model,Size\nCABLE-1,Synthetic cable,Cable,pc,10,0,0,1.1234,3.4567,Synthetic,M1,USB-C 1m\nCABLE-2,Synthetic cable,Cable,pc,10,0,0,2,4,Synthetic,M2,USB-C 2m";
  const parsed = parseInventoryCsv(inventory);
  assert.equal(parsed[0].sellingPrice, 3.4567);
  assert.equal(parsed[1].variant, "USB-C 2m");
  const detailed = guided(inventory, "inventory");
  assert.deepEqual(detailed.issues, []);
  assert.equal(detailed.data.rows[0].brand, "Synthetic");
  assert.equal(detailed.data.rows[1].sku, "CABLE-2");
});

test("CSV blank prices never borrow catalog price and inconsistent totals block preview", () => {
  const empty = guided(
    "Date,SKU,Quantity,Selling Price,Sales Amount\n2026-01-01,SYNTHETIC,2,,",
    "sales",
  );
  assert.equal(empty.data.rows[0].salesAmount, null);
  const bad = guided(
    "Date,SKU,Quantity,Selling Price,Sales Amount\n2026-01-01,SYNTHETIC,2,5,7",
    "sales",
  );
  assert.equal(bad.data, null);
  assert(bad.issues.some((issue) => issue.message.includes("equal")));
  const changed = deduplicateSales(
    [{ ...sale, sourceRecordKey: "line" }],
    [{ ...sale, sourceRecordKey: "line", ...salePricing(sale.qty, 5) }],
  );
  assert.equal(changed.result.errors[0].code, "source_record_key_conflict");
});

test("revenue trends and shares use priced amounts and preserve unavailable dates", () => {
  const summary = summarizeDailySales(
    [sale, { ...sale, id: "unknown", date: "2026-01-02", sellingPrice: null, salesAmount: null }],
    [product],
    day,
    "2026-01-02",
  );
  const trend = buildSalesTrend(summary.rows, "revenue");
  assert.deepEqual(
    trend.points.map((point) => point.values.unit0),
    [1.5432, null],
  );
  assert.equal(trend.series[0].unit, "PHP");
  const shares = buildSalesShares(
    [
      { ...summary.products[0], totalAmount: 3, recordCount: 100 },
      { ...summary.products[0], productId: "b", totalAmount: 1, recordCount: 1 },
    ],
    "revenue",
  );
  assert.deepEqual(
    shares.map((share) => share.percentage),
    [75, 25],
  );
});

const point = (date, actual, ma, xgb, ensemble) => ({ date, actual, ma, xgb, ensemble });
const forecast = {
  method: "xgb",
  grain: "daily",
  demandAvailable: true,
  holdout: [point(day, 10, 9, 12, 30), point("2026-01-02", 10, 9, 8, 30)],
  future: [point("2026-02-01", null, 2, 3, 4)],
};
test("operating or selected model compares matching dates; cancellation cannot erase errors", () => {
  const result = { byProduct: { p: forecast } };
  const [comparison] = compareSalesForecast([product], result, day, "2026-01-02");
  assert.equal(comparison.actual, comparison.predicted);
  assert.equal(comparison.mae, 2);
  assert.equal(comparison.rmse, 2);
  assert.equal(comparison.observations, 2);
  assert.equal(compareSalesForecast([product], result, day, day, "ma")[0].predicted, 9);
  assert.equal(compareSalesForecast([product], result, day, day, "ensemble")[0].predicted, 30);
  assert.deepEqual(compareSalesForecast([product], result, "2027-01-01", "2027-01-02"), []);
  const absent = {
    byProduct: {
      p: {
        ...forecast,
        holdout: [point(day, null, 1, 2, 3), point("2026-01-02", 4, NaN, NaN, NaN)],
      },
    },
  };
  assert.deepEqual(compareSalesForecast([product], absent, day, "2026-01-02"), []);
});

test("forecast comparisons keep units separate and exclude weekly mismatches", () => {
  const products = [product, { ...product, id: "b", unit: "kg" }, { ...product, id: "c" }];
  const result = { byProduct: { p: forecast, b: forecast, c: { ...forecast, grain: "weekly" } } };
  const compared = compareSalesForecast(products, result, day, "2026-01-02");
  assert.equal(compared.length, 2);
  assert.deepEqual(
    compared.map((row) => row.observations),
    [2, 2],
  );
});

test("estimated revenue uses explicit current price/date and requires a complete future forecast", () => {
  const estimated = estimatedRevenue(product, forecast, day);
  assert.equal(estimated.predictedQuantity, 3);
  assert.equal(estimated.assumedSellingPrice, 20);
  assert.equal(estimated.assumptionDate, day);
  assert.equal(estimated.amount, 60);
  assert.equal(estimatedRevenue({ ...product, sellingPrice: null }, forecast, day).amount, null);
  assert.equal(estimatedRevenue(product, undefined, day).amount, null);
  assert.equal(estimatedRevenue(product, forecast, day, "operating", 30).amount, null);
  assert.equal(
    estimatedRevenue(
      product,
      {
        ...forecast,
        future: [point("2026-02-01", null, 1, 2, 3), point("2026-02-03", null, 1, 2, 3)],
      },
      day,
    ).amount,
    null,
  );
  assert.equal(estimatedRevenue(product, { ...forecast, forecastExpired: true }, day).amount, null);
  assert.equal(
    estimatedRevenue(product, { ...forecast, future: [point(day, null, 1, NaN, 3)] }, day).amount,
    null,
  );
});

test("client report explains matched quantities, preserves technical evidence, and states price assumptions", () => {
  const markup = renderToStaticMarkup(
    createElement(ReportForecastPanels, {
      products: [product, { ...product, id: "kg", unit: "kg" }],
      result: { byProduct: { p: forecast, kg: forecast }, forecastHorizonDays: 1 },
      today: day,
      from: day,
      to: "2026-01-02",
      model: "operating",
      onModelChange() {},
    }),
  );
  assert.match(markup, /Products counted in pc/);
  assert.match(markup, /Products counted in kg/);
  assert.match(markup, /Actually sold/);
  assert.match(markup, /2\.00 pc per product per day on average/);
  assert.match(markup, /<summary[^>]*>How this was checked<\/summary>/);
  assert.match(markup, /Average error \(MAE\): 2\.00/);
  assert.match(markup, /RMSE\): 2\.00/);
  assert.match(markup, /₱60\.00/);
  assert.match(markup, /Price assumed as of 2026-01-01/);
  assert.match(markup, /2026-02-01 to 2026-02-01/);
  assert.match(markup, /Prices are assumed to stay the same/);
  assert.match(markup, /not profit or guaranteed sales/);
});

test("client report explains missing prices and expired forecasts without displaying invented amounts", () => {
  const markup = renderToStaticMarkup(
    createElement(ReportForecastPanels, {
      products: [{ ...product, sellingPrice: null }],
      result: { byProduct: { p: { ...forecast, forecastExpired: true } } },
      today: day,
      from: "2027-01-01",
      to: "2027-01-02",
      model: "operating",
      onModelChange() {},
    }),
  );
  assert.match(markup, /No past forecast comparison is available/);
  assert.match(markup, /Add a selling price in Inventory/);
  assert.match(markup, /Refresh forecasts to get an estimate for current dates/);
  assert.match(markup, /Not available yet/);
  assert.doesNotMatch(markup, /₱0\.00|Unavailable.*Unavailable/);
});

test("browser demonstration preserves attributes, sale prices, and price changes without reseeding", async () => {
  const { useAppStore } = await server.ssrLoadModule("/src/lib/store.ts");
  const original = useAppStore.getState();
  try {
    useAppStore.setState({
      dataMode: "browser-demo",
      session: null,
      products: [],
      sales: [],
      inventoryMovements: [],
    });
    const { id: _id, ...details } = product;
    await useAppStore.getState().addProduct(details);
    const saved = useAppStore.getState().products[0];
    assert.equal(saved.brand, "Synthetic");
    assert.equal(saved.model, "M1");
    assert.equal(saved.variant, "USB-C 2m");
    await useAppStore.getState().recordSale(saved.id, day, 2);
    await useAppStore.getState().updateProduct(saved.id, { sellingPrice: 100 });
    const history = useAppStore.getState().sales;
    assert.equal(history.length, 1);
    assert.equal(history[0].sellingPrice, 20);
    assert.equal(history[0].salesAmount, 40);
    assert.equal(useAppStore.getState().products[0].currentStock, 8);
    assert.equal(
      summarizeDailySales(history, useAppStore.getState().products, day, day, "USB-C").totalAmount,
      40,
    );
  } finally {
    useAppStore.setState(original, true);
  }
});
