import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  server: { middlewareMode: true, watch: null },
});
after(() => server.close());
const { buildLowStockAlerts } = await server.ssrLoadModule("/src/lib/inventory/low-stock.ts");

const product = (id, patch = {}) => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  category: "Synthetic test data",
  unit: "piece",
  currentStock: 10,
  leadTimeDays: 3,
  safetyStock: 2,
  unitCost: 1,
  ...patch,
});
const row = (item, patch = {}) => ({
  product: item,
  demandAvailable: true,
  dailyDemand: 2,
  demandDuringLead: 6,
  reorderPoint: 8,
  targetStock: 22,
  reorderQty: 12,
  daysOfCover: 5,
  status: "healthy",
  winnerModel: "ma",
  confidence: "low",
  ...patch,
});

test("a raw reorder-point boundary is inclusive without rounding", () => {
  const below = product("below", { currentStock: 2.333, leadTimeDays: 1, safetyStock: 0 });
  const exact = product("exact", { currentStock: 2.334, leadTimeDays: 1, safetyStock: 0 });
  const above = product("above", { currentStock: 2.335, leadTimeDays: 1, safetyStock: 0 });
  const alerts = buildLowStockAlerts(
    [below, exact, above],
    [below, exact, above].map((item) => row(item, { dailyDemand: 2.334, reorderPoint: 2.334 })),
  );
  assert.deepEqual(
    alerts.map((alert) => [alert.product.id, alert.status, alert.threshold, alert.thresholdSource]),
    [
      ["below", "reorder", 2.334, "reorder_point"],
      ["exact", "reorder", 2.334, "reorder_point"],
    ],
  );
});

test("zero stock appears without sales, a reorder row, or a positive minimum", () => {
  const item = product("new", { currentStock: 0, safetyStock: 0 });
  assert.deepEqual(buildLowStockAlerts([item], []), [
    { product: item, status: "stockout", threshold: 0, thresholdSource: "safety_stock" },
  ]);
  assert.deepEqual(buildLowStockAlerts([item], [], true), buildLowStockAlerts([item], []));
});

test("negative stock remains an out-of-stock alert", () => {
  const item = product("negative", { currentStock: -1.125, safetyStock: 0 });
  assert.equal(buildLowStockAlerts([item], [row(item)])[0].status, "stockout");
  assert.equal(buildLowStockAlerts([item], [], true)[0].status, "stockout");
});

test("a missing demand row uses the live safety-stock minimum inclusively", () => {
  const below = product("below", { currentStock: 0.499, safetyStock: 0.5 });
  const exact = product("exact", { currentStock: 0.5, safetyStock: 0.5 });
  const above = product("above", { currentStock: 0.501, safetyStock: 0.5 });
  assert.deepEqual(
    buildLowStockAlerts([below, exact, above], []).map((alert) => [
      alert.product.id,
      alert.threshold,
      alert.thresholdSource,
    ]),
    [
      ["below", 0.5, "safety_stock"],
      ["exact", 0.5, "safety_stock"],
    ],
  );
});

test("zero safety stock never marks a positive quantity low without demand", () => {
  assert.deepEqual(
    buildLowStockAlerts([product("a", { currentStock: 0.001, safetyStock: 0 })], []),
    [],
  );
});

test("unavailable, expired, and invalid demand rows fall back to inventory minima", () => {
  const item = product("a", { currentStock: 2, safetyStock: 2 });
  for (const patch of [
    { demandAvailable: false },
    { forecastExpired: true },
    { dailyDemand: NaN },
    { dailyDemand: Infinity },
    { dailyDemand: -0.001 },
    { reorderPoint: NaN },
    { reorderPoint: Infinity },
    { reorderPoint: -0.001 },
  ]) {
    assert.deepEqual(buildLowStockAlerts([item], [row(item, patch)]), [
      { product: item, status: "reorder", threshold: 2, thresholdSource: "safety_stock" },
    ]);
  }
});

test("a globally expired forecast does not reuse its higher reorder point", () => {
  const item = product("a", { currentStock: 5, safetyStock: 2 });
  assert.equal(buildLowStockAlerts([item], [row(item)]).length, 1);
  assert.deepEqual(buildLowStockAlerts([item], [row(item)], true), []);
  const empty = { ...item, currentStock: 0 };
  assert.deepEqual(buildLowStockAlerts([empty], [row(item)], true), [
    { product: empty, status: "stockout", threshold: 2, thresholdSource: "safety_stock" },
  ]);
});

test("legacy rows can supply a finite nonnegative demand and zero is valid", () => {
  const item = product("a", { currentStock: 2 });
  const alert = buildLowStockAlerts(
    [item],
    [row(item, { demandAvailable: undefined, dailyDemand: 0, reorderPoint: 2 })],
  )[0];
  assert.equal(alert.thresholdSource, "reorder_point");
  assert.equal(alert.threshold, 2);
});

