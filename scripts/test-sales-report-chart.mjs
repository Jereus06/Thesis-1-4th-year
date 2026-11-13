import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
});
after(() => server.close());
const { buildSalesTrend, buildSalesRecordShares, salesPieLayout, salesSharePercentage } =
  await server.ssrLoadModule("/src/lib/sales-report-chart.ts");
const { summarizeDailySales } = await server.ssrLoadModule("/src/lib/daily-sales.ts");

const product = (productId, patch = {}) => ({
  productId,
  name: `Product ${productId}`,
  sku: `SKU-${productId}`,
  unit: "piece",
  quantity: 1,
  totalAmount: 1,
  recordCount: 1,
  recordedCount: 1,
  importedCount: 0,
  ...patch,
});
const row = (date, patch = {}) => ({ ...product("p"), date, ...patch });
const day = 86_400_000;

test("sales chart sorts actual calendar dates and keeps missing dates unknown", () => {
  const result = buildSalesTrend([
    row("2026-11-03", { quantity: 4 }),
    row("2026-11-01", { quantity: 2 }),
  ]);
  assert.deepEqual(
    result.points.map((point) => point.date),
    ["2026-11-01", "2026-11-02", "2026-11-03"],
  );
  assert.deepEqual(
    result.points.map((point) => point.values.unit0),
    [2, null, 4],
  );
  assert.equal(result.points[1].timestamp - result.points[0].timestamp, day);
  assert.equal(result.points[2].timestamp - result.points[1].timestamp, day);
  assert.deepEqual(result.domain, [
    Date.parse("2026-11-01T00:00:00Z") - day / 2,
    Date.parse("2026-11-03T00:00:00Z") + day / 2,
  ]);
});

test("one day has a centered nonzero date domain and preserves an observed zero", () => {
  const result = buildSalesTrend([row("2026-11-01", { quantity: 0 })]);
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].values.unit0, 0);
  assert.equal(result.domain[1] - result.domain[0], day);
  assert.equal((result.domain[0] + result.domain[1]) / 2, result.points[0].timestamp);
});

test("widely separated saved dates keep calendar spacing without allocating every missing day", () => {
  const result = buildSalesTrend([row("1900-01-01"), row("2026-11-13")]);
  assert.equal(result.points.length, 3);
  assert.equal(result.points[1].values.unit0, null);
  assert.equal(result.points.at(-1).date, "2026-11-13");
  assert.equal(
    result.domain[1] - result.domain[0],
    Date.parse("2026-11-13T00:00:00Z") - Date.parse("1900-01-01T00:00:00Z") + day,
  );
});

test("same-day quantities aggregate exactly within each unit without adding kg to pieces", () => {
  const result = buildSalesTrend([
    row("2026-11-01", { unit: "piece", quantity: 2 }),
    row("2026-11-01", { unit: "kg", quantity: 0.1 }),
    row("2026-11-01", { unit: "kg", quantity: 0.2 }),
    row("2026-11-02", { unit: "piece", quantity: 3 }),
  ]);
  const keys = Object.fromEntries(result.series.map(({ unit, key }) => [unit, key]));
  assert.equal(result.points[0].values[keys.kg], 0.3);
  assert.equal(result.points[0].values[keys.piece], 2);
  assert.equal(result.points[1].values[keys.kg], null);
  assert.equal(result.points[1].values[keys.piece], 3);
});

test("saved unit labels remain distinct without invented unit conversion or normalization", () => {
  const result = buildSalesTrend([
    row("2026-11-01", { unit: "piece" }),
    row("2026-11-01", { unit: "pack" }),
    row("2026-11-01", { unit: "Piece" }),
  ]);
  assert.equal(result.series.length, 3);
  assert.deepEqual(
    new Set(result.series.map(({ unit }) => unit)),
    new Set(["piece", "pack", "Piece"]),
  );
});

test("calendar iteration uses UTC across month, leap-day and daylight-saving boundaries", () => {
  for (const [from, to, dates] of [
    ["2024-02-28", "2024-03-01", ["2024-02-28", "2024-02-29", "2024-03-01"]],
    ["2026-11-01", "2026-11-03", ["2026-11-01", "2026-11-02", "2026-11-03"]],
  ]) {
    const result = buildSalesTrend([row(from), row(to)]);
    assert.deepEqual(
      result.points.map(({ date }) => date),
      dates,
    );
    for (let index = 1; index < result.points.length; index++) {
      assert.equal(result.points[index].timestamp - result.points[index - 1].timestamp, day);
    }
  }
});

test("bad dates and unavailable quantities are omitted instead of manufacturing values", () => {
  const result = buildSalesTrend([
    row("2026-02-30"),
    row("bad"),
    row("0000-01-01"),
    row("2026-11-01", { quantity: Number.NaN }),
  ]);
  assert.deepEqual(result.points, []);
  assert.deepEqual(result.series, []);
  assert.deepEqual(buildSalesTrend([]).points, []);
});