test("catalog quantity and metadata supersede a cached reorder row", () => {
  const cached = product("a", { currentStock: 0, name: "Old name", sku: "OLD", unit: "pack" });
  const current = { ...cached, currentStock: 9, name: "Updated name", sku: "NEW", unit: "bottle" };
  assert.deepEqual(buildLowStockAlerts([current], [row(cached, { status: "stockout" })]), []);
  const low = { ...current, currentStock: 1.25 };
  const alert = buildLowStockAlerts([low], [row(cached)])[0];
  assert.strictEqual(alert.product, low);
  assert.equal(alert.product.name, "Updated name");
  assert.equal(alert.product.sku, "NEW");
  assert.equal(alert.product.unit, "bottle");
  assert.equal(alert.product.currentStock, 1.25);
});

test("current lead time and safety stock recompute the existing demand threshold", () => {
  const cached = product("a", { currentStock: 10, leadTimeDays: 3, safetyStock: 2 });
  const longerLead = { ...cached, leadTimeDays: 5 };
  assert.deepEqual(buildLowStockAlerts([longerLead], [row(cached)]), [
    { product: longerLead, status: "reorder", threshold: 12, thresholdSource: "reorder_point" },
  ]);
  const lowerMinimum = { ...cached, currentStock: 7, safetyStock: 0 };
  assert.deepEqual(buildLowStockAlerts([lowerMinimum], [row(cached)]), []);
  const greaterMinimum = { ...cached, safetyStock: 5 };
  assert.equal(buildLowStockAlerts([greaterMinimum], [row(cached)])[0].threshold, 11);
});

test("a cached calculation is corrected even when its product reference is already live", () => {
  const current = product("a", { currentStock: 10, leadTimeDays: 5, safetyStock: 2 });
  const alert = buildLowStockAlerts([current], [row(current, { reorderPoint: 8 })])[0];
  assert.equal(alert.threshold, 12);
  assert.equal(alert.thresholdSource, "reorder_point");
});

test("a saved decimal boundary survives insignificant formula roundoff", () => {
  const item = product("a", { currentStock: 2.1, leadTimeDays: 3, safetyStock: 0 });
  assert.notEqual(0.7 * 3, 2.1);
  const alert = buildLowStockAlerts(
    [item],
    [row(item, { dailyDemand: 0.7, reorderPoint: 2.1 })],
  )[0];
  assert.equal(alert.status, "reorder");
  assert.equal(alert.threshold, 2.1);
  const justAbove = { ...item, currentStock: 2.101 };
  assert.deepEqual(
    buildLowStockAlerts([justAbove], [row(item, { dailyDemand: 0.7, reorderPoint: 2.1 })]),
    [],
  );
});

test("inactive catalog products and orphan reorder rows are excluded", () => {
  const inactive = product("inactive", { currentStock: 0, isActive: false });
  const orphan = product("orphan", { currentStock: 0 });
  const active = product("active", { currentStock: 0, isActive: true });
  const legacyActive = product("legacy", { currentStock: 0 });
  assert.deepEqual(
    buildLowStockAlerts([inactive, active, legacyActive], [row(inactive), row(orphan)]).map(
      (alert) => alert.product.id,
    ),
    ["active", "legacy"],
  );
});

test("alerts rank stockouts first, then the lowest stock-to-threshold ratio", () => {
  const catalog = [
    product("half", { currentStock: 5, safetyStock: 10 }),
    product("out", { currentStock: 0, safetyStock: 0 }),
    product("quarter", { currentStock: 2, safetyStock: 8 }),
    product("negative", { currentStock: -1, safetyStock: 2 }),
    product("boundary", { currentStock: 4, safetyStock: 4 }),
  ];
  assert.deepEqual(
    buildLowStockAlerts(catalog, []).map((alert) => alert.product.id),
    ["negative", "out", "quarter", "half", "boundary"],
  );
});

test("equal urgency has deterministic name, SKU, then product-ID ordering", () => {
  const catalog = [
    product("d", { name: "Zebra", currentStock: 1 }),
    product("c", { name: "Apple", sku: "SKU-Z", currentStock: 1 }),
    product("b", { name: "Apple", sku: "SKU-A", currentStock: 1 }),
    product("a", { name: "Apple", sku: "SKU-A", currentStock: 1 }),
  ];
  assert.deepEqual(
    buildLowStockAlerts(catalog, []).map((alert) => alert.product.id),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    buildLowStockAlerts([...catalog].reverse(), []),
    buildLowStockAlerts(catalog, []),
  );
});

test("building and sorting alerts leave catalog and forecast rows untouched", () => {
  const item = Object.freeze(product("a", { currentStock: 1 }));
  const cachedRow = Object.freeze(row(item));
  const catalog = Object.freeze([item]);
  const rows = Object.freeze([cachedRow]);
  const before = JSON.stringify({ catalog, rows });
  const result = buildLowStockAlerts(catalog, rows);
  result[0].threshold = 99;
  result.reverse();
  assert.equal(JSON.stringify({ catalog, rows }), before);
  assert.equal(buildLowStockAlerts(catalog, rows)[0].threshold, 8);
});