test("pie shares count sales records rather than mixed units or estimated monetary amounts", () => {
  const result = buildSalesRecordShares([
    product("a", { name: "Same name", unit: "kg", quantity: 50, totalAmount: 500, recordCount: 2 }),
    product("b", { name: "Same name", unit: "piece", quantity: 1, totalAmount: 1, recordCount: 6 }),
  ]);
  assert.deepEqual(
    result.map(({ id, records, percentage }) => [id, records, percentage]),
    [
      ["b", 6, 75],
      ["a", 2, 25],
    ],
  );
  assert.equal(result[0].name, "Same name (SKU-b)");
  assert.equal(result[1].name, "Same name (SKU-a)");
});

test("pie retains every sales record in seven leading products and Other", () => {
  const products = Array.from({ length: 15 }, (_, index) =>
    product(String(index), { recordCount: index + 1 }),
  );
  const result = buildSalesRecordShares(products);
  assert.equal(result.length, 8);
  assert.equal(result[0].id, "14");
  assert.equal(result.at(-1).id, "other-products");
  assert.equal(result.at(-1).records, 36);
  assert.equal(
    result.reduce((sum, slice) => sum + slice.records, 0),
    120,
  );
  assert.ok(Math.abs(result.reduce((sum, slice) => sum + slice.percentage, 0) - 100) < 1e-10);
  assert.deepEqual(
    products.map(({ recordCount }) => recordCount),
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
});

test("pie shows up to eight products directly and handles empty saved record counts", () => {
  const products = Array.from({ length: 8 }, (_, index) => product(String(index)));
  assert.equal(buildSalesRecordShares(products).length, 8);
  assert.ok(buildSalesRecordShares(products).every(({ id }) => id !== "other-products"));
  assert.deepEqual(buildSalesRecordShares([]), []);
  assert.deepEqual(
    buildSalesRecordShares([
      product("a", { recordCount: 0 }),
      product("b", { recordCount: Number.NaN }),
    ]),
    [],
  );
});

test("clustered pie percentages stay outside the circle, separated and within mobile bounds", () => {
  const shares = buildSalesRecordShares(
    Array.from({ length: 129 }, (_, index) =>
      product(String(index), { recordCount: index < 7 ? 13 : index === 128 ? 150 : 1 }),
    ),
  );
  for (const width of [220, 280, 390, 1100]) {
    const { cx, radius, labels } = salesPieLayout(shares, width, 288);
    assert.equal(labels.length, 8);
    for (const label of labels) {
      assert(label.y >= 16 && label.y <= 272);
      assert(label.side > 0 ? label.x > cx + radius : label.x < cx - radius);
      assert(label.x >= 42 && label.x <= width - 42, "There is room for the percentage text");
      assert(
        label.side > 0 ? label.elbowX > cx + radius : label.elbowX < cx - radius,
        "Leader bends stay outside the circle",
      );
    }
    for (const side of [-1, 1]) {
      const rows = labels.filter((label) => label.side === side).sort((a, b) => a.y - b.y);
      for (let index = 1; index < rows.length; index++)
        assert(rows[index].y - rows[index - 1].y >= 18 - 1e-9);
    }
  }
});

test("pie labels handle one product, rounded percentages and tiny positive shares", () => {
  const layout = salesPieLayout(buildSalesRecordShares([product("a")]), 280, 288);
  assert.equal(layout.labels[0].text, "100%");
  assert.equal(salesSharePercentage(3.59116022), "3.59%");
  assert.equal(salesSharePercentage(0.0001), "<0.01%");
  assert.equal(salesSharePercentage(0), "0%");
});

test("Records counts saved entries independently of quantity and number of dates", () => {
  const catalog = ["a", "b"].map((id) => ({ id, sku: id, name: id, unit: "piece", unitCost: 1 }));
  const sales = [2, 2, 2, 2].map((qty, index) => ({
    id: `a${index}`,
    productId: "a",
    date: `2026-10-${24 + index}`,
    qty,
    source: "csv_import",
  }));
  sales.push(
    ...[1, 2, 2, 2].map((qty, index) => ({
      id: `b${index}`,
      productId: "b",
      date: `2026-10-${24 + index}`,
      qty,
      source: "csv_import",
    })),
  );
  const first = summarizeDailySales(sales, catalog, "2026-10-24", "2026-10-27");
  assert.deepEqual(
    first.products.map(({ quantity, recordCount }) => [quantity, recordCount]),
    [
      [8, 4],
      [7, 4],
    ],
  );
  const added = summarizeDailySales(
    [...sales, { id: "extra", productId: "a", date: "2026-10-27", qty: 3, source: "manual" }],
    catalog,
    "2026-10-24",
    "2026-10-27",
  );
  assert.equal(added.products[0].recordCount, 5);
  assert.equal(added.products[0].quantity, 11);
  assert.equal(added.products[0].importedCount, 4);
  assert.equal(added.products[0].recordedCount, 1);
});
